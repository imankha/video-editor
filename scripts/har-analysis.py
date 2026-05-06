#!/usr/bin/env python3
"""
HAR file performance analyzer.

Usage:
    python har-analysis.py <har-file> [--output <analysis.json>] [--viz <viz-data.json>]

Parses a HAR file and produces:
1. Structured analysis JSON with slow requests, caching issues, compression gaps, etc.
2. Visualization JSON compatible with the visualize skill (viz-data.json)
"""

import json
import sys
import os
import argparse
from datetime import datetime
from urllib.parse import urlparse


def parse_time(iso_str):
    s = iso_str.replace("Z", "+00:00")
    if "." in s:
        base, rest = s.split(".", 1)
        frac = ""
        tz = ""
        for i, c in enumerate(rest):
            if c in "+-Z":
                tz = rest[i:]
                frac = rest[:i]
                break
        else:
            frac = rest
        frac = frac[:6]
        s = f"{base}.{frac}{tz}"
    return datetime.fromisoformat(s)


def shorten_url(url, max_len=80):
    parsed = urlparse(url)
    host = parsed.hostname or ""
    short = url
    if "fly.dev" in host:
        short = url.replace(f"{parsed.scheme}://{parsed.netloc}", "[API]")
    elif "r2.cloudflarestorage.com" in host:
        short = url.replace(f"{parsed.scheme}://{parsed.netloc}", "[R2]")
    elif "pages.dev" in host:
        short = url.replace(f"{parsed.scheme}://{parsed.netloc}", "[FE]")
    if len(short) > max_len:
        short = short[: max_len - 3] + "..."
    return short


def analyze_har(har_data):
    entries = har_data["log"]["entries"]
    if not entries:
        return {"error": "No entries in HAR file"}

    start_times = [parse_time(e["startedDateTime"]) for e in entries]
    baseline = min(start_times)
    last_end = max(
        (parse_time(e["startedDateTime"]).timestamp() * 1000 + e.get("time", 0))
        for e in entries
    )
    first_start = baseline.timestamp() * 1000

    total_size = sum(e["response"]["content"].get("size", 0) for e in entries)

    summary = {
        "total_requests": len(entries),
        "total_size_kb": round(total_size / 1024, 1),
        "total_time_sum_ms": round(sum(e.get("time", 0) for e in entries)),
        "page_load_time_ms": round(last_end - first_start),
    }

    # --- Slow requests ---
    slow_threshold_ms = 200
    slow_requests = []
    for e in sorted(entries, key=lambda x: x.get("time", 0), reverse=True):
        if e.get("time", 0) < slow_threshold_ms:
            break
        t = e.get("timings", {})
        resp_headers = {
            h["name"].lower(): h["value"] for h in e["response"]["headers"]
        }
        slow_requests.append(
            {
                "url": shorten_url(e["request"]["url"]),
                "full_url": e["request"]["url"],
                "method": e["request"]["method"],
                "status": e["response"]["status"],
                "time_ms": round(e.get("time", 0)),
                "size_kb": round(
                    e["response"]["content"].get("size", 0) / 1024, 1
                ),
                "timings": {
                    "blocked": round(max(t.get("blocked", 0), 0)),
                    "dns": round(max(t.get("dns", 0), 0)),
                    "connect": round(max(t.get("connect", 0), 0)),
                    "ssl": round(max(t.get("ssl", 0), 0)),
                    "send": round(max(t.get("send", 0), 0)),
                    "wait": round(max(t.get("wait", 0), 0)),
                    "receive": round(max(t.get("receive", 0), 0)),
                },
                "cache_control": resp_headers.get("cache-control", "missing"),
                "content_encoding": resp_headers.get("content-encoding", "none"),
            }
        )

    # --- Caching issues ---
    caching_issues = []
    for e in entries:
        if e["request"]["method"] == "OPTIONS":
            continue
        resp_headers = {
            h["name"].lower(): h["value"] for h in e["response"]["headers"]
        }
        cc = resp_headers.get("cache-control", "")
        etag = resp_headers.get("etag", "")
        last_mod = resp_headers.get("last-modified", "")
        mime = e["response"]["content"].get("mimeType", "").split(";")[0]
        status = e["response"]["status"]
        url = shorten_url(e["request"]["url"])

        issues = []
        if status == 200 and not cc:
            issues.append("missing Cache-Control header")
        if "no-store" in cc and mime in (
            "application/javascript",
            "text/css",
            "image/png",
            "image/jpeg",
            "image/svg+xml",
            "font/woff2",
        ):
            issues.append(f"no-store on static asset ({mime})")
        if status == 200 and not etag and not last_mod and cc and "no-store" not in cc:
            issues.append("cacheable but no ETag or Last-Modified for revalidation")
        if issues:
            caching_issues.append({"url": url, "issues": issues, "cache_control": cc or "missing"})

    # --- Compression gaps ---
    compression_gaps = []
    compressible_types = {
        "application/json",
        "text/html",
        "text/css",
        "application/javascript",
        "text/javascript",
        "image/svg+xml",
        "text/plain",
    }
    for e in entries:
        if e["request"]["method"] == "OPTIONS":
            continue
        resp_headers = {
            h["name"].lower(): h["value"] for h in e["response"]["headers"]
        }
        mime = e["response"]["content"].get("mimeType", "").split(";")[0]
        size = e["response"]["content"].get("size", 0)
        encoding = resp_headers.get("content-encoding", "")

        if mime in compressible_types and size > 1024 and not encoding:
            compression_gaps.append(
                {
                    "url": shorten_url(e["request"]["url"]),
                    "mime": mime,
                    "size_kb": round(size / 1024, 1),
                    "potential_savings_kb": round(size / 1024 * 0.6, 1),
                }
            )

    # --- Waterfall ---
    waterfall = []
    for e in sorted(entries, key=lambda x: parse_time(x["startedDateTime"])):
        start = parse_time(e["startedDateTime"])
        offset_ms = (start - baseline).total_seconds() * 1000
        duration = e.get("time", 0)
        waterfall.append(
            {
                "url": shorten_url(e["request"]["url"]),
                "method": e["request"]["method"],
                "status": e["response"]["status"],
                "start_ms": round(offset_ms),
                "end_ms": round(offset_ms + duration),
                "duration_ms": round(duration),
            }
        )

    # --- By content type ---
    by_type = {}
    for e in entries:
        mime = e["response"]["content"].get("mimeType", "unknown").split(";")[0]
        size = e["response"]["content"].get("size", 0)
        time_ms = e.get("time", 0)
        if mime not in by_type:
            by_type[mime] = {"count": 0, "size_kb": 0, "time_ms": 0}
        by_type[mime]["count"] += 1
        by_type[mime]["size_kb"] = round(by_type[mime]["size_kb"] + size / 1024, 1)
        by_type[mime]["time_ms"] = round(by_type[mime]["time_ms"] + time_ms)

    # --- CORS overhead ---
    options_entries = [e for e in entries if e["request"]["method"] == "OPTIONS"]
    cors_overhead = {
        "count": len(options_entries),
        "total_time_ms": round(sum(e.get("time", 0) for e in options_entries)),
        "pct_of_total_time": round(
            sum(e.get("time", 0) for e in options_entries)
            / max(sum(e.get("time", 0) for e in entries), 1)
            * 100,
            1,
        ),
    }

    # --- Redirects ---
    redirects = [
        {
            "url": shorten_url(e["request"]["url"]),
            "status": e["response"]["status"],
            "location": next(
                (
                    h["value"]
                    for h in e["response"]["headers"]
                    if h["name"].lower() == "location"
                ),
                "",
            ),
        }
        for e in entries
        if 300 <= e["response"]["status"] < 400
    ]

    # --- Errors ---
    errors = [
        {
            "url": shorten_url(e["request"]["url"]),
            "status": e["response"]["status"],
            "method": e["request"]["method"],
        }
        for e in entries
        if e["response"]["status"] >= 400
    ]

    # --- Recommendations ---
    recommendations = []

    if slow_requests:
        slowest = slow_requests[0]
        if slowest["timings"]["wait"] > slowest["time_ms"] * 0.5:
            recommendations.append(
                {
                    "priority": "HIGH",
                    "category": "Server Response Time",
                    "detail": f"{slowest['url']} spends {slowest['timings']['wait']}ms waiting for server response ({slowest['time_ms']}ms total). Optimize the backend endpoint.",
                }
            )
        if slowest["timings"]["receive"] > 200:
            recommendations.append(
                {
                    "priority": "HIGH",
                    "category": "Transfer Size",
                    "detail": f"{slowest['url']} spends {slowest['timings']['receive']}ms receiving {slowest['size_kb']}KB. Consider smaller payloads, range requests, or compression.",
                }
            )

    if cors_overhead["count"] > 3:
        recommendations.append(
            {
                "priority": "MEDIUM",
                "category": "CORS Preflight",
                "detail": f"{cors_overhead['count']} preflight requests adding {cors_overhead['total_time_ms']}ms ({cors_overhead['pct_of_total_time']}% of total). Set Access-Control-Max-Age to cache preflight responses.",
            }
        )

    if caching_issues:
        recommendations.append(
            {
                "priority": "MEDIUM",
                "category": "Caching",
                "detail": f"{len(caching_issues)} responses have caching issues. Add appropriate Cache-Control headers.",
                "urls": [c["url"] for c in caching_issues[:5]],
            }
        )

    if compression_gaps:
        total_savings = sum(g["potential_savings_kb"] for g in compression_gaps)
        recommendations.append(
            {
                "priority": "MEDIUM",
                "category": "Compression",
                "detail": f"{len(compression_gaps)} compressible responses lack encoding. ~{total_savings:.0f}KB potential savings with gzip/brotli.",
                "urls": [g["url"] for g in compression_gaps],
            }
        )

    # Check for duplicate requests
    url_counts = {}
    for e in entries:
        if e["request"]["method"] == "OPTIONS":
            continue
        key = f"{e['request']['method']} {e['request']['url']}"
        url_counts[key] = url_counts.get(key, 0) + 1
    dupes = {k: v for k, v in url_counts.items() if v > 1}
    if dupes:
        for url, count in dupes.items():
            method, full_url = url.split(" ", 1)
            recommendations.append(
                {
                    "priority": "MEDIUM",
                    "category": "Duplicate Requests",
                    "detail": f"{method} {shorten_url(full_url)} called {count} times. Deduplicate or cache client-side.",
                }
            )

    if redirects:
        recommendations.append(
            {
                "priority": "LOW",
                "category": "Redirects",
                "detail": f"{len(redirects)} redirect(s) adding unnecessary round trips.",
            }
        )

    recommendations.sort(key=lambda r: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}[r["priority"]])

    return {
        "summary": summary,
        "slow_requests": slow_requests,
        "caching_issues": caching_issues,
        "compression_gaps": compression_gaps,
        "waterfall": waterfall,
        "by_content_type": by_type,
        "cors_overhead": cors_overhead,
        "redirects": redirects,
        "errors": errors,
        "recommendations": recommendations,
    }


def build_viz(analysis):
    panels = []

    # Waterfall chart as a table (Gantt would be ideal but table is more reliable)
    wf = analysis["waterfall"]
    if wf:
        max_end = max(w["end_ms"] for w in wf)
        bar_width = 40

        rows = []
        for w in wf:
            start_pct = w["start_ms"] / max(max_end, 1)
            dur_pct = w["duration_ms"] / max(max_end, 1)
            bar_start = int(start_pct * bar_width)
            bar_len = max(int(dur_pct * bar_width), 1)
            bar = " " * bar_start + "█" * bar_len
            rows.append(
                [
                    f"{w['start_ms']}ms",
                    f"{w['duration_ms']}ms",
                    str(w["status"]),
                    w["method"],
                    w["url"],
                ]
            )

        panels.append(
            {
                "type": "table",
                "title": f"Request Waterfall ({len(wf)} requests, {analysis['summary']['page_load_time_ms']}ms total)",
                "headers": ["Start", "Duration", "Status", "Method", "URL"],
                "rows": rows,
            }
        )

    # Slow requests breakdown
    slow = analysis["slow_requests"]
    if slow:
        labels = [s["url"][:40] for s in slow[:10]]
        wait_data = [s["timings"]["wait"] for s in slow[:10]]
        receive_data = [s["timings"]["receive"] for s in slow[:10]]
        blocked_data = [s["timings"]["blocked"] + s["timings"]["dns"] + s["timings"]["connect"] + s["timings"]["ssl"] for s in slow[:10]]

        panels.append(
            {
                "type": "chart",
                "title": f"Slowest Requests — Timing Breakdown (>{analysis['slow_requests'][0]['time_ms']}ms down to {analysis['slow_requests'][-1]['time_ms']}ms)",
                "config": {
                    "type": "bar",
                    "data": {
                        "labels": labels,
                        "datasets": [
                            {
                                "label": "Connection (blocked+DNS+TLS)",
                                "data": blocked_data,
                                "backgroundColor": "#d29922",
                            },
                            {
                                "label": "Wait (TTFB)",
                                "data": wait_data,
                                "backgroundColor": "#f85149",
                            },
                            {
                                "label": "Receive (download)",
                                "data": receive_data,
                                "backgroundColor": "#58a6ff",
                            },
                        ],
                    },
                    "options": {
                        "indexAxis": "y",
                        "plugins": {"title": {"display": False}},
                        "scales": {
                            "x": {
                                "stacked": True,
                                "title": {"display": True, "text": "Time (ms)"},
                            },
                            "y": {"stacked": True},
                        },
                    },
                },
            }
        )

    # Size by content type
    by_type = analysis["by_content_type"]
    if by_type:
        sorted_types = sorted(by_type.items(), key=lambda x: x[1]["size_kb"], reverse=True)
        colors = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#8b949e", "#f0883e", "#a5d6ff"]
        panels.append(
            {
                "type": "chart",
                "title": f"Transfer Size by Content Type ({analysis['summary']['total_size_kb']}KB total)",
                "config": {
                    "type": "doughnut",
                    "data": {
                        "labels": [f"{t[0]} ({t[1]['size_kb']}KB)" for t in sorted_types],
                        "datasets": [
                            {
                                "data": [t[1]["size_kb"] for t in sorted_types],
                                "backgroundColor": colors[: len(sorted_types)],
                            }
                        ],
                    },
                },
            }
        )

    # Recommendations
    recs = analysis["recommendations"]
    if recs:
        rec_text = ""
        for r in recs:
            icon = {"HIGH": "!!!", "MEDIUM": "!!", "LOW": "!"}[r["priority"]]
            rec_text += f"**[{r['priority']}]** {r['category']}: {r['detail']}\n\n"
            if "urls" in r:
                for u in r["urls"][:3]:
                    rec_text += f"  - `{u}`\n"
                rec_text += "\n"

        panels.append(
            {
                "type": "text",
                "title": f"Recommendations ({len(recs)} findings)",
                "content": rec_text,
            }
        )

    # CORS overhead summary
    cors = analysis["cors_overhead"]
    if cors["count"] > 0:
        panels.append(
            {
                "type": "text",
                "title": "CORS Preflight Overhead",
                "content": f"**{cors['count']} preflight requests** consuming **{cors['total_time_ms']}ms** ({cors['pct_of_total_time']}% of total request time).\n\nSet `Access-Control-Max-Age: 86400` to cache preflight responses for 24h.",
            }
        )

    return {
        "title": f"HAR Performance Analysis — {analysis['summary']['total_requests']} requests, {analysis['summary']['page_load_time_ms']}ms",
        "layout": "stack",
        "panels": panels,
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze HAR file performance")
    parser.add_argument("har_file", help="Path to the HAR file")
    parser.add_argument("--output", "-o", help="Output analysis JSON path", default=None)
    parser.add_argument("--viz", "-v", help="Output viz-data JSON path", default=None)
    args = parser.parse_args()

    temp_dir = os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp"))

    with open(args.har_file, "r", encoding="utf-8") as f:
        har_data = json.load(f)

    analysis = analyze_har(har_data)

    output_path = args.output or os.path.join(temp_dir, "har-analysis.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, indent=2)
    print(f"Analysis written to: {output_path}")

    viz = build_viz(analysis)
    viz_path = args.viz or os.path.join(temp_dir, "viz-data.json")
    with open(viz_path, "w", encoding="utf-8") as f:
        json.dump(viz, f, indent=2)
    print(f"Visualization written to: {viz_path}")

    # Print summary to stdout
    s = analysis["summary"]
    print(f"\n{'='*60}")
    print(f"  {s['total_requests']} requests | {s['total_size_kb']}KB | {s['page_load_time_ms']}ms page load")
    print(f"{'='*60}")

    if analysis["recommendations"]:
        print(f"\nTop recommendations:")
        for r in analysis["recommendations"][:5]:
            print(f"  [{r['priority']}] {r['category']}: {r['detail'][:100]}")

    print(f"\nLaunch visualization: python scripts/visualize.py")


if __name__ == "__main__":
    main()
