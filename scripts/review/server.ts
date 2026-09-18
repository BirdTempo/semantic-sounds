// HTTP routes for the review tool. It listens on 127.0.0.1 only and has no
// login, so do not expose it on a network.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { BuildResult } from '../build-library.js';
import { ReviewError, type DecideRow, type RejectItem, type Session } from './session.js';
import type { Store } from './store.js';
import type { SlotEvent } from './types.js';

export type Hub = {
  publish(event: SlotEvent): void;
  subscribe(listener: (event: SlotEvent) => void): () => void;
};

export function createHub(): Hub {
  const listeners = new Set<(event: SlotEvent) => void>();
  return {
    publish: (event) => {
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type ServerDeps = {
  store: Store;
  session: Session;
  hub: Hub;
  /** The folder that holds library.html, redraw.html, review.css and the page scripts. */
  pageDir: string;
  buildLibrary: () => Promise<BuildResult>;
};

const HTML = 'text/html; charset=utf-8';
const JS = 'text/javascript; charset=utf-8';
const PAGES: Record<string, { file: string; type: string }> = {
  '/': { file: 'library.html', type: HTML },
  '/redraw': { file: 'redraw.html', type: HTML },
  '/review.css': { file: 'review.css', type: 'text/css; charset=utf-8' },
  '/common.js': { file: 'common.js', type: JS },
  '/audio.js': { file: 'audio.js', type: JS },
  '/library.js': { file: 'library.js', type: JS },
  '/redraw.js': { file: 'redraw.js', type: JS },
  '/library-bundle.js': { file: 'library-bundle.js', type: JS },
};

const MAX_BODY = 5_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new ReviewError(400, 'the request body is too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> | null;
  } catch {
    throw new ReviewError(400, 'the request body is not valid JSON');
  }
}

function openStream(req: IncomingMessage, res: ServerResponse, hub: Hub): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const unsubscribe = hub.subscribe((event) => res.write(`event: slot\ndata: ${JSON.stringify(event)}\n\n`));
  req.on('close', unsubscribe);
}

export function createReviewServer(deps: ServerDeps): Server {
  // One library build at a time. A second Submit waits for the first build.
  let building: Promise<unknown> = Promise.resolve();
  const build = (): Promise<BuildResult> => {
    const run = building.then(() => deps.buildLibrary());
    building = run.catch(() => undefined);
    return run;
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const page = req.method === 'GET' ? PAGES[url.pathname] : undefined;
    if (page) {
      // Read at each request, so an edit to a page file shows on reload.
      const body = readFileSync(join(deps.pageDir, page.file));
      res.writeHead(200, { 'content-type': page.type, 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/library':
        return sendJson(res, 200, {
          sounds: deps.store
            .listEntries()
            .map(({ name, phrase, category, concept, patch }) => ({ name, phrase, category, concept, patch })),
          open: deps.session.openNames(),
        });
      case 'GET /api/session':
        return sendJson(res, 200, { open: deps.session.view() });
      case 'POST /api/reject': {
        const body = await readJson(req);
        return sendJson(res, 200, { open: deps.session.reject(body?.items as RejectItem[]) });
      }
      case 'POST /api/decide': {
        const body = await readJson(req);
        const result = deps.session.decide(body?.rows as DecideRow[]);
        const answer: { open: unknown; build?: BuildResult } = { open: result.open };
        if (result.accepted > 0) answer.build = await build();
        return sendJson(res, 200, answer);
      }
      case 'GET /api/events':
        return openStream(req, res, deps.hub);
      default:
        return sendJson(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
    }
  };

  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const status = error instanceof ReviewError ? error.status : 500;
      if (status === 500) console.error(error);
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}
