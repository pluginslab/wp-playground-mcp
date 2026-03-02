import { getActiveInstance, formatUptime } from '../lib/instance-manager.js';

export const getPlaygroundInfoSchema = {
  name: 'get_playground_info',
  description:
    'Returns the status and details of the current Playground instance, including URL, port, uptime, and the blueprint used.',
  inputSchema: {},
};

/**
 * @returns {{ content: Array<{ type: string, text: string }> }}
 */
export function handleGetPlaygroundInfo() {
  try {
    const info = getActiveInstance();

    if (!info) {
      return {
        content: [{
          type: 'text',
          text: '**No Playground instance is running.** Use `start_playground` to boot one.',
        }],
      };
    }

    const uptime = formatUptime(info.startedAt);

    const lines = [
      '**Playground Instance Status**',
      '',
      `- **Running:** yes`,
      `- **Instance ID:** ${info.instanceId}`,
      `- **URL:** ${info.url}`,
      `- **Port:** ${info.port}`,
      `- **Uptime:** ${uptime}`,
    ];

    if (info.pid) {
      lines.push(`- **PID:** ${info.pid}`);
    }

    if (info.blueprint?.preferredVersions) {
      const pv = info.blueprint.preferredVersions;
      if (pv.php) lines.push(`- **PHP:** ${pv.php}`);
      if (pv.wp) lines.push(`- **WordPress:** ${pv.wp}`);
    }

    if (info.blueprint?.plugins?.length > 0) {
      lines.push(`- **Plugins:** ${info.blueprint.plugins.join(', ')}`);
    }

    if (info.enhancements?.length > 0) {
      lines.push('');
      lines.push('**Auto-enhancements:**');
      for (const e of info.enhancements) {
        lines.push(`- ${e}`);
      }
    }

    lines.push('');
    lines.push('**Credentials:** admin / password');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error getting Playground info: ${err.message}` }],
      isError: true,
    };
  }
}
