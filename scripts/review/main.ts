// Start the review tool. Run it from the repository root: npm run review
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLibrary } from '../build-library.js';
import { createAskModel, findApiKey } from './anthropic.js';
import { bundleLibrary } from './bundle.js';
import { drawSound } from './draw.js';
import { createFakeDraw } from './fake.js';
import { buildSystemPrompt, buildUserMessage, pickReferences } from './prompt.js';
import { createHub, createReviewServer } from './server.js';
import { createSession } from './session.js';
import { createStore } from './store.js';
import type { DrawRequest, DrawResult } from './types.js';

const MAX_AT_ONCE = 6;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/** Run at most `limit` jobs at once. */
function createQueue(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await job();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

function main(): void {
  if (!existsSync(join(root, 'src/library/sounds'))) {
    console.error('run this from the repository root: src/library/sounds is missing');
    process.exit(1);
  }

  const portFlag = process.argv.indexOf('--port');
  const port = portFlag === -1 ? 5179 : Number(process.argv[portFlag + 1]);
  if (!Number.isFinite(port) || port <= 0) {
    console.error('--port needs a number');
    process.exit(1);
  }

  const store = createStore(root);
  const styleGuide = readFileSync(join(root, 'docs/sound-style-guide.md'), 'utf8');
  const system = buildSystemPrompt(styleGuide);
  const queue = createQueue(MAX_AT_ONCE);

  let draw: ((request: DrawRequest) => Promise<DrawResult>) | null = null;
  if (process.env.REVIEW_FAKE_DRAW === '1') {
    const fake = createFakeDraw();
    draw = (request) => queue(() => fake(request));
    console.log('REVIEW_FAKE_DRAW=1: sounds come from the fake generator, and no API call is made');
  } else {
    const envPath = join(root, '.env');
    const apiKey = findApiKey(process.env, existsSync(envPath) ? readFileSync(envPath, 'utf8') : null);
    if (apiKey) {
      const ask = createAskModel(new Anthropic({ apiKey }));
      draw = ({ entry, slot, rejected }) =>
        queue(() =>
          drawSound(ask, entry, {
            system,
            user: buildUserMessage({
              target: entry,
              references: pickReferences(entry, store.listEntries()),
              rejected,
              slot,
            }),
          }),
        );
    } else {
      console.warn('no ANTHROPIC_API_KEY: the library screen works, but no sound can be written');
    }
  }

  const hub = createHub();
  const session = createSession({ store, draw, onSlot: (event) => hub.publish(event) });
  const server = createReviewServer({
    store,
    session,
    hub,
    pageDir: join(here, 'page'),
    buildLibrary: async () => buildLibrary(root),
  });

  bundleLibrary(root)
    .then(() => {
      server.listen(port, '127.0.0.1', () => {
        console.log(`review tool: http://127.0.0.1:${port}`);
      });
    })
    .catch((error: unknown) => {
      console.error(
        `cannot bundle the library for the pages: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    });
}

main();
