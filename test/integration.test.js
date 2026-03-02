import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  init,
  startInstance,
  stopInstance,
  getActiveInstance,
  execPhp,
} from '../src/lib/instance-manager.js';
import { validateBlueprint, enhanceBlueprint } from '../src/lib/blueprint-validator.js';
import { wpCliToPhp } from '../src/lib/wp-cli-mapper.js';
import { readLogs } from '../src/lib/logger.js';

/**
 * Integration tests — these boot a real WordPress Playground instance.
 *
 * Requirements:
 *   - npx must be able to download/run @wp-playground/cli
 *   - Port 9400+ must be available
 *   - Takes 30-120 seconds depending on network/cache
 *
 * Run: npm run test:integration
 */

describe('Integration: Playground lifecycle', { timeout: 180_000 }, () => {
  // Always clean up, even if tests fail
  after(async () => {
    try {
      const info = getActiveInstance();
      if (info) {
        await stopInstance();
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it('boots a Playground, runs WP-CLI commands, checks logs, and stops', async () => {
    // ── Init ──
    init();

    // ── Verify nothing is running ──
    const before = getActiveInstance();
    assert.equal(before, null, 'No instance should be running before the test');

    // ── Build and validate a blueprint ──
    const blueprint = {
      plugins: ['hello-dolly'],
      siteOptions: {
        blogname: 'MCP Integration Test',
      },
      steps: [
        {
          step: 'wp-cli',
          command: "wp post create --post_title='Test Post from MCP' --post_status=publish",
        },
      ],
    };

    const validation = validateBlueprint(blueprint);
    assert.equal(validation.valid, true, `Blueprint should be valid: ${validation.errors.join(', ')}`);

    const enhancements = enhanceBlueprint(blueprint);
    assert.ok(enhancements.length > 0, 'Should apply auto-enhancements');
    assert.ok(blueprint.extraLibraries.includes('wp-cli'), 'Should inject wp-cli');
    assert.equal(blueprint.login, true, 'Should inject login');
    assert.equal(blueprint.features.networking, true, 'Should inject networking');

    // ── Start the instance ──
    console.log('    Starting Playground instance (this may take a minute)...');
    const result = await startInstance({
      blueprint,
      enhancements,
    });

    assert.ok(result.instanceId, 'Should return an instance ID');
    assert.ok(result.url, 'Should return a URL');
    assert.equal(result.status, 'running', 'Status should be running');
    assert.ok(result.port >= 9400, 'Port should be >= 9400');
    console.log(`    Instance running at ${result.url} (${result.instanceId})`);

    // ── Verify instance info ──
    const info = getActiveInstance();
    assert.ok(info, 'Should have an active instance');
    assert.equal(info.running, true);
    assert.equal(info.instanceId, result.instanceId);
    assert.equal(info.url, result.url);

    // ── Wait for REST API to be fully ready ──
    console.log('    Waiting for REST API to be ready...');
    await waitForRestApi(result.url);

    // ── Run WP-CLI: option get blogname ──
    console.log('    Running WP-CLI commands...');
    const { php: optionPhp } = wpCliToPhp('option get blogname');
    assert.ok(optionPhp, 'Should map option get to PHP');

    const optionResult = await execPhp(optionPhp);
    assert.equal(optionResult.exitCode, 0, `option get should succeed: ${optionResult.error}`);
    assert.equal(optionResult.output, 'MCP Integration Test', 'Should return the blog name we set');

    // ── Run WP-CLI: post list ──
    const { php: postPhp } = wpCliToPhp('post list --format=json');
    assert.ok(postPhp, 'Should map post list to PHP');

    const postResult = await execPhp(postPhp);
    assert.equal(postResult.exitCode, 0, `post list should succeed: ${postResult.error}`);

    const posts = JSON.parse(postResult.output);
    assert.ok(Array.isArray(posts), 'Should return an array of posts');
    assert.ok(posts.length > 0, 'Should have at least one post');

    const mcpPost = posts.find((p) => p.post_title === 'Test Post from MCP');
    assert.ok(mcpPost, 'Should find the post created by the blueprint wp-cli step');
    assert.equal(mcpPost.post_status, 'publish', 'Post should be published');

    // ── Run WP-CLI: plugin list ──
    const { php: pluginPhp } = wpCliToPhp('plugin list --format=json');
    const pluginResult = await execPhp(pluginPhp);
    assert.equal(pluginResult.exitCode, 0, `plugin list should succeed: ${pluginResult.error}`);

    const plugins = JSON.parse(pluginResult.output);
    assert.ok(Array.isArray(plugins), 'Should return an array of plugins');
    const helloDolly = plugins.find((p) => p.name === 'Hello Dolly');
    assert.ok(helloDolly, 'Hello Dolly should be installed');

    // ── Run WP-CLI: site info ──
    const { php: sitePhp } = wpCliToPhp('site');
    const siteResult = await execPhp(sitePhp);
    assert.equal(siteResult.exitCode, 0, `site info should succeed: ${siteResult.error}`);
    assert.ok(siteResult.output.includes('MCP Integration Test'), 'Site info should contain the blog name');

    // ── Run WP-CLI: create a new post ──
    const { php: createPhp } = wpCliToPhp("post create --post_title='Created via Bridge' --post_status=publish");
    const createResult = await execPhp(createPhp);
    assert.equal(createResult.exitCode, 0, `post create should succeed: ${createResult.error}`);
    assert.ok(createResult.output.includes('Success'), 'Should report success');

    // ── Verify the new post exists ──
    const postResult2 = await execPhp(wpCliToPhp('post list --format=json').php);
    const posts2 = JSON.parse(postResult2.output);
    const bridgePost = posts2.find((p) => p.post_title === 'Created via Bridge');
    assert.ok(bridgePost, 'Should find the post created via the bridge');

    // ── Check logs ──
    const logs = readLogs({ lines: 10, type: 'all' });
    assert.ok(logs.length > 0, 'Should have log output');

    const errorLogs = readLogs({ lines: 50, type: 'error' });
    // Not asserting zero errors — Playground may emit warnings. Just verify it doesn't crash.
    assert.ok(typeof errorLogs === 'string', 'Error log filter should return a string');

    // ── Stop the instance ──
    console.log('    Stopping instance...');
    const stopResult = await stopInstance();
    assert.equal(stopResult.stopped, true, 'Should report stopped');
    assert.equal(stopResult.instanceId, result.instanceId, 'Should stop the correct instance');
    assert.ok(stopResult.uptime, 'Should report uptime');
    console.log(`    Stopped (uptime: ${stopResult.uptime})`);

    // ── Verify it's gone ──
    const afterStop = getActiveInstance();
    assert.equal(afterStop, null, 'No instance should be running after stop');
  });

  it('rejects starting a second instance while one is running', async () => {
    init();

    const blueprint = {};
    enhanceBlueprint(blueprint);

    console.log('    Starting first instance...');
    await startInstance({ blueprint, enhancements: [] });

    // Try to start a second one
    await assert.rejects(
      () => startInstance({ blueprint, enhancements: [] }),
      (err) => {
        assert.ok(err.message.includes('already running'), 'Should mention an instance is already running');
        return true;
      },
    );

    // Clean up
    await stopInstance();
  });
});

/**
 * Poll the MCP bridge via execPhp until it responds, with a timeout.
 * Uses execPhp which already handles cookies from the login step.
 */
async function waitForRestApi(_baseUrl, maxWaitMs = 60_000) {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const result = await execPhp('echo "ready";');
      if (result.exitCode === 0 && result.output === 'ready') return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`REST API not ready after ${maxWaitMs / 1000}s`);
}
