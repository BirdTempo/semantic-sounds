#!/usr/bin/env node
// The MCP server, under the name people type.
//
// The server itself lives in `semantic-sounds`, because the sound set, the
// SDK and the server must read one library. This package exists only so
// that `npx -y semantic-sounds-mcp` works.
//
// Without it, npx looks for a *package* called `semantic-sounds-mcp`,
// finds nothing, and exits without a word. The `semantic-sounds-mcp`
// binary is inside `semantic-sounds`, which npx has no way to guess.
import 'semantic-sounds/mcp/stdio';
