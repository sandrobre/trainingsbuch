"""Claude coach: analyse all training + health data and write data/insights.json.

Environment:
    ANTHROPIC_API_KEY   required
    TRIGGER             why the analysis runs (garmin-sync, manual-entry, button, question)
    QUESTION            optional question from the app's coach chat
    CLAUDE_MODEL        default claude-opus-5-5
    COACH_EFFORT        low | medium | high | xhigh | max (default medium)
    DRY_RUN=1           print the prompt instead of calling the API
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import date, timedelta
from statistics import mean
from typing import Any

import anthropic

from common import SPORT_LABELS, iso_today, merged_activities, now_iso, read_json, write_json

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("COACH_EFFORT", "medium")

# Typical session RPE per sport when the user did not rate the session.
DEFAULT_RPE = {"run": 5, "football": 6, "strength": 5, "cycle": 4, "swim": 5, "hiit": 7, "mobility": 2, "walk": 2, "other": 4}

SPORT_ENUM = list(SPORT_LABELS) + ["rest"]
TIP = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Kurzer, konkreter Titel (max. 8 Wörter)"},
        "detail": {"type": "string", "description": "1-3 Sätze: was genau, wie oft, warum – bezogen auf die Daten"},
        "priority": {"type": "string", "enum": ["hoch", "mittel", "niedrig"]},
    },
    "required": ["title", "detail", "priority"],
    "additionalProperties": False,
}
SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "2-4 Sätze Gesamteinschätzung der aktuellen Form"},
        "readiness": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "description": "0-100, Bereitschaft für hartes Training heute"},
                "label": {"type": "string", "description": "1-3 Wörter, z.B. 'Bereit für Tempo'"},
                "reasoning": {"type": "string"},
            },
            "required": ["score", "label", "reasoning"],
            "additionalProperties": False,
        },
        "load": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["zu niedrig", "aufbauend", "optimal", "hoch", "zu hoch"]},
                "comment": {"type": "string"},
            },
            "required": ["status", "comment"],
            "additionalProperties": False,
        },
        "running": {"type": "array", "items": TIP, "description": "2-4 Tipps, um im Laufen besser zu werden"},
        "football": {"type": "array", "items": TIP, "description": "2-4 Tipps für Fussball-Fitness (Sprints, Richtungswechsel, Wiederholungsfähigkeit)"},
        "recovery": {"type": "array", "items": TIP, "description": "1-3 Tipps zu Schlaf, Regeneration, Verletzungsprävention"},
        "warnings": {"type": "array", "items": {"type": "string"}, "description": "Nur echte Warnsignale, sonst leer"},
        "plan": {
            "type": "array",
            "description": "Vorschlag für die nächsten 7 Tage ab heute, ein Eintrag pro Tag",
            "items": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "type": {"type": "string", "enum": SPORT_ENUM},
                    "title": {"type": "string"},
                    "durationMin": {"type": "integer"},
                    "intensity": {"type": "string", "enum": ["Ruhe", "locker", "mittel", "hart"]},
                    "details": {"type": "string", "description": "Konkreter Ablauf, z.B. 10' einlaufen, 6x400m @4:15, 2' Trabpause"},
                },
                "required": ["date", "type", "title", "durationMin", "intensity", "details"],
                "additionalProperties": False,
            },
        },
        "answer": {"type": "string", "description": "Antwort auf die Frage des Athleten, leer wenn keine Frage"},
    },
    "required": ["summary", "readiness", "load", "running", "football", "recovery", "warnings", "plan", "answer"],
    "additionalProperties": False,
}

SYSTEM = """Du bist ein erfahrener Lauf- und Fussball-Konditionstrainer und Sportwissenschaftler.
Du betreust einen einzelnen Hobby-/Amateursportler, der seine Garmin-Daten und zusätzliche, manuell
erfasste Trainings (z.B. Fussballtraining, Matches, Krafttraining) mit dir teilt.

Deine Aufgabe: Analysiere die Daten ehrlich und konkret und gib umsetzbare Empfehlungen, damit er
(1) im Laufen schneller und ausdauernder wird und (2) auf dem Fussballplatz fitter ist (Sprintfähigkeit,
Wiederholungssprints, Richtungswechsel, Ausdauer über 90 Minuten) – ohne sich zu überlasten.

Grundsätze:
- Beziehe dich auf konkrete Zahlen aus den Daten (Pace, Puls, Umfang, HRV, Schlaf, Belastung).
- Berücksichtige Erholung: niedrige HRV, schlechter Schlaf, hoher Ruhepuls oder ACWR > 1.3 → Belastung reduzieren.
- Plane Fussballtermine (Training/Match) als feste Belastung ein; keine harten Lauf-Intervalle am Vortag eines Matches.
- Der Wochenplan muss zu den angegebenen Trainingstagen, Zielen und Einschränkungen passen.
- Gib Intensitäten konkret an (Pace in min/km, Herzfrequenzbereiche oder RPE).
- Bei Schmerzen oder Verletzungsverdacht: zur ärztlichen Abklärung raten, keine Diagnose stellen.
- Schreibe auf Deutsch in Schweizer Rechtschreibung (ss statt ß), direkt und motivierend, in der Du-Form."""


def day_offset(iso: str) -> int:
    return (date.today() - date.fromisoformat(iso[:10])).days


def session_load(a: dict) -> float:
    """Session-RPE load (minutes x RPE) so Garmin and manual sessions are comparable."""
    rpe = a.get("rpe") or DEFAULT_RPE.get(a.get("type", "other"), 4)
    if a.get("type") == "football" and (a.get("football") or {}).get("kind") == "match" and not a.get("rpe"):
        rpe = 7
    return (a.get("durationMin") or 0) * rpe


def avg(values: list[Any]) -> float | None:
    clean = [v for v in values if isinstance(v, (int, float))]
    return round(mean(clean), 1) if clean else None


def compute_metrics(acts: list[dict], daily: list[dict]) -> dict:
    in_days = lambda lo, hi: [a for a in acts if a.get("date") and lo <= day_offset(a["date"]) < hi]

    acute = sum(session_load(a) for a in in_days(0, 7))
    chronic_weekly = sum(session_load(a) for a in in_days(0, 28)) / 4
    weeks = []
    for w in range(6):
        week_acts = in_days(w * 7, w * 7 + 7)
        per_sport: dict[str, float] = defaultdict(float)
        for a in week_acts:
            per_sport[a.get("type", "other")] += a.get("durationMin") or 0
        weeks.append({
            "wocheVorHeute": w,
            "einheiten": len(week_acts),
            "minutenProSport": {SPORT_LABELS.get(k, k): round(v) for k, v in per_sport.items()},
            "laufKm": round(sum(a.get("distanceKm") or 0 for a in week_acts if a.get("type") == "run"), 1),
            "belastung": round(sum(session_load(a) for a in week_acts)),
        })

    def run_block(lo: int, hi: int) -> dict:
        runs = [a for a in in_days(lo, hi) if a.get("type") == "run"]
        paced = [a for a in runs if a.get("paceSecPerKm")]
        return {
            "laeufe": len(runs),
            "km": round(sum(a.get("distanceKm") or 0 for a in runs), 1),
            "laengsterLaufKm": max((a.get("distanceKm") or 0 for a in runs), default=0),
            "durchschnittsPaceSecPerKm": avg([a["paceSecPerKm"] for a in paced]),
            "durchschnittsPuls": avg([a.get("avgHr") for a in runs]),
        }

    def football_block(lo: int, hi: int) -> dict:
        sessions = [a for a in in_days(lo, hi) if a.get("type") == "football"]
        return {
            "einheiten": len(sessions),
            "matches": sum(1 for a in sessions if (a.get("football") or {}).get("kind") == "match"),
            "minuten": round(sum(a.get("durationMin") or 0 for a in sessions)),
        }

    def health_block(lo: int, hi: int) -> dict:
        days = [d for d in daily if lo <= day_offset(d["date"]) < hi]
        return {k: avg([d.get(k) for d in days]) for k in ("restingHr", "hrv", "sleepH", "sleepScore", "bodyBatteryHigh", "stress")}

    return {
        "belastung": {
            "akut7Tage": round(acute),
            "chronischProWoche28Tage": round(chronic_weekly),
            "acwr": round(acute / chronic_weekly, 2) if chronic_weekly else None,
            "hinweis": "Belastung = Minuten x RPE (Session-RPE); ACWR 0.8-1.3 gilt als günstiger Bereich",
        },
        "wochen": weeks,
        "laufen": {"letzte28Tage": run_block(0, 28), "vorherige28Tage": run_block(28, 56)},
        "fussball": {"letzte28Tage": football_block(0, 28), "vorherige28Tage": football_block(28, 56)},
        "gesundheit": {"letzte7Tage": health_block(0, 7), "vorherige21Tage": health_block(7, 28)},
    }


def compact_activity(a: dict) -> dict:
    keys = ("date", "type", "title", "durationMin", "distanceKm", "paceSecPerKm", "avgHr", "maxHr",
            "trainingLoad", "aerobicTE", "anaerobicTE", "hrZonesMin", "rpe", "feeling", "notes", "football", "source")
    return {k: a[k] for k in keys if a.get(k) not in (None, "", [], {})}


def build_prompt(garmin: dict, manual: dict, profile: dict, previous: dict, question: str) -> str:
    acts = merged_activities(garmin, manual)
    daily = garmin.get("daily", [])
    recent_acts = [compact_activity(a) for a in acts if a.get("date") and day_offset(a["date"]) < 42]
    recent_daily = [d for d in daily if day_offset(d["date"]) < 21]
    last = previous.get("analysis") or {}

    sections = {
        "heute": f"{iso_today()} ({date.today().strftime('%A')})",
        "athletenprofil": profile or "nicht ausgefüllt",
        "kennzahlen": compute_metrics(acts, daily),
        "garminSnapshot": garmin.get("snapshot", {}),
        "aktivitaetenLetzte42Tage": recent_acts,
        "gesundheitLetzte21Tage": recent_daily,
        "letzteAnalyse": {"datum": previous.get("generatedAt"), "zusammenfassung": last.get("summary"),
                           "plan": last.get("plan")} if last else None,
    }
    prompt = "Hier sind meine aktuellen Daten als JSON:\n\n" + json.dumps(sections, ensure_ascii=False, indent=1)
    prompt += "\n\nErstelle deine Analyse und den Plan für die nächsten 7 Tage (ab heute)."
    if question:
        prompt += f"\n\nMeine Frage an dich (beantworte sie im Feld 'answer'):\n{question}"
    return prompt


def main() -> None:
    trigger = os.environ.get("TRIGGER") or "manual"
    question = (os.environ.get("QUESTION") or "").strip()[:2000]

    garmin = read_json("garmin.json", {})
    manual = read_json("manual.json", {})
    profile = read_json("profile.json", {})
    insights = read_json("insights.json", {})

    prompt = build_prompt(garmin, manual, profile, insights, question)
    if os.environ.get("DRY_RUN"):
        print(SYSTEM, "\n\n", prompt)
        return

    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
            # Re-run on Anthropic's recommended model if a safety classifier declines the request.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError as err:
        sys.exit(f"Claude API Rate-Limit – später erneut versuchen ({err.message}).")
    except anthropic.APIStatusError as err:
        sys.exit(f"Claude API Fehler {err.status_code}: {err.message}")
    except anthropic.APIConnectionError:
        sys.exit("Keine Verbindung zur Claude API.")

    if response.stop_reason == "refusal":
        sys.exit("Claude hat die Analyse abgelehnt (refusal).")
    if response.stop_reason == "max_tokens":
        sys.exit("Antwort wurde abgeschnitten (max_tokens) – COACH_EFFORT senken oder max_tokens erhöhen.")

    text = next(b.text for b in response.content if b.type == "text")
    analysis = json.loads(text)

    history = insights.get("history", [])
    if insights.get("analysis"):
        old = insights["analysis"]
        history = [{"at": insights.get("generatedAt"), "summary": old.get("summary"),
                    "readiness": (old.get("readiness") or {}).get("score")}] + history
    qa = insights.get("qa", [])
    if question:
        qa = [{"question": question, "answer": analysis.get("answer", ""), "at": now_iso()}] + qa

    write_json("insights.json", {
        "generatedAt": now_iso(),
        "model": response.model,
        "trigger": trigger,
        "analysis": analysis,
        "qa": qa[:30],
        "history": history[:20],
    })
    usage = response.usage
    print(f"Analyse gespeichert ({response.model}, {usage.input_tokens} in / {usage.output_tokens} out Tokens).")


if __name__ == "__main__":
    main()
