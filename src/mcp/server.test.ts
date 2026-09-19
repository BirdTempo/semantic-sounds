import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, fromEnvironment, SERVER_NAME, SERVER_VERSION, PREVIEW_SAMPLE_RATE } from './server';
import { createSemanticSounds, type SemanticSounds } from '../sdk';

type Block = { type: string; text?: string; data?: string; mimeType?: string };

type Manifest = {
  version: string;
  exports: Record<string, string | { import: string }>;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
};

/** A package manifest, read at test time so it cannot drift from the code. */
function readJson(relative: string): Manifest {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as Manifest;
}

const api = createSemanticSounds();
let client: Client;

/** Call one tool and return its content blocks. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<Block[]> {
  const result = await client.callTool({ name, arguments: args });
  return result.content as Block[];
}

/** The joined text of every text block in a result. */
async function textOf(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const blocks = await call(name, args);
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/**
 * The patch out of a tool result. Cut the usage lines off first: they hold
 * `import { renderPatch }`, so the last brace in the whole result is not
 * the end of the patch.
 */
function patchJson(body: string): string {
  const head = body.split('\n\nUse it like this:')[0] ?? '';
  return head.slice(head.indexOf('{'), head.lastIndexOf('}') + 1);
}

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([createServer(api).connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

describe('the MCP server', () => {
  it('offers exactly the five tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'get_sound',
      'list_categories',
      'list_category',
      'resolve_sound',
      'search_sounds',
    ]);
  });

  it('describes every tool', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    }
  });

  describe('search_sounds', () => {
    it('ranks the set against plain prose', async () => {
      const text = await textOf('search_sounds', { query: 'the file finished uploading' });
      expect(text).toContain('upload-complete');
      expect(text).toContain('score');
    });

    it('honours the limit', async () => {
      const text = await textOf('search_sounds', { query: 'a dog barking', limit: 2 });
      expect(text.match(/phrase:/g)?.length).toBe(2);
    });

    it('sends no patches, because a ranked list exists to pick a name', async () => {
      const text = await textOf('search_sounds', { query: 'the file finished uploading' });
      expect(text).not.toContain('"layers"');
    });

    it('says so plainly when nothing matches', async () => {
      const blocks = await call('search_sounds', { query: 'zzzzqqqx' });
      const text = blocks.map((block) => block.text ?? '').join('');
      expect(text).toMatch(/no sound matched/i);
    });
  });

  describe('get_sound', () => {
    it('returns the entry, the patch and a usage snippet', async () => {
      const text = await textOf('get_sound', { name: 'upload-complete' });
      expect(text).toContain('upload-complete');
      expect(text).toContain('upload complete');
      expect(text).toContain('"layers"');
      expect(text).toContain('renderPatch');
    });

    it('returns a patch that parses back to the curated patch', async () => {
      const text = await textOf('get_sound', { name: 'upload-complete' });
      expect(JSON.parse(patchJson(text))).toEqual(api.get('upload-complete')!.patch);
    });

    it('sends no audio without a preview', async () => {
      const blocks = await call('get_sound', { name: 'upload-complete' });
      expect(blocks.some((block) => block.type === 'audio')).toBe(false);
    });

    it('sends one WAV audio block with a preview', async () => {
      const blocks = await call('get_sound', { name: 'upload-complete', preview: true });
      const audio = blocks.filter((block) => block.type === 'audio');
      expect(audio.length).toBe(1);
      expect(audio[0]?.mimeType).toBe('audio/wav');
      const bytes = Buffer.from(audio[0]!.data!, 'base64');
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
      // The preview renders at half the render rate, so it is half the size.
      expect(bytes.readUInt32LE(24)).toBe(PREVIEW_SAMPLE_RATE);
    });

    it('names the next tool when the name is unknown', async () => {
      const blocks = await call('get_sound', { name: 'no-such-sound' });
      const text = blocks.map((block) => block.text ?? '').join('');
      expect(text).toContain('no-such-sound');
      expect(text).toContain('search_sounds');
    });
  });

  describe('list_categories', () => {
    it('counts every category and every sound', async () => {
      const text = await textOf('list_categories');
      expect(text).toContain(`${api.categories().length} categories`);
      expect(text).toContain(`${api.sounds.length} sounds`);
      for (const name of api.categories()) expect(text).toContain(name);
    });
  });

  describe('list_category', () => {
    it('lists one category', async () => {
      const first = api.categories()[0]!;
      const text = await textOf('list_category', { category: first });
      expect(text.split('\n').length).toBe(api.inCategory(first).length);
    });

    it('names the next tool when the category is unknown', async () => {
      const text = await textOf('list_category', { category: 'no-such-category' });
      expect(text).toContain('list_categories');
    });
  });

  describe('resolve_sound', () => {
    it('answers an owned phrase from the curated set', async () => {
      const text = await textOf('resolve_sound', { phrase: 'the file finished uploading' });
      expect(text).toContain('curated');
      expect(text).toContain('upload-complete');
      expect(text).toContain('"layers"');
    });

    it('attaches a preview on request', async () => {
      const blocks = await call('resolve_sound', { phrase: 'the file finished uploading', preview: true });
      expect(blocks.filter((block) => block.type === 'audio').length).toBe(1);
    });

    it('reports plainly that generation is not configured', async () => {
      const blocks = await call('resolve_sound', { phrase: 'quantum entanglement' });
      const text = blocks.map((block) => block.text ?? '').join('');
      expect(text).toContain('quantum entanglement');
      expect(text).toContain('functionUrl');
      expect(blocks.some((block) => block.type === 'audio')).toBe(false);
    });
  });

  it('names itself', () => {
    expect(SERVER_NAME).toBe('semantic-sounds');
  });

  it('reports the version the two packages publish', () => {
    // A client shows this string. If it drifts from the published
    // version, a bug report names a release that does not hold the code.
    // The wrapper package must agree too: it depends on this one.
    const root = readJson('../../package.json');
    const wrapper = readJson('../../packages/semantic-sounds-mcp/package.json');
    expect(SERVER_VERSION).toBe(root.version);
    expect(wrapper.version).toBe(root.version);
    expect(wrapper.dependencies['semantic-sounds']).toBe(`^${root.version}`);
  });

  it('publishes every built entry that the exports map names', () => {
    const root = readJson('../../package.json');
    const config = readFileSync(new URL('../../tsup.config.ts', import.meta.url), 'utf8');
    for (const [subpath, target] of Object.entries(root.exports)) {
      if (typeof target !== 'object' || target === null) continue;
      // "./dist/mcp/server.js" -> the entry name tsup must produce.
      const entry = (target as { import: string }).import.replace('./dist/', '').replace('.js', '');
      // Drop the quotes, so a key written as 'mcp/server' reads the same
      // as one written as index.
      const keys = config.replace(/'/g, '');
      expect(keys, `exports "${subpath}" needs a tsup entry named "${entry}"`).toContain(`${entry}:`);
    }
    expect(root.bin['semantic-sounds-mcp']).toBe('./dist/mcp/stdio.js');
  });
});

describe('resolve_sound against a configured endpoint', () => {
  it('reports a generated patch and previews it', async () => {
    const generated = api.get('upload-complete')!.patch;
    const generating: SemanticSounds = {
      ...api,
      resolve: async () => ({ patch: generated, origin: 'generated' }),
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const other = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([createServer(generating).connect(serverTransport), other.connect(clientTransport)]);

    const result = await other.callTool({
      name: 'resolve_sound',
      arguments: { phrase: 'quantum entanglement', preview: true },
    });
    const blocks = result.content as Block[];
    const body = blocks.map((block) => block.text ?? '').join('');
    expect(body).toContain('generated by the model');
    expect(body).toContain('"layers"');
    expect(blocks.filter((block) => block.type === 'audio').length).toBe(1);
    await other.close();
  });
});

describe('fromEnvironment', () => {
  it('gives nothing for an empty environment', () => {
    expect(fromEnvironment({})).toEqual({});
  });

  it('reads the endpoint and the key', () => {
    expect(
      fromEnvironment({
        SEMANTIC_SOUNDS_FUNCTION_URL: 'https://example.invalid/generate',
        SEMANTIC_SOUNDS_API_KEY: 'secret',
      })
    ).toEqual({ functionUrl: 'https://example.invalid/generate', apiKey: 'secret' });
  });

  it('reads a positive minimum score', () => {
    expect(fromEnvironment({ SEMANTIC_SOUNDS_MIN_SCORE: '25' })).toEqual({ minScore: 25 });
  });

  it('ignores a score that is not a positive number', () => {
    expect(fromEnvironment({ SEMANTIC_SOUNDS_MIN_SCORE: 'loud' })).toEqual({});
    expect(fromEnvironment({ SEMANTIC_SOUNDS_MIN_SCORE: '-3' })).toEqual({});
    expect(fromEnvironment({ SEMANTIC_SOUNDS_MIN_SCORE: '' })).toEqual({});
  });
});
