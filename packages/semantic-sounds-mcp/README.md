# semantic-sounds-mcp

The MCP server for [Semantic Sounds](https://github.com/BirdTempo/semantic-sounds),
so a coding agent picks a real sound from a curated set of 1090 instead of
inventing an audio file name.

```bash
claude mcp add semantic-sounds -- npx -y semantic-sounds-mcp
```

Five tools: `search_sounds`, `get_sound`, `list_categories`,
`list_category` and `resolve_sound`.

A sound is data, not an audio file. Every tool that answers with a sound
gives you its **patch**: a small JSON object of synthesis settings that
`renderPatch` turns into samples in the page. Nothing ships as audio.

Set `preview: true` on `get_sound` or `resolve_sound` to hear it. That adds
a WAV audio block, rendered at 24000 Hz to keep it small. The patch in the
same result always describes the full 48000 Hz render.

`resolve_sound` reports whether a patch is `curated` or `generated`. That
is what stops an agent from writing an approximate match into code as
though it were exact.

The search runs locally over a static index. It needs no key and no
network.

This package is a thin wrapper. The server lives in `semantic-sounds`,
which also holds the sound set, the renderer and the SDK, because all of
them must read one library.

MIT © BirdTempo
