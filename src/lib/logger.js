import { createWriteStream, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { LOG_FILE, LOGS_DIR } from './constants.js';

let logStream = null;

/**
 * Initialize the log file stream.
 */
function ensureLogStream() {
  if (!logStream) {
    mkdirSync(LOGS_DIR, { recursive: true });
    logStream = createWriteStream(LOG_FILE, { flags: 'a' });
  }
  return logStream;
}

/**
 * Write a line to the Playground log file.
 * @param {string} line
 * @param {'stdout'|'stderr'|'mcp'} source
 */
export function writeLog(line, source = 'mcp') {
  const stream = ensureLogStream();
  const timestamp = new Date().toISOString();
  stream.write(`[${timestamp}] [${source}] ${line}\n`);
}

/**
 * Get the writable stream for piping child process output.
 * @returns {import('node:fs').WriteStream}
 */
export function getLogStream() {
  return ensureLogStream();
}

/**
 * Read recent log lines from the log file.
 * @param {object} options
 * @param {number} [options.lines=50] - Number of lines to return
 * @param {'all'|'error'|'php'} [options.type='all'] - Filter type
 * @returns {string}
 */
export function readLogs({ lines = 50, type = 'all' } = {}) {
  if (!existsSync(LOG_FILE)) {
    return 'No log file found. Start a Playground instance to generate logs.';
  }

  const content = readFileSync(LOG_FILE, 'utf-8');
  let allLines = content.split('\n').filter((l) => l.length > 0);

  if (type === 'error') {
    allLines = allLines.filter(
      (l) =>
        /\b(error|fatal|warning|notice|deprecated)\b/i.test(l) ||
        /\b(PHP (Fatal|Parse|Warning|Notice|Deprecated))\b/.test(l) ||
        /\[stderr\]/.test(l)
    );
  } else if (type === 'php') {
    allLines = allLines.filter(
      (l) =>
        /\bPHP\b/.test(l) ||
        /\.php/.test(l) ||
        /\[stderr\]/.test(l)
    );
  }

  // Return the last N lines
  const result = allLines.slice(-lines);
  if (result.length === 0) {
    if (type === 'error') return 'No errors found in the logs.';
    if (type === 'php') return 'No PHP-related entries found in the logs.';
    return 'Log file is empty.';
  }

  return result.join('\n');
}

/**
 * Clear the log file (for a fresh start).
 */
export function clearLogs() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  if (existsSync(LOG_FILE)) {
    const stream = createWriteStream(LOG_FILE, { flags: 'w' });
    stream.end();
  }
}

/**
 * Close the log stream (for clean shutdown).
 */
export function closeLogStream() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}
