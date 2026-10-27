#!/usr/bin/env node
// Fetch a YouTube transcript and print it as text for Claude to read.
// Zero dependencies: Node 18+ (built-in fetch), which Claude Code already requires.
//
// Usage: fetch_transcript.mjs <url-or-id> [--timestamps] [--lang en,es] [--no-cache]
//
// How it works (same path the YouTube web player uses):
//   1. GET the watch page to pick up the InnerTube API key.
//   2. POST youtubei/v1/player as the Android client to get captionTracks + title.
//   3. GET the chosen track's baseUrl (timed-text XML) and flatten it.
// Transcripts cache in ~/.cache/yt-transcript/<id>.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE = join(homedir(), ".cache", "yt-transcript");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function videoId(s) {
  s = s.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u;
  try {
    u = new URL(s);
  } catch {
    die(`Could not find a video id in: ${s}`);
  }
  const host = u.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") return u.pathname.split("/").filter(Boolean)[0];
  if (host.includes("youtube")) {
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  die(`Could not find a video id in: ${s}`);
}

function decodeEntities(t) {
  return t
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
}

async function playerResponse(vid) {
  const html = await get(`https://www.youtube.com/watch?v=${vid}`, { Cookie: "CONSENT=YES+" });
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  let pr = null;
  if (key) {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } },
        videoId: vid,
      }),
    });
    if (r.ok) pr = await r.json();
  }
  // Fall back to the player response embedded in the watch page.
  if (!pr?.captions) {
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
    if (m) {
      try {
        pr = JSON.parse(m[1]);
      } catch {}
    }
  }
  if (!pr) throw new Error("Could not read the player response (YouTube may have changed its page, or blocked this IP).");
  return pr;
}

function pickTrack(tracks, langs) {
  // Prefer manual over auto-generated within each requested language, in preference order.
  for (const l of langs) {
    const manual = tracks.find((t) => t.languageCode === l && t.kind !== "asr");
    if (manual) return manual;
    const auto = tracks.find((t) => t.languageCode === l);
    if (auto) return auto;
  }
  return tracks[0];
}

async function fetchTranscript(vid, langs, useCache) {
  await mkdir(CACHE, { recursive: true });
  const f = join(CACHE, `${vid}.json`);
  if (useCache) {
    try {
      return JSON.parse(await readFile(f, "utf8"));
    } catch {}
  }

  const pr = await playerResponse(vid);
  const status = pr.playabilityStatus?.status;
  if (status && status !== "OK") {
    throw new Error(`Video not playable (${status}): ${pr.playabilityStatus?.reason ?? ""}`);
  }
  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) throw new Error("This video has no captions (manual or auto-generated).");

  const track = pickTrack(tracks, langs);
  const xml = await get(track.baseUrl.replace(/&fmt=\w+/, ""));
  const segments = [];
  for (const m of xml.matchAll(/<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>(.*?)<\/text>/gs)) {
    const text = decodeEntities(m[3]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) segments.push({ t: Math.round(Number(m[1]) * 10) / 10, text });
  }
  if (!segments.length) throw new Error("Caption track was empty.");

  const vd = pr.videoDetails ?? {};
  const data = {
    id: vid,
    url: `https://www.youtube.com/watch?v=${vid}`,
    title: [vd.title, vd.author].filter(Boolean).join(" — "),
    lengthSeconds: Number(vd.lengthSeconds) || null,
    language: track.name?.simpleText ?? track.name?.runs?.[0]?.text ?? track.languageCode,
    generated: track.kind === "asr",
    segments,
  };
  await writeFile(f, JSON.stringify(data));
  return data;
}

function fmtTs(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
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
    die(`No transcript available: ${e.message}`);
  }

  const segs = d.segments;
  const dur = fmtTs(d.lengthSeconds ?? segs[segs.length - 1].t);
  const words = segs.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  const out = [];
  out.push(`# ${d.title || d.id}`);
  out.push(`${d.url}  |  ${dur}  |  ~${words} words  |  lang=${d.language}${d.generated ? " (auto-generated)" : ""}`);
  out.push("");

  if (timestamps) {
    let block = [], start = null;
    for (const s of segs) {
      if (start === null) start = s.t;
      block.push(s.text);
      if (s.t - start >= 30) {
        out.push(`[${fmtTs(start)}] ${block.join(" ")}`);
        block = []; start = null;
      }
    }
    if (block.length) out.push(`[${fmtTs(start)}] ${block.join(" ")}`);
  } else {
    const w = segs.map((s) => s.text).join(" ").split(/\s+/);
    for (let i = 0; i < w.length; i += 120) out.push(w.slice(i, i + 120).join(" "), "");
  }
  process.stdout.write(out.join("\n") + "\n");
}

main();
