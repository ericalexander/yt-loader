// TikTok transcript fetcher. Zero dependencies: Node 18+ built-in fetch.
//
// How it works (same data the TikTok web page renders from):
//   1. GET the video page (following vm.tiktok.com / tiktok.com/t/ short-link redirects).
//   2. Read the JSON in <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">; the post lives at
//      __DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.
//   3. Pick a caption track from video.claInfo.captionInfos (or video.subtitleInfos) and GET
//      its WebVTT. The URLs are signed and expire, so nothing is reused across runs except
//      the parsed transcript, which caches like YouTube's.
//
// TikTok has no manual captions in this data; every track is ASR ("auto-generated").
// Caption data was confirmed against live pages in Oct 2026; if TikTok changes its page,
// the parser will throw a clear "could not read" error rather than guess.

import { UA, decodeEntities } from "./transcript.mjs";

const HOSTS = /(^|\.)tiktok\.com$/i;

export function isTikTok(s) {
  try {
    return HOSTS.test(new URL(s.trim()).hostname);
  } catch {
    return false;
  }
}

function idFromUrl(u) {
  return u.pathname.match(/\/(?:video|photo)\/(\d{6,})/)?.[1] ?? null;
}

async function get(url, opts = {}) {
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(opts.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return { text: await r.text(), url: r.url };
}

export async function tiktokPage(input) {
  const { text: html, url: finalUrl } = await get(input);
  const id = idFromUrl(new URL(finalUrl));
  if (!id) throw new Error(`Not a TikTok video link (resolved to ${finalUrl}).`);
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s);
  if (!m) throw new Error("Could not read the TikTok page data (TikTok may have changed its page, or blocked this IP).");
  let scope;
  try {
    scope = JSON.parse(m[1]).__DEFAULT_SCOPE__;
  } catch {
    throw new Error("Could not parse the TikTok page data.");
  }
  const detail = scope?.["webapp.video-detail"];
  const status = detail?.statusCode;
  if (status !== 0 || !detail?.itemInfo?.itemStruct) {
    const why = detail?.statusMsg || { 10204: "video unavailable", 10216: "video is private", 10222: "video is private" }[status] || `status ${status}`;
    throw new Error(`TikTok video not available (${why}).`);
  }
  return { id, url: finalUrl.split("?")[0], item: detail.itemInfo.itemStruct };
}

// Normalize every caption source into { lang, code, format, url, generated }.
function tracks(item) {
  const out = [];
  for (const c of item.video?.claInfo?.captionInfos ?? []) {
    const url = c.url || c.urlList?.[0];
    if (url) out.push({ lang: c.language, code: c.languageCode, format: c.captionFormat, url, generated: c.isAutoGen !== false });
  }
  if (!out.length) {
    for (const s of item.video?.subtitleInfos ?? []) {
      if (s.Url) out.push({ lang: s.LanguageCodeName, code: String(s.LanguageCodeName ?? "").split("-")[0].slice(0, 2), format: s.Format, url: s.Url, generated: true });
    }
  }
  return out.filter((t) => /vtt/i.test(t.format ?? "webvtt"));
}

function pickTrack(ts, langs) {
  for (const l of langs) {
    const hit = ts.find((t) => t.code === l || String(t.lang ?? "").toLowerCase().startsWith(l.toLowerCase()));
    if (hit) return hit;
  }
  return ts[0];
}

function vttSeconds(ts) {
  const p = ts.trim().split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

export function parseVtt(vtt) {
  const segments = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const start = vttSeconds(lines[i].split("-->")[0]);
    const text = decodeEntities(lines.slice(i + 1).join(" ")).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) segments.push({ t: Math.round(start * 10) / 10, text });
  }
  return segments;
}

// Returns the same shape as fetchTranscript() in transcript.mjs.
export async function fetchTikTok(input, langs) {
  const { id, url, item } = await tiktokPage(input);
  const ts = tracks(item);
  if (!ts.length) {
    const why = item.video?.claInfo?.noCaptionReason;
    throw new Error(`This TikTok has no captions${why ? ` (${why})` : ""}.`);
  }
  const track = pickTrack(ts, langs);
  const { text: vtt } = await get(track.url);
  const segments = parseVtt(vtt);
  if (!segments.length) throw new Error("Caption track was empty.");

  const a = item.author ?? {};
  const who = [a.nickname, a.uniqueId ? `@${a.uniqueId}` : null].filter(Boolean).join(" ");
  return {
    id,
    url,
    title: [item.desc?.trim() || `TikTok ${id}`, who].filter(Boolean).join(" — "),
    lengthSeconds: Number(item.video?.duration) || null,
    language: track.lang ?? track.code,
    generated: track.generated,
    segments,
  };
}
