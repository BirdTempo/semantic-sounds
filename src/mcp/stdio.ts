#!/usr/bin/env node
// Run the semantic-sounds MCP server over stdio.
//
//   npx -y semantic-sounds-mcp
//
// Add it to a client config, for example Claude Code:
//
//   claude mcp add semantic-sounds -- npx -y semantic-sounds-mcp
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// stdout carries the protocol, so every message goes to stderr.
const server = createServer();
const transport = new StdioServerTransport();

server.connect(transport).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
