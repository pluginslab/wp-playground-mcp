import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getBlueprintSchemaSchema, handleGetBlueprintSchema } from './tools/get-blueprint-schema.js';
import { startPlaygroundSchema, handleStartPlayground } from './tools/start-playground.js';
import { wpCliSchema, handleWpCli } from './tools/wp-cli.js';
import { getPlaygroundInfoSchema, handleGetPlaygroundInfo } from './tools/get-playground-info.js';
import { stopPlaygroundSchema, handleStopPlayground } from './tools/stop-playground.js';
import { getPlaygroundLogsSchema, handleGetPlaygroundLogs } from './tools/get-playground-logs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

/**
 * Create and configure the MCP server with all tools registered.
 * @returns {McpServer}
 */
export function createServer() {
  const server = new McpServer({
    name: 'wp-playground-mcp',
    version: pkg.version,
  });

  // Tool 1: get_blueprint_schema
  server.tool(
    getBlueprintSchemaSchema.name,
    getBlueprintSchemaSchema.description,
    getBlueprintSchemaSchema.inputSchema,
    handleGetBlueprintSchema,
  );

  // Tool 2: start_playground
  server.tool(
    startPlaygroundSchema.name,
    startPlaygroundSchema.description,
    startPlaygroundSchema.inputSchema,
    handleStartPlayground,
  );

  // Tool 3: wp_cli
  server.tool(
    wpCliSchema.name,
    wpCliSchema.description,
    wpCliSchema.inputSchema,
    handleWpCli,
  );

  // Tool 4: get_playground_info
  server.tool(
    getPlaygroundInfoSchema.name,
    getPlaygroundInfoSchema.description,
    getPlaygroundInfoSchema.inputSchema,
    handleGetPlaygroundInfo,
  );

  // Tool 5: stop_playground
  server.tool(
    stopPlaygroundSchema.name,
    stopPlaygroundSchema.description,
    stopPlaygroundSchema.inputSchema,
    handleStopPlayground,
  );

  // Tool 6: get_playground_logs
  server.tool(
    getPlaygroundLogsSchema.name,
    getPlaygroundLogsSchema.description,
    getPlaygroundLogsSchema.inputSchema,
    handleGetPlaygroundLogs,
  );

  return server;
}
