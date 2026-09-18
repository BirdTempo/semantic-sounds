import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { makeFixture, sampleEntry, type Fixture } from './fixture.js';
import { createSession } from './session.js';
import { createHub, createReviewServer } from './server.js';
import { createStore } from './store.js';
import type { DrawResult } from './types.js';

let fixture: Fixture | null = null;
const servers: { close(cb: () => void): void }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  fixture?.cleanup();
  fixture = null;
});

const okDraw = async (): Promise<DrawResult> => ({
  ok: true,
  candidate: {
    concept: 'A replacement sound written for this entry by the test.',
    patch: sampleEntry().patch,
    model: 'test-model',
  },
});

async function start() {
  fixture = makeFixture({ 'a-batch': [sampleEntry({ name: 'one', phrase: 'one' })] });
  const store = createStore(fixture.root);
  const hub = createHub();
  const session = createSession({ store, draw: okDraw, onSlot: (event) => hub.publish(event) });
  const server = createReviewServer({
    store,
    session,
    hub,
    pageDir: new URL('./page/', import.meta.url).pathname,
    buildLibrary: async () => ({ ok: true, output: 'built' }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, session, store };
}

describe('the review server', () => {
  it('serves the library screen as HTML', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<html');
  });

  it('lists the library with each patch', async () => {
    const { base } = await start();
    const data = (await (await fetch(`${base}/api/library`)).json()) as {
      sounds: { name: string; patch: unknown }[];
      open: string[];
    };
    expect(data.sounds).toHaveLength(1);
    expect(data.sounds[0]!.name).toBe('one');
    expect(data.sounds[0]!.patch).toBeTruthy();
    expect(data.open).toEqual([]);
  });

  it('rejects, then reports the row as open', async () => {
    const { base, session } = await start();
    const response = await fetch(`${base}/api/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ name: 'one', reason: 'too harsh' }] }),
    });
    expect(response.status).toBe(200);
    await session.idle();
    const data = (await (await fetch(`${base}/api/session`)).json()) as { open: { name: string }[] };
    expect(data.open[0]!.name).toBe('one');
  });

  it('turns a ReviewError into its status and message', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/api/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ name: 'missing' }] }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('missing');
  });

  it('answers 400 for a body that is not JSON', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/api/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('rebuilds the library after it accepts a slot', async () => {
    const { base, session } = await start();
    await fetch(`${base}/api/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ name: 'one' }] }),
    });
    await session.idle();
    const response = await fetch(`${base}/api/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: [{ name: 'one', choice: 'A' }] }),
    });
    const data = (await response.json()) as { build?: { ok: boolean } };
    expect(data.build).toEqual({ ok: true, output: 'built' });
  });

  it('streams a slot event to a listener', async () => {
    const { base, session } = await start();
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = stream.body!.getReader();
    await fetch(`${base}/api/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ name: 'one' }] }),
    });
    let text = '';
    while (!text.includes('event: slot')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain('event: slot');
    expect(text).toContain('"name":"one"');
    controller.abort();
    await session.idle();
  });

  it('answers 404 for an unknown route', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/nope`);
    expect(response.status).toBe(404);
  });
});
