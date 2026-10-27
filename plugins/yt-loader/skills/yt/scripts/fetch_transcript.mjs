#!/usr/bin/env node
// Fetch a YouTube transcript and print it as text for Claude to read.
// Zero dependencies: Node 18+ (built-in fetch), which Claude Code already requires.
//
// Usage: fetch_transcript.mjs <url-or-id> [--timestamps] [--lang en,es] [--no-cache]
//
// The fetch logic lives in ../../../lib/transcript.mjs, shared with the MCP server.

import { fetchTranscript, formatTranscript, videoId, explainFetchError } from "../../../lib/transcript.mjs";

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const video = args.find((a) => !a.startsWith("--"));
  if (!video) die("Usage: fetch_transcript.mjs <url-or-id> [--timestamps] [--lang en,es] [--no-cache]");
  const timestamps = args.includes("--timestamps");
  const noCache = args.includes("--no-cache");
  const li = args.indexOf("--lang");
  const langs = (li >= 0 ? args[li + 1] : "en").split(",").map((s) => s.trim()).filter(Boolean);

  let d;
  try {
    d = await fetchTranscript(videoId(video), langs, !noCache);
  } catch (e) {
    die(`No transcript available: ${explainFetchError(e)}`);
  }
  process.stdout.write(formatTranscript(d, { timestamps }));
}

main();
