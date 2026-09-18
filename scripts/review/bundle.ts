// Build the library into one ES module the pages can import, so the browser
// plays sound through the same renderer the validator measures.
import { build } from 'esbuild';
import { join } from 'node:path';

export async function bundleLibrary(root: string): Promise<void> {
  await build({
    entryPoints: [join(root, 'src/library/index.ts')],
    outfile: join(root, 'scripts/review/page/library-bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
}
