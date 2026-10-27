---
name: yt
description: Pull a YouTube or TikTok video's transcript into context and summarize it. Use when the user gives a YouTube link or video id (youtube.com, youtu.be, shorts) or a TikTok link (tiktok.com/@user/video/…, vm.tiktok.com, tiktok.com/t/…) and wants a summary, notes, or to ask questions about what was said. Invoked as /yt <url> or whenever such a link appears with a question about its content.
---

# Video transcript (YouTube, TikTok)

Get the transcript, read it, then answer.

## Steps

1. Get the transcript. Two routes, same output:

   **a. The MCP tools, if they are in your tool list.** Prefer these.
   `youtube_transcript` for YouTube links, `tiktok_transcript` for TikTok links (either
   accepts either; they route by URL). They run on the user's own machine, so they work
   even when your shell cannot reach youtube.com or tiktok.com (Claude's cloud sandbox and
   the desktop app's VM block both). Pass `timestamps: true` when the user wants
   timestamps, chapters, or "where in the video" answers; `lang: "es,en"` etc. for a
   non-English preference.

   **b. Otherwise, the bundled script** (it caches, so re-runs are free):

   ```
   node ${CLAUDE_PLUGIN_ROOT}/skills/yt/scripts/fetch_transcript.mjs "<url or id>"
   ```

   Add `--timestamps` or `--lang es,en` as above. No dependencies; it runs on the
   Node that Claude Code already uses.

   If the script fails with "the video site looks unreachable from this network", do not
   retry with curl or another route — the network is blocked, not the script. Tell the
   user to run `/yt` from local Claude Code, or to install this plugin in the Claude
   desktop app so the MCP tools are available.

2. The full transcript is now in context. Keep it there; do not summarize it away or
   re-fetch for follow-up questions in the same session.

3. Default output, unless the user asked for something specific:
   - One line: title, channel/creator, length. (For TikTok the "title" is the post's
     caption text; the creator is shown as nickname @handle.)
   - A summary of 5–10 bullets covering the actual claims and content, not "the speaker
     discusses X." Write what was said. Short videos (Shorts, TikToks) get fewer bullets.
   - Any concrete numbers, names, tools, or recommendations called out in the video.
   - End with: "Transcript loaded — ask me anything about it."

4. For follow-ups, answer from the transcript already in context. Quote short phrases
   when helpful. If the user asks where something was said and you fetched without
   timestamps, re-fetch with them (the cache makes this instant).

## Notes

- Auto-generated captions have no punctuation (YouTube) or guessed punctuation (TikTok)
  and misspell names. Say so when it affects accuracy; don't pretend the transcript is
  cleaner than it is. TikTok captions are always auto-generated.
- If no transcript exists (captions disabled, music-only video, private or deleted post),
  say that plainly. Do not guess at the video's content from the title or caption.
- TikTok photo/slideshow posts have no speech and so no captions.
- Long videos (2h+ podcasts) can be 30k+ words. That still fits; load it rather than
  truncating. If context is a concern, say so and offer to work from a section.
