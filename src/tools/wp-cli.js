import { z } from 'zod';
import { execPhp } from '../lib/instance-manager.js';
import { wpCliToPhp } from '../lib/wp-cli-mapper.js';

export const wpCliSchema = {
  name: 'wp_cli',
  description:
    'Run a WP-CLI command against the active Playground instance. ' +
    'The command is executed via a PHP bridge that translates common WP-CLI commands into WordPress function calls. ' +
    'Supports: option, post, plugin, theme, user, site, db, eval, transient, menu, search-replace. ' +
    'For unsupported commands, include them as wp-cli steps in the blueprint.',
  inputSchema: {
    command: z
      .string()
      .describe(
        'The WP-CLI command to run (with or without the "wp" prefix). ' +
        'Examples: "post list --format=json", "option get blogname", "plugin list"'
      ),
  },
};

/**
 * @param {{ command: string }} args
 * @returns {Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }>}
 */
export async function handleWpCli(args) {
  try {
    const { command } = args;

    // Convert the WP-CLI command to PHP code
    const { php, error: mapError } = wpCliToPhp(command);

    if (mapError && !php) {
      return {
        content: [{
          type: 'text',
          text: `**WP-CLI command not supported via bridge.**\n\n${mapError}\n\n` +
            `**Tip:** You can add this command as a \`wp-cli\` step in the blueprint when starting the playground, ` +
            `or use \`wp eval\` with equivalent PHP code.`,
        }],
        isError: true,
      };
    }

    if (php === null) {
      return {
        content: [{
          type: 'text',
          text: `**Command cannot be translated to PHP.** This WP-CLI command requires features not available via the bridge.\n\n` +
            `**Alternatives:**\n` +
            `1. Include the command as a \`wp-cli\` step in the blueprint before starting\n` +
            `2. Use \`wp eval "<PHP code>"\` with equivalent WordPress functions`,
        }],
        isError: true,
      };
    }

    // Execute the PHP code
    const result = await execPhp(php);

    if (result.exitCode !== 0 || result.error) {
      const lines = [];
      if (result.output) lines.push(result.output);
      if (result.error) lines.push(`**Error:** ${result.error}`);
      lines.push(`**Exit code:** ${result.exitCode}`);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: result.output || '(no output)' }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error executing WP-CLI command: ${err.message}` }],
      isError: true,
    };
  }
}
