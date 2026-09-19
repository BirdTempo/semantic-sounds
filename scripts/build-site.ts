// Build the public page.
//
//   npm run site:build
//
// One static directory, `site/`. The page holds the whole set, the search
// engine and the renderer inline, so it makes no request of its own and
// shows no loading state. Measured: 535 KB raw, 89 KB gzipped.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sounds } from '../src/library/index';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const siteDir = join(root, 'site');

/**
 * The one line to change to move the site.
 *
 * The canonical link, the Open Graph tags, the sitemap and robots.txt all
 * read it. The author owns semantic-sounds.com already.
 */
export const ORIGIN = 'https://semantic-sounds.com';

export const TITLE = 'Semantic Sounds';
export const TAGLINE = 'Ask for a sound the way you would say it.';

const CATEGORIES = [...new Set(sounds.map((entry) => entry.category))].sort();

const DESCRIPTION =
  `${sounds.length} short interface sounds you find with plain prose. ` +
  'A sound is data, not an audio file: each one is a small JSON patch, ' +
  'rendered in the page by one deterministic renderer.';

/** Escape text for an HTML text node or a double-quoted attribute. */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Bundle the page script.
 *
 * It goes inline, not into a file of its own. The page is one request that
 * way, and the Content-Security-Policy in `site/_headers` can forbid every
 * outside script host.
 */
async function bundleApp(): Promise<string> {
  const result = await build({
    entryPoints: [join(root, 'src/site/app.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    write: false,
    legalComments: 'none',
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('esbuild produced no output for src/site/app.ts');
  return output.text;
}

/** The set as plain text, for a reader that cannot run the MCP server. */
function llmsTxt(): string {
  const head = [
    `# ${TITLE}`,
    '',
    `> ${DESCRIPTION}`,
    '',
    `Source: https://github.com/BirdTempo/semantic-sounds`,
    `Package: npm install semantic-sounds`,
    `MCP: claude mcp add semantic-sounds -- npx -y semantic-sounds-mcp`,
    '',
    `## The set (${sounds.length} sounds, ${CATEGORIES.length} categories)`,
    '',
    'One line per sound: name — phrase — category — keywords',
    '',
  ];
  const rows = [...sounds]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.name} — ${entry.phrase} — ${entry.category} — ${entry.keywords.join(', ')}`);
  return `${head.join('\n')}${rows.join('\n')}\n`;
}

function sitemapXml(): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${ORIGIN}/</loc>`,
    `    <lastmod>${today}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}

/** The structured-data block, so a search engine reads the set as one thing. */
function jsonLd(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: TITLE,
    description: DESCRIPTION,
    url: `${ORIGIN}/`,
    codeRepository: 'https://github.com/BirdTempo/semantic-sounds',
    programmingLanguage: 'TypeScript',
    license: 'https://opensource.org/licenses/MIT',
    author: { '@type': 'Organization', name: 'BirdTempo' },
  });
}

function page(app: string, css: string): string {
  const chips = CATEGORIES.map((name) => escape(name)).join(', ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE} — ${escape(TAGLINE)}</title>
<meta name="description" content="${escape(DESCRIPTION)}">
<link rel="canonical" href="${ORIGIN}/">
<meta property="og:type" content="website">
<meta property="og:url" content="${ORIGIN}/">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${escape(DESCRIPTION)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">${jsonLd()}</script>
<style>${css}</style>
</head>
<body>

<div class="wrap">
  <header>
    <h1>${TITLE}</h1>
    <p class="lede"><strong>${escape(TAGLINE)}</strong></p>
    <p class="lede">${sounds.length} short sounds across ${CATEGORIES.length} categories.
    A sound is data, not an audio file: each one is a small JSON patch of
    synthesis settings, rendered right here by one deterministic renderer.
    Nothing plays until you click.</p>
  </header>
</div>

<div class="search">
  <div class="wrap">
    <div class="row">
      <input id="q" type="search" autocomplete="off" spellcheck="false"
             placeholder="Type what you want &mdash; &ldquo;the upload finished&rdquo;, &ldquo;a cat purring&rdquo;, &ldquo;my battery is low&rdquo;"
             aria-label="Search ${sounds.length} sounds with plain prose">
      <div class="levels">
        <label for="volume">volume</label>
        <input id="volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volume">
        <label><input id="mute" type="checkbox"> mute</label>
      </div>
    </div>
    <div id="filters" role="group" aria-label="Filter by category"></div>
  </div>
</div>

<div class="wrap">
  <p id="count" role="status"></p>
  <div id="grid"></div>
  <div id="live" class="sr" role="status" aria-live="polite"></div>
</div>

<div class="wrap">

<section>
  <h2>Use it in your app</h2>
  <p>The search runs in your page, over a static index. No request, no key.</p>
  <div class="cols">
    <div>
<pre><code>npm install semantic-sounds</code></pre>
<pre><code>import { createSemanticSounds } from 'semantic-sounds/sdk';

const sounds = createSemanticSounds();
const hit = sounds.find('the upload finished');

const samples = sounds.render(hit);  // Float32Array
const file = sounds.wav(hit);        // a .wav you can save</code></pre>
    </div>
    <div>
      <p>Every sound is a patch: one to four layers of oscillator or noise,
      each with an envelope and an optional filter. The renderer is
      deterministic, so the sound you hear on this page is the sound your
      users hear, to the sample.</p>
      <p>Each entry passes a contract: 30 to 1500 ms, a peak at or below
      &minus;1&nbsp;dBFS, and a concept that agrees with what the audio
      measures.</p>
    </div>
  </div>
</section>

<section>
  <h2>Give it to a coding agent</h2>
  <p>The MCP server hands an agent five tools, so it picks a real sound
  instead of inventing an audio file name.</p>
<pre><code>claude mcp add semantic-sounds -- npx -y semantic-sounds-mcp</code></pre>
  <p><code>search_sounds</code>, <code>get_sound</code>,
  <code>list_categories</code>, <code>list_category</code> and
  <code>resolve_sound</code>. Each answer carries the patch as JSON, and
  <code>resolve_sound</code> says whether the patch is curated or
  generated &mdash; which is what stops an agent from writing an
  approximate match into your code as though it were exact.</p>
</section>

<section>
  <h2>What is in the set</h2>
  <p>${chips}.</p>
</section>

</div>

<footer>
  <div class="wrap">
    MIT &copy; BirdTempo &middot;
    <a href="https://github.com/BirdTempo/semantic-sounds">GitHub</a> &middot;
    <a href="https://www.npmjs.com/package/semantic-sounds">npm</a> &middot;
    <a href="/llms.txt">llms.txt</a>
  </div>
</footer>

<script type="module">${app}</script>
</body>
</html>
`;
}

/**
 * Every file the site may publish. The deploy uploads the whole directory,
 * so anything that lands in it goes public.
 *
 * This list exists because a stray directory did go public once: a shell
 * ran with `site/` as its working directory, local tooling wrote state
 * into it, and the next deploy uploaded that state. A deploy must carry
 * what the build made, and nothing else.
 */
const ALLOWED = new Set(['index.html', 'sitemap.xml', 'llms.txt', 'robots.txt', '_headers', 'favicon.svg']);

/** Refuse to finish a build that would publish a file nobody chose. */
function checkNoStrays(): void {
  const strays = readdirSync(siteDir).filter((name) => !ALLOWED.has(name));
  if (strays.length > 0) {
    throw new Error(
      `site/ holds ${strays.length} file(s) the build did not make: ${strays.join(', ')}. ` +
        'A deploy uploads the whole directory. Remove them, or add them to ALLOWED in scripts/build-site.ts.'
    );
  }
}

export async function buildSite(): Promise<{ bytes: number }> {
  mkdirSync(siteDir, { recursive: true });
  const app = await bundleApp();
  const css = readFileSync(join(root, 'src/site/style.css'), 'utf8');
  const html = page(app, css);

  writeFileSync(join(siteDir, 'index.html'), html);
  writeFileSync(join(siteDir, 'sitemap.xml'), sitemapXml());
  writeFileSync(join(siteDir, 'llms.txt'), llmsTxt());

  checkNoStrays();

  return { bytes: Buffer.byteLength(html) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { bytes } = await buildSite();
  console.log(`site/index.html  ${(bytes / 1024).toFixed(0)} KB  (${sounds.length} sounds, ${CATEGORIES.length} categories)`);
  console.log(`site/sitemap.xml site/llms.txt written. Origin: ${ORIGIN}`);
}
