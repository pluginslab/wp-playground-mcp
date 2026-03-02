import { stopInstance } from '../lib/instance-manager.js';

export const stopPlaygroundSchema = {
  name: 'stop_playground',
  description: 'Stop the active Playground instance and clean up resources.',
  inputSchema: {},
};

/**
 * @returns {Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }>}
 */
export async function handleStopPlayground() {
  try {
    const result = await stopInstance();

    return {
      content: [{
        type: 'text',
        text: [
          '**Playground stopped.**',
          '',
          `- **Instance:** ${result.instanceId}`,
          `- **Uptime:** ${result.uptime}`,
        ].join('\n'),
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error stopping Playground: ${err.message}` }],
      isError: true,
    };
  }
}
