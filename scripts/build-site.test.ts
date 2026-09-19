import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, ORIGIN, TITLE } from './build-site';
import { sounds } from '../src/library/index';

// A generated page needs a test that reads the output, not the generator.
const siteDir = join(dirname(fileURLToPath(import.meta.url)), '../site');
const read = (name: string): string => readFileSync(join(siteDir, name), 'utf8');

let html = '';
let llms = '';

beforeAll(async () => {
  await buildSite();
  html = read('index.html');
  llms = read('llms.txt');
}, 60_000);

describe('the built page', () => {
  it('holds every sound, so nothing is silently dropped', () => {
    const missing = sounds.filter((entry) => !html.includes(entry.name));
    expect(missing.map((entry) => entry.name)).toEqual([]);
  });

  it('holds the renderer inline, so a sound plays with no request', () => {
    // The bundle is minified, so every name this project chose is gone.
    // Assert on what minification cannot rename: the DOM calls that turn
    // samples into sound, and the type that turns them into a file.
    expect(html).toContain('AudioContext');
    expect(html).toContain('copyToChannel');
    expect(html).toContain('createBufferSource');
    expect(html).toContain('audio/wav');
    // The bundle is inline, in a module script, not a file of its own.
    expect(html).toContain('<script type="module">');
  });

  it('loads no script and no stylesheet from another host', () => {
    // The Content-Security-Policy in site/_headers forbids it. This test
    // is what keeps that header true.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
    expect(html).not.toMatch(/@import\s+url/i);
  });

  it('never starts audio on load', () => {
    expect(html).not.toContain('autoplay');
    // An AudioContext exists only inside the function the click calls.
    expect(html).not.toMatch(/new\s+AudioContext\(\)[^)]*\)\s*;?\s*<\/script>/);
  });

  it('offers every category as a filter', () => {
    for (const name of new Set(sounds.map((entry) => entry.category))) {
      expect(html).toContain(name);
    }
  });

  it('uses one origin everywhere', () => {
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/">`);
    expect(read('sitemap.xml')).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(read('robots.txt')).toContain(`${ORIGIN}/sitemap.xml`);
  });

  it('names itself and says the real count', () => {
    expect(html).toContain(`<title>${TITLE}`);
    expect(html).toContain(`${sounds.length} short sounds`);
  });

  it('carries structured data a search engine can read', () => {
    const block = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    expect(block).not.toBeNull();
    const data = JSON.parse(block![1]!) as { name: string; url: string };
    expect(data.name).toBe(TITLE);
    expect(data.url).toBe(`${ORIGIN}/`);
  });

  it('gives the search box an accessible name', () => {
    expect(html).toMatch(/<input id="q"[^>]*aria-label="/);
  });
});

describe('llms.txt', () => {
  it('lists one line per sound', () => {
    // Match the row shape, not the separator alone: the header line above
    // the rows explains the separator and so contains one.
    const rows = llms.split('\n').filter((line) => /^[a-z0-9-]+ — /.test(line));
    expect(rows.length).toBe(sounds.length);
  });

  it('gives each row a name, a phrase, a category and keywords', () => {
    const row = llms.split('\n').find((line) => line.startsWith('access-denied'));
    expect(row?.split(' — ').length).toBe(4);
  });

  it('points at the package and the MCP server', () => {
    expect(llms).toContain('npm install semantic-sounds');
    expect(llms).toContain('npx -y semantic-sounds-mcp');
  });
});
