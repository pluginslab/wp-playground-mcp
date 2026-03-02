import {
  VALID_STEP_TYPES,
  VALID_RESOURCE_TYPES,
  STEP_REQUIRED_PARAMS,
  SUPPORTED_PHP_VERSIONS,
} from './constants.js';

/**
 * Find the closest match for a string from a list of valid options.
 * Uses Levenshtein-ish comparison (simple character overlap).
 * @param {string} input
 * @param {string[]} options
 * @returns {string|null}
 */
function findClosestMatch(input, options) {
  const lower = input.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const opt of options) {
    const optLower = opt.toLowerCase();
    // Check prefix match
    if (optLower.startsWith(lower) || lower.startsWith(optLower)) {
      return opt;
    }
    // Check character overlap
    let score = 0;
    for (const ch of lower) {
      if (optLower.includes(ch)) score++;
    }
    const similarity = score / Math.max(lower.length, optLower.length);
    if (similarity > bestScore && similarity > 0.5) {
      bestScore = similarity;
      best = opt;
    }
  }
  return best;
}

/**
 * Validate a blueprint object for structural correctness.
 * @param {object} blueprint - The blueprint to validate
 * @returns {{ valid: boolean, errors: string[], warnings: string[], enhancements: string[] }}
 */
export function validateBlueprint(blueprint) {
  const errors = [];
  const warnings = [];
  const enhancements = [];

  if (!blueprint || typeof blueprint !== 'object') {
    return { valid: false, errors: ['Blueprint must be a non-null object.'], warnings, enhancements };
  }

  // Validate preferredVersions.php
  if (blueprint.preferredVersions?.php) {
    const phpVersion = String(blueprint.preferredVersions.php);
    if (!SUPPORTED_PHP_VERSIONS.includes(phpVersion)) {
      errors.push(
        `Invalid PHP version "${phpVersion}". Supported versions: ${SUPPORTED_PHP_VERSIONS.join(', ')}.`
      );
    }
  }

  // Validate top-level shorthands
  if (blueprint.plugins !== undefined && !Array.isArray(blueprint.plugins)) {
    errors.push('"plugins" must be an array of plugin slugs (strings).');
  }
  if (blueprint.plugins && Array.isArray(blueprint.plugins)) {
    for (const p of blueprint.plugins) {
      if (typeof p !== 'string') {
        errors.push(`Each entry in "plugins" must be a string. Got ${typeof p}.`);
        break;
      }
    }
  }

  if (blueprint.siteOptions !== undefined && typeof blueprint.siteOptions !== 'object') {
    errors.push('"siteOptions" must be an object of key-value pairs.');
  }

  if (blueprint.login !== undefined) {
    if (typeof blueprint.login !== 'boolean' && typeof blueprint.login !== 'object') {
      errors.push('"login" must be true, false, or an object with { username, password }.');
    }
  }

  if (blueprint.constants !== undefined && typeof blueprint.constants !== 'object') {
    errors.push('"constants" must be an object of PHP constants.');
  }

  if (blueprint.extraLibraries !== undefined && !Array.isArray(blueprint.extraLibraries)) {
    errors.push('"extraLibraries" must be an array (e.g. ["wp-cli"]).');
  }

  // Validate steps
  if (blueprint.steps !== undefined) {
    if (!Array.isArray(blueprint.steps)) {
      errors.push('"steps" must be an array.');
    } else {
      for (let i = 0; i < blueprint.steps.length; i++) {
        const step = blueprint.steps[i];
        if (!step || typeof step !== 'object') {
          errors.push(`steps[${i}]: Each step must be an object.`);
          continue;
        }

        const stepType = step.step;
        if (!stepType) {
          errors.push(`steps[${i}]: Missing required "step" property.`);
          continue;
        }

        // Check step type validity
        if (!VALID_STEP_TYPES.includes(stepType)) {
          const suggestion = findClosestMatch(stepType, VALID_STEP_TYPES);
          let msg = `steps[${i}]: Unknown step type "${stepType}".`;
          if (suggestion) {
            msg += ` Did you mean "${suggestion}"?`;
          }
          msg += ` Valid steps: ${VALID_STEP_TYPES.join(', ')}.`;
          errors.push(msg);
          continue;
        }

        // Check required params
        const required = STEP_REQUIRED_PARAMS[stepType] || [];
        for (const param of required) {
          if (step[param] === undefined) {
            errors.push(`steps[${i}] ("${stepType}"): Missing required parameter "${param}".`);
          }
        }

        // Validate resource references within steps
        validateStepResources(step, i, errors);
      }
    }
  }

  // Note auto-enhancements that will be applied
  if (!blueprint.extraLibraries?.includes('wp-cli')) {
    enhancements.push('Will auto-inject extraLibraries: ["wp-cli"] for WP-CLI support.');
  }
  if (blueprint.login === undefined) {
    enhancements.push('Will auto-inject login: true for admin access.');
  }
  if (!blueprint.features?.networking) {
    enhancements.push('Will auto-inject features.networking: true for network access.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    enhancements,
  };
}

/**
 * Validate resource references within a step.
 */
function validateStepResources(step, index, errors) {
  const resourceFields = ['pluginData', 'themeData', 'file', 'wordPressFilesZip', 'sql'];
  for (const field of resourceFields) {
    const resource = step[field];
    if (resource && typeof resource === 'object' && resource.resource) {
      if (!VALID_RESOURCE_TYPES.includes(resource.resource)) {
        const suggestion = findClosestMatch(resource.resource, VALID_RESOURCE_TYPES);
        let msg = `steps[${index}] ("${step.step}"): Unknown resource type "${resource.resource}" in "${field}".`;
        if (suggestion) {
          msg += ` Did you mean "${suggestion}"?`;
        }
        msg += ` Valid resource types: ${VALID_RESOURCE_TYPES.join(', ')}.`;
        errors.push(msg);
      }
    }
  }
}

/**
 * Enhance a blueprint with required defaults for MCP usage.
 * Mutates the blueprint in place.
 * @param {object} blueprint
 * @returns {string[]} List of enhancements applied
 */
export function enhanceBlueprint(blueprint) {
  const applied = [];

  // Ensure wp-cli is available
  if (!blueprint.extraLibraries) {
    blueprint.extraLibraries = ['wp-cli'];
    applied.push('Added extraLibraries: ["wp-cli"]');
  } else if (!blueprint.extraLibraries.includes('wp-cli')) {
    blueprint.extraLibraries.push('wp-cli');
    applied.push('Added "wp-cli" to extraLibraries');
  }

  // Ensure login
  if (blueprint.login === undefined) {
    blueprint.login = true;
    applied.push('Added login: true');
  }

  // Ensure networking
  if (!blueprint.features) {
    blueprint.features = { networking: true };
    applied.push('Added features.networking: true');
  } else if (blueprint.features.networking === undefined) {
    blueprint.features.networking = true;
    applied.push('Added features.networking: true');
  }

  // Inject the MCP bridge mu-plugin for WP-CLI execution
  if (!blueprint.steps) {
    blueprint.steps = [];
  }

  const hasBridge = blueprint.steps.some(
    (s) => s.step === 'writeFile' && s.path?.includes('mcp-bridge.php')
  );

  if (!hasBridge) {
    blueprint.steps.unshift({
      step: 'writeFile',
      path: '/wordpress/wp-content/mu-plugins/mcp-bridge.php',
      data: getMcpBridgePhp(),
    });
    applied.push('Injected MCP bridge mu-plugin for WP-CLI execution');
  }

  return applied;
}

/**
 * Returns the PHP code for the MCP bridge mu-plugin.
 * This mu-plugin registers REST API endpoints that allow the MCP server
 * to execute PHP code and WordPress functions against the running instance.
 */
function getMcpBridgePhp() {
  return `<?php
/**
 * Plugin Name: MCP Bridge
 * Description: REST API endpoints for wp-playground-mcp to execute commands against this instance.
 * Version: 1.0.0
 */

add_action('rest_api_init', function () {
    register_rest_route('mcp/v1', '/eval', [
        'methods'  => 'POST',
        'callback' => 'mcp_bridge_eval',
        'permission_callback' => '__return_true',
    ]);
});

function mcp_bridge_eval(WP_REST_Request $request) {
    $code = $request->get_param('code');
    if (empty($code)) {
        return new WP_REST_Response([
            'output' => '',
            'error'  => 'No code provided.',
            'exitCode' => 1,
        ], 400);
    }

    ob_start();
    $exit_code = 0;
    $error = '';

    try {
        $result = eval($code);
        if ($result === false) {
            $error = 'eval() returned false — possible parse error in code.';
            $exit_code = 1;
        }
    } catch (Throwable $e) {
        $error = $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine();
        $exit_code = 1;
    }

    $output = ob_get_clean();

    return new WP_REST_Response([
        'output'   => $output,
        'error'    => $error,
        'exitCode' => $exit_code,
    ]);
}`;
}
