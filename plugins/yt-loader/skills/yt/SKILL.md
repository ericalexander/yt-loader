---
name: yt
description: Pull a YouTube video's transcript into context and summarize it. Use when the user gives a YouTube link or video id (youtube.com, youtu.be, shorts) and wants a summary, notes, or to ask questions about what was said. Invoked as /yt <url> or whenever a YouTube link appears with a question about its content.
---

# YouTube transcript

Fetch the transcript with the bundled script, read it, then answer.

## Steps

1. Run the fetcher (it caches, so re-runs are free):

   ```
   node ${CLAUDE_PLUGIN_ROOT}/skills/yt/scripts/fetch_transcript.mjs "<url or id>"
   ```

   Add `--timestamps` when the user wants timestamps, chapters, or "where in the video"
   answers. Add `--lang es,en` etc. for non-English preference. No dependencies; it
   runs on the Node that Claude Code already uses.

2. The full transcript is now in context. Keep it there; do not summarize it away or
   re-fetch for follow-up questions in the same session.

3. Default output, unless the user asked for something specific:
   - One line: title, channel, length.
   - A summary of 5–10 bullets covering the actual claims and content, not "the speaker
     discusses X." Write what was said.
   - Any concrete numbers, names, tools, or recommendations called out in the video.
   - End with: "Transcript loaded — ask me anything about it."

4. For follow-ups, answer from the transcript already in context. Quote short phrases
   when helpful. If the user asks where something was said and you fetched without
   `--timestamps`, re-run with the flag (cache makes this instant).

## Notes

- Auto-generated captions have no punctuation and misspell names. Say so when it affects
  accuracy; don't pretend the transcript is cleaner than it is.
- If no transcript exists (captions disabled, music video, private video), say that
  plainly. Do not guess at the video's content from the title.
- Long videos (2h+ podcasts) can be 30k+ words. That still fits; load it rather than
  truncating. If context is a concern, say so and offer to work from a section.
