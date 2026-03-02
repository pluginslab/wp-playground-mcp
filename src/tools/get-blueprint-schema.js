import { getBlueprintReference } from '../lib/blueprint-schema.js';

export const getBlueprintSchemaSchema = {
  name: 'get_blueprint_schema',
  description:
    'Returns the WordPress Playground Blueprint JSON schema reference. Use this to understand the blueprint format before generating one for start_playground. Includes all step types, resource types, top-level properties, and example blueprints.',
  inputSchema: {},
};

/**
 * @returns {{ content: Array<{ type: string, text: string }> }}
 */
export function handleGetBlueprintSchema() {
  try {
    const ref = getBlueprintReference();

    const lines = [];
    lines.push('# WordPress Playground Blueprint Reference');
    lines.push('');
    lines.push(`Full schema: ${ref.schemaUrl}`);
    lines.push('');

    // Top-level properties
    lines.push('## Top-Level Properties');
    lines.push('');
    for (const [key, info] of Object.entries(ref.topLevel)) {
      if (typeof info === 'object' && info.type) {
        lines.push(`- **\`${key}\`** (${info.type}) — ${info.description}`);
        if (info.example) lines.push(`  Example: \`${JSON.stringify(info.example)}\``);
        if (info.enum) lines.push(`  Values: ${info.enum.map((v) => `\`${v}\``).join(', ')}`);
      } else if (typeof info === 'object') {
        lines.push(`- **\`${key}\`** (object):`);
        for (const [subKey, subInfo] of Object.entries(info)) {
          if (subInfo.description) {
            lines.push(`  - \`${subKey}\` (${subInfo.type || 'string'}) — ${subInfo.description}`);
            if (subInfo.enum) lines.push(`    Values: ${subInfo.enum.map((v) => `\`${v}\``).join(', ')}`);
          }
        }
      }
    }
    lines.push('');

    // Steps
    lines.push('## Blueprint Steps');
    lines.push('');
    lines.push('Each step is an object with a `step` property. Add steps to the `steps` array.');
    lines.push('');
    for (const [name, info] of Object.entries(ref.steps)) {
      const req = info.required.length > 0 ? info.required.map((r) => `\`${r}\``).join(', ') : 'none';
      lines.push(`### \`${name}\``);
      lines.push(`${info.description}`);
      lines.push(`Required: ${req}`);
      if (Object.keys(info.params).length > 0) {
        for (const [param, desc] of Object.entries(info.params)) {
          lines.push(`- \`${param}\`: ${desc}`);
        }
      }
      lines.push('```json');
      lines.push(JSON.stringify(info.example, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Resources
    lines.push('## Resource Types');
    lines.push('');
    lines.push('Resources are used in steps like `installPlugin`, `installTheme`, `importWxr`, etc.');
    lines.push('');
    for (const [name, info] of Object.entries(ref.resources)) {
      lines.push(`### \`${name}\``);
      lines.push(info.description);
      for (const [prop, desc] of Object.entries(info.properties)) {
        lines.push(`- \`${prop}\`: ${desc}`);
      }
      lines.push('```json');
      lines.push(JSON.stringify(info.example, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Examples
    lines.push('## Complete Examples');
    lines.push('');
    for (const ex of ref.examples) {
      lines.push(`### ${ex.title}`);
      lines.push(ex.description);
      lines.push('```json');
      lines.push(JSON.stringify(ex.blueprint, null, 2));
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('**Note:** When using `start_playground`, the MCP will auto-inject `extraLibraries: ["wp-cli"]`, `login: true`, and `features.networking: true` if not present.');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error loading blueprint schema: ${err.message}` }],
      isError: true,
    };
  }
}
