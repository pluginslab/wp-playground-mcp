import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBlueprint, enhanceBlueprint } from '../src/lib/blueprint-validator.js';

describe('validateBlueprint', () => {
  it('accepts a minimal valid blueprint', () => {
    const result = validateBlueprint({});
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts a blueprint with plugins shorthand', () => {
    const result = validateBlueprint({
      plugins: ['woocommerce', 'jetpack'],
      login: true,
    });
    assert.equal(result.valid, true);
  });

  it('accepts a blueprint with valid steps', () => {
    const result = validateBlueprint({
      steps: [
        { step: 'setSiteOptions', options: { blogname: 'Test' } },
        { step: 'installPlugin', pluginData: { resource: 'wordpress.org/plugins', slug: 'woo' } },
        { step: 'wp-cli', command: 'wp post list' },
      ],
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects a non-object blueprint', () => {
    const result = validateBlueprint('not an object');
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('non-null object'));
  });

  it('rejects null blueprint', () => {
    const result = validateBlueprint(null);
    assert.equal(result.valid, false);
  });

  it('rejects unknown step types', () => {
    const result = validateBlueprint({
      steps: [{ step: 'installPlugins', pluginData: {} }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Unknown step type "installPlugins"'));
    assert.ok(result.errors[0].includes('Did you mean "installPlugin"'));
  });

  it('rejects steps missing required params', () => {
    const result = validateBlueprint({
      steps: [{ step: 'writeFile' }], // missing path and data
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('"path"')));
    assert.ok(result.errors.some((e) => e.includes('"data"')));
  });

  it('rejects invalid PHP versions', () => {
    const result = validateBlueprint({
      preferredVersions: { php: '5.6' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Invalid PHP version'));
  });

  it('accepts valid PHP versions', () => {
    for (const version of ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4', 'latest']) {
      const result = validateBlueprint({
        preferredVersions: { php: version },
      });
      assert.equal(result.valid, true, `PHP ${version} should be valid`);
    }
  });

  it('rejects invalid plugins format', () => {
    const result = validateBlueprint({ plugins: 'woocommerce' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('array'));
  });

  it('rejects non-string plugin entries', () => {
    const result = validateBlueprint({ plugins: [123] });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('string'));
  });

  it('rejects invalid login format', () => {
    const result = validateBlueprint({ login: 'admin' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('login'));
  });

  it('rejects steps without step property', () => {
    const result = validateBlueprint({
      steps: [{ pluginPath: 'test' }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Missing required "step"'));
  });

  it('validates resource types in steps', () => {
    const result = validateBlueprint({
      steps: [
        {
          step: 'installPlugin',
          pluginData: { resource: 'wordpress.org/plugin', slug: 'test' }, // wrong: should be plugins
        },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Unknown resource type'));
  });

  it('reports planned enhancements', () => {
    const result = validateBlueprint({});
    assert.ok(result.enhancements.length > 0);
    assert.ok(result.enhancements.some((e) => e.includes('wp-cli')));
    assert.ok(result.enhancements.some((e) => e.includes('login')));
  });
});

describe('enhanceBlueprint', () => {
  it('adds wp-cli to extraLibraries', () => {
    const bp = {};
    const applied = enhanceBlueprint(bp);
    assert.ok(bp.extraLibraries.includes('wp-cli'));
    assert.ok(applied.some((a) => a.includes('wp-cli')));
  });

  it('does not duplicate wp-cli', () => {
    const bp = { extraLibraries: ['wp-cli'] };
    enhanceBlueprint(bp);
    const count = bp.extraLibraries.filter((l) => l === 'wp-cli').length;
    assert.equal(count, 1);
  });

  it('adds login: true', () => {
    const bp = {};
    enhanceBlueprint(bp);
    assert.equal(bp.login, true);
  });

  it('does not override existing login', () => {
    const bp = { login: { username: 'editor', password: 'test' } };
    enhanceBlueprint(bp);
    assert.deepEqual(bp.login, { username: 'editor', password: 'test' });
  });

  it('adds networking feature', () => {
    const bp = {};
    enhanceBlueprint(bp);
    assert.equal(bp.features.networking, true);
  });

  it('injects MCP bridge mu-plugin', () => {
    const bp = {};
    enhanceBlueprint(bp);
    assert.ok(bp.steps.length > 0);
    const bridgeStep = bp.steps.find(
      (s) => s.step === 'writeFile' && s.path?.includes('mcp-bridge.php')
    );
    assert.ok(bridgeStep);
    assert.ok(bridgeStep.data.includes('mcp/v1'));
  });

  it('does not duplicate bridge mu-plugin', () => {
    const bp = {};
    enhanceBlueprint(bp);
    enhanceBlueprint(bp);
    const bridgeSteps = bp.steps.filter(
      (s) => s.step === 'writeFile' && s.path?.includes('mcp-bridge.php')
    );
    assert.equal(bridgeSteps.length, 1);
  });
});
