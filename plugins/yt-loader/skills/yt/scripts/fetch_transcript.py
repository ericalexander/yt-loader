#!/usr/bin/env python3
"""Fetch a YouTube transcript and print it as text for Claude to read.

Usage:
  fetch_transcript.py <url-or-id> [--timestamps] [--lang en,es] [--no-cache]

Output goes to stdout. Transcripts are cached in ~/.cache/yt-transcript/<id>.json
so repeat lookups in the same or later sessions don't hit YouTube again.
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path.home() / ".cache" / "yt-transcript"


def video_id(s: str) -> str:
    s = s.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    u = urllib.parse.urlparse(s)
    host = (u.hostname or "").lower()
    if host in ("youtu.be", "www.youtu.be"):
        return u.path.strip("/").split("/")[0]
    if "youtube" in host:
        q = urllib.parse.parse_qs(u.query)
        if "v" in q:
            return q["v"][0]
        m = re.search(r"/(?:shorts|embed|live|v)/([A-Za-z0-9_-]{11})", u.path)
        if m:
            return m.group(1)
    sys.exit(f"Could not find a video id in: {s}")


def title_for(vid: str) -> str:
    try:
        url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(
            f"https://www.youtube.com/watch?v={vid}", safe=""
        )
        with urllib.request.urlopen(url, timeout=10) as r:
            d = json.load(r)
        return f"{d.get('title', '')} — {d.get('author_name', '')}".strip(" —")
    except Exception:
        return ""


def fetch(vid: str, langs, use_cache: bool) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{vid}.json"
    if use_cache and f.exists():
        return json.loads(f.read_text())

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        sys.exit("Missing dependency. Run: pip install youtube-transcript-api")

    api = YouTubeTranscriptApi()
    try:
        t = api.fetch(vid, languages=langs)
    except Exception as e:
        # Fall back to any available transcript (incl. auto-generated / translated)
        try:
            tl = api.list(vid)
            t = next(iter(tl)).fetch()
        except Exception as e2:
            sys.exit(f"No transcript available for {vid}: {e2}")

    data = {
        "id": vid,
        "url": f"https://www.youtube.com/watch?v={vid}",
        "title": title_for(vid),
        "language": getattr(t, "language", ""),
        "generated": getattr(t, "is_generated", None),
        "segments": [{"t": round(s.start, 1), "text": s.text} for s in t],
    }
    f.write_text(json.dumps(data))
    return data


def fmt_ts(sec: float) -> str:
    sec = int(sec)
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--timestamps", action="store_true", help="one line per ~30s block with a timestamp")
    p.add_argument("--lang", default="en", help="comma-separated preference order")
    p.add_argument("--no-cache", action="store_true")
    a = p.parse_args()

    d = fetch(video_id(a.video), [x.strip() for x in a.lang.split(",")], not a.no_cache)
    segs = d["segments"]
    dur = fmt_ts(segs[-1]["t"]) if segs else "?"
    words = sum(len(s["text"].split()) for s in segs)

    print(f"# {d['title'] or d['id']}")
    print(f"{d['url']}  |  ~{dur}  |  ~{words} words  |  lang={d['language']}"
          f"{' (auto-generated)' if d['generated'] else ''}")
    print()

    if a.timestamps:
        block, start = [], None
        for s in segs:
            if start is None:
                start = s["t"]
            block.append(s["text"])
            if s["t"] - start >= 30:
                print(f"[{fmt_ts(start)}] {' '.join(block)}")
                block, start = [], None
        if block:
            print(f"[{fmt_ts(start)}] {' '.join(block)}")
    else:
        text = " ".join(s["text"] for s in segs)
        # Break into readable paragraphs roughly every 120 words
        w = text.split()
        for i in range(0, len(w), 120):
            print(" ".join(w[i:i + 120]))
            print()


if __name__ == "__main__":
    main()
