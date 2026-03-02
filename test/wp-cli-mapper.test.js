import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWpCliCommand, wpCliToPhp } from '../src/lib/wp-cli-mapper.js';

describe('parseWpCliCommand', () => {
  it('parses a simple command', () => {
    const result = parseWpCliCommand('wp post list');
    assert.equal(result.subcommand, 'post');
    assert.equal(result.action, 'list');
  });

  it('strips the wp prefix', () => {
    const result = parseWpCliCommand('wp option get blogname');
    assert.equal(result.subcommand, 'option');
    assert.equal(result.action, 'get');
    assert.deepEqual(result.positional, ['blogname']);
  });

  it('works without wp prefix', () => {
    const result = parseWpCliCommand('option get blogname');
    assert.equal(result.subcommand, 'option');
    assert.equal(result.action, 'get');
  });

  it('parses flags with = syntax', () => {
    const result = parseWpCliCommand('post create --post_title=Hello --post_status=publish');
    assert.equal(result.flags.post_title, 'Hello');
    assert.equal(result.flags.post_status, 'publish');
  });

  it('parses quoted flag values', () => {
    const result = parseWpCliCommand("post create --post_title='Hello World'");
    assert.equal(result.flags.post_title, 'Hello World');
  });

  it('parses double-quoted flag values', () => {
    const result = parseWpCliCommand('post create --post_title="Hello World"');
    assert.equal(result.flags.post_title, 'Hello World');
  });

  it('parses boolean flags', () => {
    const result = parseWpCliCommand('post list --format=json');
    assert.equal(result.flags.format, 'json');
  });

  it('parses positional args', () => {
    const result = parseWpCliCommand('user create bob bob@example.com --role=editor');
    assert.equal(result.subcommand, 'user');
    assert.equal(result.action, 'create');
    assert.deepEqual(result.positional, ['bob', 'bob@example.com']);
    assert.equal(result.flags.role, 'editor');
  });
});

describe('wpCliToPhp', () => {
  it('maps option get', () => {
    const result = wpCliToPhp('option get blogname');
    assert.ok(result.php);
    assert.ok(result.php.includes("get_option('blogname')"));
    assert.equal(result.error, null);
  });

  it('maps option update', () => {
    const result = wpCliToPhp('option update blogname "My Site"');
    assert.ok(result.php);
    assert.ok(result.php.includes('update_option'));
    assert.ok(result.php.includes('My Site'));
  });

  it('maps post list', () => {
    const result = wpCliToPhp('wp post list --format=json');
    assert.ok(result.php);
    assert.ok(result.php.includes('get_posts'));
    assert.ok(result.php.includes('json_encode'));
  });

  it('maps post create', () => {
    const result = wpCliToPhp("post create --post_title='Test Post' --post_status=publish");
    assert.ok(result.php);
    assert.ok(result.php.includes('wp_insert_post'));
    assert.ok(result.php.includes('Test Post'));
  });

  it('maps plugin list', () => {
    const result = wpCliToPhp('plugin list --format=json');
    assert.ok(result.php);
    assert.ok(result.php.includes('get_plugins'));
  });

  it('maps plugin activate', () => {
    const result = wpCliToPhp('plugin activate woocommerce');
    assert.ok(result.php);
    assert.ok(result.php.includes('activate_plugin'));
  });

  it('maps theme list', () => {
    const result = wpCliToPhp('theme list');
    assert.ok(result.php);
    assert.ok(result.php.includes('wp_get_themes'));
  });

  it('maps user list', () => {
    const result = wpCliToPhp('user list --format=json');
    assert.ok(result.php);
    assert.ok(result.php.includes('get_users'));
  });

  it('maps user create', () => {
    const result = wpCliToPhp('user create bob bob@test.com --role=editor');
    assert.ok(result.php);
    assert.ok(result.php.includes('wp_create_user'));
    assert.ok(result.php.includes('editor'));
  });

  it('maps site info', () => {
    const result = wpCliToPhp('site');
    assert.ok(result.php);
    assert.ok(result.php.includes('home_url'));
  });

  it('maps eval', () => {
    const result = wpCliToPhp('eval "echo phpinfo();"');
    assert.ok(result.php);
    assert.ok(result.php.includes('phpinfo'));
  });

  it('returns error for unsupported commands', () => {
    const result = wpCliToPhp('super-custom-command do-something');
    assert.ok(result.error);
    assert.equal(result.php, null);
  });

  it('handles option get missing key', () => {
    const result = wpCliToPhp('option get');
    assert.ok(result.error);
    assert.ok(result.error.includes('Usage'));
  });

  it('handles post create without title', () => {
    // post create without any flags should still work (creates draft)
    const result = wpCliToPhp('post create');
    assert.ok(result.php);
    assert.ok(result.php.includes('wp_insert_post'));
  });
});
