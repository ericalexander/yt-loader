# yt-loader

Claude Code plugin. `/yt <youtube url>` pulls the video's captions into context,
gives you a summary, and leaves the full transcript loaded so you can ask questions.

No API key, no packages to install. It's one Node script with zero dependencies that
pulls YouTube's own caption tracks (the same thing the CC button loads), and Node is
already on any machine running Claude Code.

## Install

```
claude plugin marketplace add ericalexander/yt-loader
claude plugin install yt-loader@ericalexander
```

Or inside a session: `/plugin marketplace add ericalexander/yt-loader`, then
`/plugin install yt-loader@ericalexander`.

To hack on a local checkout without installing: `claude --plugin-dir ./plugins/yt-loader`

## Use

```
/yt https://www.youtube.com/watch?v=VIDEO_ID
/yt https://youtu.be/VIDEO_ID --timestamps
```

Pasting a YouTube link and asking a question also triggers it. Follow-up questions
answer from the transcript already in context; nothing is re-fetched.

Transcripts cache in `~/.cache/yt-transcript/`.

## MCP server (for sandboxed sessions)

The plugin also ships an MCP server exposing one tool, `youtube_transcript`. It exists
because the fetch script runs wherever Claude's shell is, and in Claude's cloud sandbox
(and the desktop app's sandboxed VM) youtube.com is blocked by an egress proxy. An MCP
server launched by the Claude desktop app runs on your own machine with normal network
access, so the same fetch works and the transcript comes back as a tool result.

The skill prefers the tool when it is present and falls back to the script otherwise.
Nothing to configure: `.mcp.json` in the plugin registers the server, and it is the same
zero-dependency Node code as the script.

To run it by hand, e.g. from a `claude_desktop_config.json`:

```json
{ "mcpServers": { "yt-loader": { "command": "node", "args": ["/path/to/plugins/yt-loader/mcp/server.mjs"] } } }
```

## Layout

This repo is a one-plugin marketplace, so more plugins can be added under `plugins/`
and listed in `.claude-plugin/marketplace.json`.

```
.claude-plugin/marketplace.json
plugins/yt-loader/
  .claude-plugin/plugin.json
  .mcp.json                          # registers mcp/server.mjs
  lib/transcript.mjs                 # the fetch + format logic, shared
  mcp/server.mjs                     # stdio MCP server: youtube_transcript tool
  skills/yt/SKILL.md
  skills/yt/scripts/fetch_transcript.mjs   # thin CLI over lib/
```

## How the fetch works

1. GET the watch page to pick up the InnerTube API key.
2. POST `youtubei/v1/player` as the Android client; the response carries the title and
   the list of caption tracks.
3. GET the chosen track's timed-text XML and flatten it.

If step 2 returns no captions it falls back to the player response embedded in the
watch page. Manual captions are preferred over auto-generated in each requested
language.

## Known limits

- Videos with captions disabled return nothing; the skill says so instead of guessing.
- If youtube.com is blocked on the network (proxied sandboxes), the script says so and
  points at the MCP server instead of retrying.
- YouTube rate-limits cloud/datacenter IPs. From a home machine it's fine.
- Auto-generated captions have no punctuation and mangle proper nouns.
