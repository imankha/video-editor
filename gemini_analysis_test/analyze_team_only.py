"""Measure the one-team runs saved by run_team_only.py. Prints markdown.

Usage:
    .venv/Scripts/python analyze_team_only.py
"""
import json
import statistics
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "outputs" / "team_only"
PRICE_IN, PRICE_OUT = 1.50 / 1e6, 7.50 / 1e6  # handoff list prices; thinking billed as output


def secs(mmss: str) -> int:
    parts = [int(p) for p in mmss.split(":")]
    return sum(v * 60 ** i for i, v in enumerate(reversed(parts)))


def measure(label: str) -> dict | None:
    row = json.loads((OUT / f"{label}.usage.json").read_text())
    if not row.get("ok"):
        return {"label": label, "ok": False, "error": row.get("error", row.get("status"))}
    answer = json.loads((OUT / f"{label}.json").read_text(encoding="utf-8"))
    u, plays = row["usage"], answer["plays"]
    tin, tout, think = u["total_input_tokens"], u["total_output_tokens"], u.get("total_thought_tokens", 0)
    mod = {m["modality"]: m["tokens"] for m in u.get("input_tokens_by_modality", [])}
    # Some answers count MM:SS from the start of the window, others from the start of the file.
    # For any window after the first the two ranges cannot overlap, so the clock is unambiguous.
    window_clock = bool(plays) and row["start"] > 0 and secs(plays[-1]["end"]) <= row["end"] - row["start"]
    shift = row["start"] if window_clock else 0
    return {
        "label": label, "ok": True, "team": row["team"], "window": f"{row['start']}-{row['end']}",
        "in": tin, "in_by_modality": mod, "answer": tout, "think": think,
        "cost": tin * PRICE_IN + (tout + think) * PRICE_OUT, "seconds": row["seconds"],
        "attempts": row["attempts"],
        "plays": len(plays),
        "highlights": sum(p["team_0"]["relevance"] >= 4 for p in plays),
        "rel_hist": {r: sum(p["team_0"]["relevance"] == r for p in plays) for r in range(6)},
        "player_entries": sum(len(p["team_0"]["players"]) for p in plays),
        "numbered": sum(pl["jersey_number"] is not None for p in plays for pl in p["team_0"]["players"]),
        "first_start": plays[0]["start"] if plays else None,
        "last_end": plays[-1]["end"] if plays else None,
        "clock": "window" if window_clock else "file",
        "gap_to_window_end": row["end"] - (secs(plays[-1]["end"]) + shift) if plays else None,
        "clip_seconds": sum(secs(p["end"]) - secs(p["start"]) for p in plays),
        "team_0": answer["teams"]["team_0"]["color"], "team_1": answer["teams"]["team_1"]["color"],
        "team_1_nonzero": sum(p["team_1"]["relevance"] != 0 or bool(p["team_1"]["players"]) for p in plays),
        "team_0_no_players": [f"{p['start']}-{p['end']}" for p in plays if not p["team_0"]["players"]],
        "team_0_low": [f"{p['start']}-{p['end']} (rel {p['team_0']['relevance']})" for p in plays
                       if p["team_0"]["relevance"] <= 1],
    }


def main():
    labels = sorted(p.name[:-len(".usage.json")] for p in OUT.glob("*.usage.json"))
    rows = [measure(label) for label in labels]
    good = [r for r in rows if r["ok"]]
    print("| Call | Team | Window | Input | Answer | Thinking | Cost | Time | Plays | Rel 4-5 | Last play ends | Clock used | Gap to window end | team_0 / team_1 | team_1 non-empty | team_0 without players |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in good:
        print(f"| {r['label']} | {r['team']} | {r['window']} | {r['in']:,} | {r['answer']:,} | {r['think']:,} | "
              f"${r['cost']:.3f} | {r['seconds']:.0f} s | {r['plays']} | {r['highlights']} | {r['last_end']} | {r['clock']} | "
              f"{r['gap_to_window_end']} s | {r['team_0']} / {r['team_1']} | {r['team_1_nonzero']} | "
              f"{len(r['team_0_no_players'])} |")
    for r in rows:
        if not r["ok"]:
            print(f"\nFAILED {r['label']}: {r['error']}")
    print()
    for r in good:
        print(f"{r['label']}: first play {r['first_start']}, relevance histogram {r['rel_hist']}, "
              f"player entries {r['player_entries']} ({r['numbered']} numbered), clip seconds {r['clip_seconds']}, "
              f"input by modality {r['in_by_modality']}, attempts {r['attempts']}, low relevance {r['team_0_low']}")
    a = [r for r in good if r["team"] == "A"]
    if a:
        print(f"\nTeam A calls: {len(a)}")
        for key in ("in", "answer", "think", "cost", "seconds", "plays", "highlights"):
            v = [r[key] for r in a]
            sd = statistics.stdev(v) if len(v) > 1 else 0
            print(f"  {key}: mean {statistics.mean(v):,.3f}, range {min(v):,} to {max(v):,}, sd {sd:,.3f}")


if __name__ == "__main__":
    main()
