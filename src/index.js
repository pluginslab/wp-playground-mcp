#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { init, cleanup } from './lib/instance-manager.js';

// Initialize the instance manager (checks for stale state files)
try {
  init();
} catch (err) {
  process.stderr.write(`Warning: Failed to initialize instance manager: ${err.message}\n`);
}

// Create and start the MCP server
const server = createServer();
const transport = new StdioServerTransport();

// Clean up on exit
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

await server.connect(transport);
