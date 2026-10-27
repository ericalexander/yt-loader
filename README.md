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

## Layout

This repo is a one-plugin marketplace, so more plugins can be added under `plugins/`
and listed in `.claude-plugin/marketplace.json`.

```
.claude-plugin/marketplace.json
plugins/yt-loader/
  .claude-plugin/plugin.json
  skills/yt/SKILL.md
  skills/yt/scripts/fetch_transcript.mjs
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
- YouTube rate-limits cloud/datacenter IPs. From a home machine it's fine.
- Auto-generated captions have no punctuation and mangle proper nouns.
