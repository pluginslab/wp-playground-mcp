import { z } from 'zod';
import { readLogs } from '../lib/logger.js';

export const getPlaygroundLogsSchema = {
  name: 'get_playground_logs',
  description:
    'Returns recent logs from the Playground instance. Useful for checking PHP errors, startup messages, and debugging.',
  inputSchema: {
    lines: z
      .number()
      .min(1)
      .max(500)
      .optional()
      .describe('Number of log lines to return. Default: 50.'),
    type: z
      .enum(['all', 'error', 'php'])
      .optional()
      .describe(
        'Filter log output. "all" = everything, "error" = PHP errors/warnings/notices, "php" = PHP-related output. Default: "all".'
      ),
  },
};

/**
 * @param {{ lines?: number, type?: string }} args
 * @returns {{ content: Array<{ type: string, text: string }> }}
 */
export function handleGetPlaygroundLogs(args) {
  try {
    const { lines = 50, type = 'all' } = args;

    const logs = readLogs({ lines, type });

    const header = type === 'all'
      ? `**Playground Logs** (last ${lines} lines)`
      : `**Playground Logs** (last ${lines} ${type} entries)`;

    return {
      content: [{
        type: 'text',
        text: `${header}\n\n\`\`\`\n${logs}\n\`\`\``,
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error reading logs: ${err.message}` }],
      isError: true,
    };
  }
}
