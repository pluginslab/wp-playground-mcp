import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { validateBlueprint, enhanceBlueprint } from '../lib/blueprint-validator.js';
import { startInstance } from '../lib/instance-manager.js';

export const startPlaygroundSchema = {
  name: 'start_playground',
  description:
    'Boot an ephemeral WordPress Playground instance from a Blueprint JSON. ' +
    'The agent generates the blueprint based on user intent, using get_blueprint_schema as reference. ' +
    'Only one instance can run at a time.',
  inputSchema: {
    blueprint: z
      .object({})
      .passthrough()
      .describe(
        'A valid Playground Blueprint JSON object. Use get_blueprint_schema to learn the format. ' +
        'The MCP will auto-inject wp-cli, login, and networking if not present.'
      ),
    options: z
      .object({
        port: z.number().optional().describe('Port to run on. Default: 9400. Auto-increments if busy.'),
        php: z.string().optional().describe('PHP version shortcut — overrides blueprint.preferredVersions.php'),
        wp: z.string().optional().describe('WordPress version shortcut — overrides blueprint.preferredVersions.wp'),
        mount: z
          .array(z.string())
          .optional()
          .describe('Local directories to mount. Format: "/host/path:/wordpress/wp-content/plugins/my-plugin"'),
        mountBeforeInstall: z
          .array(z.string())
          .optional()
          .describe('Directories to mount before WordPress installation'),
      })
      .optional()
      .describe('Additional options for the Playground instance'),
  },
};

/**
 * @param {{ blueprint: object, options?: object }} args
 * @returns {Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }>}
 */
export async function handleStartPlayground(args) {
  try {
    let { blueprint, options = {} } = args;

    // If blueprint is empty and a mount path is given, look for .playground/blueprint.json
    if (isEmptyBlueprint(blueprint) && options.mount?.length > 0) {
      const projectBlueprint = findProjectBlueprint(options.mount);
      if (projectBlueprint) {
        blueprint = projectBlueprint;
      }
    }

    // Apply version shortcuts
    if (options.php || options.wp) {
      if (!blueprint.preferredVersions) blueprint.preferredVersions = {};
      if (options.php) blueprint.preferredVersions.php = options.php;
      if (options.wp) blueprint.preferredVersions.wp = options.wp;
    }

    // Validate the blueprint
    const validation = validateBlueprint(blueprint);
    if (!validation.valid) {
      const errorList = validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
      return {
        content: [{
          type: 'text',
          text: `**Invalid blueprint.** Use \`get_blueprint_schema\` to see all available steps and properties.\n\n**Errors:**\n${errorList}`,
        }],
        isError: true,
      };
    }

    // Enhance the blueprint with MCP defaults
    const enhancements = enhanceBlueprint(blueprint);

    // Start the instance
    const result = await startInstance({
      blueprint,
      port: options.port,
      mount: options.mount,
      mountBeforeInstall: options.mountBeforeInstall,
      enhancements,
    });

    const lines = [
      `**Playground is running.**`,
      '',
      `- **URL:** ${result.url}`,
      `- **Instance ID:** ${result.instanceId}`,
      `- **Port:** ${result.port}`,
      `- **Status:** ${result.status}`,
      `- **Credentials:** admin / password`,
    ];

    if (enhancements.length > 0) {
      lines.push('');
      lines.push('**Auto-enhancements applied:**');
      for (const e of enhancements) {
        lines.push(`- ${e}`);
      }
    }

    if (validation.warnings.length > 0) {
      lines.push('');
      lines.push('**Warnings:**');
      for (const w of validation.warnings) {
        lines.push(`- ${w}`);
      }
    }

    lines.push('');
    lines.push('Use `wp_cli` to run WP-CLI commands, `get_playground_logs` to check for errors, and `stop_playground` when done.');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error starting Playground: ${err.message}` }],
      isError: true,
    };
  }
}

/**
 * Check if a blueprint is empty (no meaningful keys).
 */
function isEmptyBlueprint(blueprint) {
  return !blueprint || Object.keys(blueprint).length === 0;
}

/**
 * Walk up from a directory to find a .playground/blueprint.json file.
 * Returns the parsed blueprint or null.
 */
function findBlueprintFromDir(dir) {
  let current = resolve(dir);
  const root = resolve('/');
  while (current !== root) {
    const candidate = resolve(current, '.playground', 'blueprint.json');
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf-8'));
      } catch {
        return null;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Extract host paths from mount strings and look for a project blueprint.
 * Mount format: "/host/path:/container/path"
 */
function findProjectBlueprint(mounts) {
  for (const m of mounts) {
    const hostPath = m.split(':')[0];
    if (!hostPath) continue;
    const bp = findBlueprintFromDir(hostPath);
    if (bp) return bp;
  }
  return null;
}
