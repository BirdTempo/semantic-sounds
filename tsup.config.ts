import { defineConfig } from 'tsup';

// Named entries, not a bare file list. With a list, tsup keeps each output
// under the common source root, so `src/library/index.ts` would land at
// `dist/library/index.js` and no longer match the `.` export. The names
// below are exactly the paths in the `exports` map of package.json.
export default defineConfig({
  entry: {
    index: 'src/library/index.ts',
    sdk: 'src/sdk.ts',
    'mcp/server': 'src/mcp/server.ts',
    'mcp/stdio': 'src/mcp/stdio.ts',
    haptic: 'src/haptic.ts',
    native: 'src/native.ts',
    'native-hook': 'src/native-hook.ts',
    pick: 'src/pick.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  // The stdio entry starts with a shebang, and npm needs the file to run.
  shims: false,
  // React is a peer dependency and an optional one. It must never be
  // pulled into the bundle: an app that imports only `semantic-sounds/native`
  // has no React in its dependency graph through this package.
  external: ['react'],
});
