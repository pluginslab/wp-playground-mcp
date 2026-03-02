import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  STATE_FILE,
  INSTANCES_DIR,
  BLUEPRINTS_DIR,
  LAST_BLUEPRINT_FILE,
  DEFAULT_PORT,
  MAX_PORT,
  STARTUP_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  HEALTH_CHECK_INTERVAL_MS,
} from './constants.js';
import { writeLog, clearLogs, getLogStream, closeLogStream } from './logger.js';

/** @type {{ process: import('node:child_process').ChildProcess|null, id: string, port: number, startedAt: string, blueprint: object, blueprintPath: string|null, enhancements: string[], cookies: string|null }|null} */
let activeInstance = null;

/**
 * Ensure all required directories exist.
 */
function ensureDirs() {
  mkdirSync(INSTANCES_DIR, { recursive: true });
  mkdirSync(BLUEPRINTS_DIR, { recursive: true });
}

/**
 * Check if a PID is alive.
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a port is available by attempting to connect.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function isPortAvailable(port) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    clearTimeout(timeout);
    return false; // Port is in use (got a response)
  } catch (err) {
    if (err.name === 'AbortError' || err.cause?.code === 'ECONNREFUSED') {
      return true; // Port is available
    }
    return true; // Assume available on other errors
  }
}

/**
 * Find an available port starting from the default.
 * @param {number} [preferred]
 * @returns {Promise<number>}
 */
async function findAvailablePort(preferred) {
  const start = preferred || DEFAULT_PORT;
  for (let port = start; port <= MAX_PORT; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${start}-${MAX_PORT}. Free a port or specify a different one.`);
}

/**
 * Read the state file from disk.
 * @returns {object|null}
 */
function readStateFile() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write the state file to disk.
 * @param {object} state
 */
function writeStateFile(state) {
  ensureDirs();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Delete the state file.
 */
function deleteStateFile() {
  if (existsSync(STATE_FILE)) {
    try {
      unlinkSync(STATE_FILE);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Initialize the instance manager. Checks for stale state files.
 */
export function init() {
  ensureDirs();
  const state = readStateFile();
  if (state) {
    if (state.pid && isPidAlive(state.pid)) {
      // Reconnect to existing instance
      activeInstance = {
        process: null, // Can't reconnect to the process object
        id: state.instanceId,
        port: state.port,
        startedAt: state.startedAt,
        blueprint: state.blueprint,
        blueprintPath: null,
        enhancements: state.enhancements || [],
        cookies: state.cookies || null,
      };
      writeLog(`Reconnected to existing instance ${state.instanceId} (PID ${state.pid}, port ${state.port})`);
    } else {
      // Stale state file — clean up
      writeLog(`Cleaned up stale state file (PID ${state.pid} is dead)`);
      deleteStateFile();
    }
  }
}

/**
 * Get information about the active instance.
 * @returns {object|null}
 */
export function getActiveInstance() {
  if (!activeInstance) {
    // Check state file for reconnected instances
    const state = readStateFile();
    if (state && state.pid && isPidAlive(state.pid)) {
      return {
        running: true,
        instanceId: state.instanceId,
        url: `http://127.0.0.1:${state.port}`,
        port: state.port,
        startedAt: state.startedAt,
        blueprint: state.blueprint,
        enhancements: state.enhancements || [],
        pid: state.pid,
        cookies: state.cookies || '',
      };
    }
    if (state) {
      deleteStateFile();
    }
    return null;
  }

  // Verify the process is still alive
  const state = readStateFile();
  if (state?.pid && !isPidAlive(state.pid)) {
    writeLog(`Instance ${activeInstance.id} process died unexpectedly`);
    activeInstance = null;
    deleteStateFile();
    return null;
  }

  return {
    running: true,
    instanceId: activeInstance.id,
    url: `http://127.0.0.1:${activeInstance.port}`,
    port: activeInstance.port,
    startedAt: activeInstance.startedAt,
    blueprint: activeInstance.blueprint,
    enhancements: activeInstance.enhancements,
    pid: state?.pid,
  };
}

/**
 * Start a new Playground instance.
 * @param {object} options
 * @param {object} options.blueprint - The enhanced blueprint JSON
 * @param {number} [options.port] - Preferred port
 * @param {string[]} [options.mount] - Mount mappings
 * @param {string[]} [options.mountBeforeInstall] - Pre-install mount mappings
 * @param {string[]} options.enhancements - Enhancements that were applied
 * @returns {Promise<{ instanceId: string, url: string, port: number, status: string, blueprint: object, enhancements: string[], error?: string }>}
 */
export async function startInstance({ blueprint, port: preferredPort, mount, mountBeforeInstall, enhancements }) {
  // Check if an instance is already running
  const current = getActiveInstance();
  if (current) {
    throw new Error(
      `A Playground instance is already running at ${current.url} (instance: ${current.instanceId}). ` +
      `Stop it first with stop_playground, or use the existing instance.`
    );
  }

  const instanceId = randomUUID().slice(0, 8);
  const port = await findAvailablePort(preferredPort);

  // Write blueprint to temp file
  const blueprintPath = join(tmpdir(), `wp-playground-blueprint-${instanceId}.json`);
  await writeFileAsync(blueprintPath, JSON.stringify(blueprint, null, 2), 'utf-8');

  // Also save as last-used blueprint
  ensureDirs();
  writeFileSync(LAST_BLUEPRINT_FILE, JSON.stringify(blueprint, null, 2), 'utf-8');

  // Clear logs for fresh start
  clearLogs();
  writeLog(`Starting Playground instance ${instanceId} on port ${port}`);
  writeLog(`Blueprint: ${blueprintPath}`);
  if (enhancements.length > 0) {
    writeLog(`Auto-enhancements: ${enhancements.join('; ')}`);
  }

  // Build the command arguments
  const args = [
    '@wp-playground/cli',
    'server',
    `--port=${port}`,
    `--blueprint=${blueprintPath}`,
  ];

  // Add mount arguments
  if (mount && mount.length > 0) {
    for (const m of mount) {
      args.push(`--mount=${m}`);
    }
  }
  if (mountBeforeInstall && mountBeforeInstall.length > 0) {
    for (const m of mountBeforeInstall) {
      args.push(`--mount-before-install=${m}`);
    }
  }

  writeLog(`Command: npx ${args.join(' ')}`);

  // Spawn the process
  const child = spawn('npx', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env },
  });

  const logStream = getLogStream();

  // Pipe output to log file
  child.stdout.on('data', (data) => {
    const text = data.toString();
    logStream.write(`[${new Date().toISOString()}] [stdout] ${text}`);
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    logStream.write(`[${new Date().toISOString()}] [stderr] ${text}`);
  });

  child.on('error', (err) => {
    writeLog(`Process error: ${err.message}`, 'stderr');
  });

  child.on('exit', (code, signal) => {
    writeLog(`Process exited with code ${code}, signal ${signal}`);
    if (activeInstance?.id === instanceId) {
      activeInstance = null;
      deleteStateFile();
    }
  });

  // Wait for the server to be ready
  try {
    await waitForReady(port, child);
  } catch (err) {
    // Kill the process if startup failed
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    deleteStateFile();
    cleanupBlueprintFile(blueprintPath);
    throw err;
  }

  // Perform login to capture session cookies.
  // Playground's `login: true` sets cookies on the first HTTP request,
  // and all subsequent requests need those cookies to avoid 302 redirects.
  let cookies = null;
  try {
    cookies = await performLogin(port);
    writeLog(`Login successful, captured session cookies`);
  } catch (err) {
    writeLog(`Warning: Could not capture login cookies: ${err.message}`, 'stderr');
  }

  // Store the active instance
  activeInstance = {
    process: child,
    id: instanceId,
    port,
    startedAt: new Date().toISOString(),
    blueprint,
    blueprintPath,
    enhancements,
    cookies,
  };

  // Write state file
  writeStateFile({
    instanceId,
    pid: child.pid,
    port,
    startedAt: activeInstance.startedAt,
    blueprint,
    enhancements,
    cookies,
  });

  writeLog(`Instance ${instanceId} is ready at http://127.0.0.1:${port}`);

  return {
    instanceId,
    url: `http://127.0.0.1:${port}`,
    port,
    status: 'running',
    blueprint,
    enhancements,
  };
}

/**
 * Wait for the Playground server to become ready.
 * Watches stdout for the ready message, then polls until HTTP responds.
 */
function waitForReady(port, child) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let readyMessageSeen = false;
    const url = `http://127.0.0.1:${port}`;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(pollInterval);
        reject(new Error(
          `Playground failed to start within ${STARTUP_TIMEOUT_MS / 1000} seconds. ` +
          `Check logs with get_playground_logs for details.`
        ));
      }
    }, STARTUP_TIMEOUT_MS);

    // Watch stdout for ready message
    const onData = (data) => {
      const text = data.toString();
      if (
        text.includes('WordPress is ready') ||
        text.includes('WordPress is running') ||
        text.includes('Server running') ||
        text.includes(`localhost:${port}`) ||
        text.includes(`127.0.0.1:${port}`)
      ) {
        readyMessageSeen = true;
        child.stdout.off('data', onData);
        // Don't resolve yet — wait for HTTP to actually respond
      }
    };
    child.stdout.on('data', onData);

    // Also watch stderr for fatal errors
    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (text.includes('EADDRINUSE') || text.includes('address already in use')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(pollInterval);
          reject(new Error(`Port ${port} is already in use.`));
        }
      }
    });

    // Handle process exit during startup
    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(pollInterval);
        reject(new Error(
          `Playground process exited with code ${code} during startup. ` +
          `Check logs with get_playground_logs for details. ` +
          `Ensure @wp-playground/cli is available: npx @wp-playground/cli --version`
        ));
      }
    });

    // Poll the URL — becomes the primary resolution method after ready message
    const pollInterval = setInterval(async () => {
      if (resolved) return;
      // Don't start polling until the ready message is seen (or after 10s as fallback)
      if (!readyMessageSeen) return;
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(url, {
          signal: controller.signal,
          redirect: 'manual',
        });
        clearTimeout(t);
        if (resp.status >= 200 && resp.status < 400) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            clearInterval(pollInterval);
            resolve();
          }
        }
      } catch {
        // Not ready yet, keep polling
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  });
}

/**
 * Perform the initial login request to capture WordPress session cookies.
 * Playground's `login: true` triggers auto-login on the first HTTP request,
 * returning a 302 with Set-Cookie headers. We capture those cookies and
 * send them with all subsequent requests.
 * @param {number} port
 * @returns {Promise<string>} Cookie header string for subsequent requests
 */
async function performLogin(port) {
  const url = `http://127.0.0.1:${port}/`;
  const maxAttempts = 15;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
      });
      clearTimeout(t);

      // Extract Set-Cookie headers
      const setCookies = resp.headers.getSetCookie?.() || [];
      if (setCookies.length > 0) {
        // Build a Cookie header from all Set-Cookie values
        const cookieParts = setCookies.map((sc) => sc.split(';')[0]);
        return cookieParts.join('; ');
      }

      // If we got a 200 without cookies, the login already happened
      if (resp.ok) {
        return '';
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('Could not perform login after multiple attempts');
}

/**
 * Stop the active Playground instance.
 * @returns {Promise<{ stopped: boolean, instanceId: string, uptime: string }>}
 */
export async function stopInstance() {
  const info = getActiveInstance();
  if (!info) {
    throw new Error('No Playground instance is running. Nothing to stop.');
  }

  const instanceId = info.instanceId;
  const startedAt = info.startedAt;
  const uptime = formatUptime(startedAt);

  writeLog(`Stopping instance ${instanceId}`);

  // Try to kill the process
  if (activeInstance?.process) {
    await killProcess(activeInstance.process);
  } else if (info.pid) {
    // Reconnected instance — kill by PID
    try {
      process.kill(info.pid, 'SIGTERM');
      // Wait for it to die
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (!isPidAlive(info.pid)) {
            clearInterval(check);
            resolve();
          }
        }, 200);
        setTimeout(() => {
          clearInterval(check);
          try { process.kill(info.pid, 'SIGKILL'); } catch { /* ignore */ }
          resolve();
        }, SHUTDOWN_TIMEOUT_MS);
      });
    } catch {
      // Process may already be dead
    }
  }

  // Clean up
  if (activeInstance?.blueprintPath) {
    cleanupBlueprintFile(activeInstance.blueprintPath);
  }
  activeInstance = null;
  deleteStateFile();

  writeLog(`Instance ${instanceId} stopped (uptime: ${uptime})`);

  return { stopped: true, instanceId, uptime };
}

/**
 * Kill a child process gracefully, then forcefully.
 */
function killProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }

    const forceKill = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);

    child.on('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });

    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(forceKill);
      resolve();
    }
  });
}

/**
 * Execute PHP code against the running instance via the MCP bridge.
 * @param {string} phpCode - PHP code to execute (without <?php prefix)
 * @returns {Promise<{ output: string, error: string, exitCode: number }>}
 */
export async function execPhp(phpCode) {
  const info = getActiveInstance();
  if (!info) {
    throw new Error('No Playground instance is running. Use start_playground to boot one first.');
  }

  const url = `${info.url}/wp-json/mcp/v1/eval`;
  const cookies = activeInstance?.cookies || info.cookies || '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const headers = { 'Content-Type': 'application/json' };
    if (cookies) {
      headers['Cookie'] = cookies;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: phpCode }),
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text();
      return {
        output: '',
        error: `HTTP ${resp.status}: ${text}`,
        exitCode: 1,
      };
    }

    const data = await resp.json();
    return {
      output: data.output || '',
      error: data.error || '',
      exitCode: data.exitCode || 0,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { output: '', error: 'Request timed out after 30 seconds.', exitCode: 1 };
    }
    return { output: '', error: `Failed to connect to Playground: ${err.message}`, exitCode: 1 };
  }
}

/**
 * Format uptime from a start timestamp.
 * @param {string} startedAt - ISO timestamp
 * @returns {string}
 */
export function formatUptime(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Clean up a temporary blueprint file.
 */
function cleanupBlueprintFile(path) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Clean up on process exit.
 */
export function cleanup() {
  closeLogStream();
  if (activeInstance?.process) {
    try { activeInstance.process.kill('SIGTERM'); } catch { /* ignore */ }
  }
}
