#!/usr/bin/env node
// yt-loader MCP server: exposes `youtube_transcript` over stdio.
//
// Why this exists: the /yt skill runs its fetch script wherever Claude's shell is.
// In Claude's cloud sandbox (and the desktop app's sandboxed VM) youtube.com is
// blocked by an egress proxy. A local MCP server launched by the Claude desktop app
// runs on the user's own machine with normal network access, so the same fetch
// succeeds there and the transcript comes back as a tool result.
//
// Zero dependencies. Implements the subset of MCP (2024-11-05) that tool serving
// needs: initialize, ping, tools/list, tools/call. Newline-delimited JSON-RPC.

import { createInterface } from "node:readline";
import { fetchTranscript, formatTranscript, videoId, explainFetchError } from "../lib/transcript.mjs";

const SERVER = { name: "yt-loader", version: "0.2.0" };
const PROTOCOL = "2024-11-05";

const TOOLS = [
  {
    name: "youtube_transcript",
    description:
      "Fetch a YouTube video's captions (manual preferred, else auto-generated) and return them as text " +
      "with the title, channel and length. Works for youtube.com/watch, youtu.be and Shorts links or a bare " +
      "11-character video id. Runs on the user's own machine, so it works even when the sandbox cannot reach youtube.com.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "YouTube URL or 11-character video id." },
        timestamps: {
          type: "boolean",
          description: "Group the text into ~30-second blocks prefixed with [m:ss]. Default false (plain paragraphs).",
        },
        lang: {
          type: "string",
          description: "Comma-separated language preference, e.g. \"es,en\". Default \"en\".",
        },
        no_cache: { type: "boolean", description: "Bypass ~/.cache/yt-transcript and refetch." },
      },
      required: ["url"],
    },
  },
];

async function callTool(name, args = {}) {
  if (name !== "youtube_transcript") throw new Error(`Unknown tool: ${name}`);
  const langs = String(args.lang ?? "en").split(",").map((s) => s.trim()).filter(Boolean);
  let d;
  try {
    d = await fetchTranscript(videoId(String(args.url ?? "")), langs, !args.no_cache);
  } catch (e) {
    return { content: [{ type: "text", text: `No transcript available: ${explainFetchError(e)}` }], isError: true };
  }
  return { content: [{ type: "text", text: formatTranscript(d, { timestamps: !!args.timestamps }) }] };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(req) {
  const { id, method, params } = req;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return reply(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER });
    case "notifications/initialized":
    case "notifications/cancelled":
      return; // nothing to do
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      try {
        return reply(id, await callTool(params?.name, params?.arguments));
      } catch (e) {
        return reply(id, { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true });
      }
    }
    default:
      if (!isNotification) fail(id, -32601, `Method not found: ${method}`);
  }
}

let inFlight = 0;
let closed = false;
function maybeExit() {
  if (closed && inFlight === 0) process.exit(0);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  inFlight++;
  handle(req)
    .catch((e) => fail(req.id ?? null, -32603, String(e?.message ?? e)))
    .finally(() => {
      inFlight--;
      maybeExit();
    });
});
rl.on("close", () => {
  closed = true;
  maybeExit();
});
