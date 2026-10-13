"""Claude coach: analyse all training + health data and write data/insights.json.

Environment:
    ANTHROPIC_API_KEY   required
    TRIGGER             why the analysis runs (garmin-sync, manual-entry, button, question)
    QUESTION            optional question (the app stores it in data/question.json instead,
                        because workflow inputs are visible in public Actions logs)
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
from pathlib import Path
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
PLAN_ITEM = {
    "date": {"type": "string", "description": "YYYY-MM-DD"},
    "type": {"type": "string", "enum": SPORT_ENUM},
    "title": {"type": "string"},
    "durationMin": {"type": "integer"},
    "intensity": {"type": "string", "enum": ["Ruhe", "locker", "mittel", "hart"]},
    "details": {"type": "string", "description": "Konkreter Ablauf, z.B. 10' einlaufen, 6x400m @4:15 oder Kniebeuge 3x5 @ 85 kg"},
}


def build_schema(nutrition: bool) -> dict:
    """JSON schema for the structured answer; the nutrition fields only exist when the user enabled them."""
    plan_props = dict(PLAN_ITEM)
    if nutrition:
        plan_props["nutrition"] = {"type": "string", "description": "Ernährungs-Faustregel für diesen Tag, 1-2 Sätze"}
    props: dict[str, Any] = {
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
        "focus": {
            "type": "array",
            "description": "2-4 Tipp-Bereiche passend zu Zielen und Sportarten, wichtigster zuerst",
            "items": {
                "type": "object",
                "properties": {
                    "area": {"type": "string", "description": "Emoji + 1-2 Wörter, z.B. '🏃 Ausdauer', '🏋️ Kraft', '😴 Erholung'"},
                    "tips": {"type": "array", "items": TIP, "description": "1-4 Tipps"},
                },
                "required": ["area", "tips"],
                "additionalProperties": False,
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}, "description": "Nur echte Warnsignale, sonst leer"},
        "plan": {
            "type": "array",
            "description": "Vorschlag für die nächsten 7 Tage ab heute, ein Eintrag pro Tag",
            "items": {"type": "object", "properties": plan_props, "required": list(plan_props), "additionalProperties": False},
        },
        "answer": {"type": "string", "description": "Antwort auf die Frage, leer wenn keine Frage"},
    }
    if nutrition:
        props["nutrition"] = {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "1-2 Sätze: worauf es diese Woche bei der Ernährung ankommt"},
                "tips": {"type": "array", "items": TIP, "description": "2-4 Faustregeln"},
            },
            "required": ["summary", "tips"],
            "additionalProperties": False,
        }
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


FOCUS_LABELS = {
    "endurance": "Ausdauer", "speed": "Schnelligkeit & Sprint", "strength": "Maximalkraft",
    "hypertrophy": "Muskelaufbau", "weight_loss": "Gewicht reduzieren", "injury_prevention": "Verletzungsprävention",
    "match_fitness": "Matchfitness", "general": "Allgemeine Fitness", "race_time": "Wettkampfzeit Laufen",
    "mobility": "Beweglichkeit", "swim": "Schwimmen verbessern", "health": "Gesundheit & Wohlbefinden",
    "consistency": "Regelmässig trainieren",
}
WEEKLY_LABELS = {"run": "Läufe", "strength": "Krafteinheiten", "swim": "Schwimmeinheiten", "cycle": "Radeinheiten",
                 "mobility": "Mobility/Dehnen", "football": "Fussballeinheiten", "walk": "Wanderungen", "hiit": "HIIT-Einheiten"}
SUPERVISOR = os.environ.get("SUPERVISOR", "on").lower() not in ("off", "0", "false", "no")
KNOWLEDGE_FILE = Path(__file__).with_name("knowledge.md")
PHASE_LABELS = {"prep": "Vorbereitung", "season": "Saison", "offseason": "Pause", "none": "keine Saison"}

PRINCIPLES = """Grundsätze:
- Beziehe dich auf konkrete Zahlen aus den Daten (Pace, Puls, Umfang, HRV, Schlaf, Belastung, Gewichte und Wiederholungen).
- Berücksichtige Erholung: niedrige HRV, schlechter Schlaf, hoher Ruhepuls oder ACWR > 1.3 → Belastung reduzieren.
- Feste Termine (z.B. Mannschaftstraining, Match) sind gesetzt. Keine harten Einheiten am Vortag eines Matches,
  kein schweres Krafttraining innerhalb von 48 h vor einem Match.
- Krafttraining: progressive Belastung anhand der erfassten Sätze. Nenne für die nächste Einheit konkrete Gewichte
  und Wiederholungen (z.B. "Kniebeuge 3x5 @ 87.5 kg"), bei Stagnation Varianten oder Deload.
- Der Wochenplan muss zu Trainingstagen, Zielen, Saisonphase und Einschränkungen passen.
- Gib Intensitäten konkret an (Pace in min/km, Herzfrequenzbereiche, RPE oder kg x Wiederholungen).
- Bei Schmerzen oder Verletzungsverdacht: zur ärztlichen Abklärung raten, keine Diagnose stellen.
- Der tägliche Check-in (Energie, Schlaf, Muskeln, Stress je 1-5, 5 = gut; pain 0-10 mit painWhere = Schmerzampel;
  sick = krank) ist ein wichtiges Signal: Schmerz über 5 oder sick → keine intensive Einheit; mehrere Tage
  unter 2.5 im Schnitt → Belastung senken, auch wenn die Garmin-Werte gut aussehen.
- Wochenziele (Einheiten pro Woche) sind Richtwerte des Athleten: plane so, dass sie erreichbar sind, ohne die Erholung zu opfern.
- 'einschraenkungen' (Verletzung, krank, erschöpft mit betroffenen Bereichen) sind verbindlich: betroffene Belastung nicht
  planen oder klar entschärfen; bei 'ill' keine intensiven Einheiten.
- 'geplanteEinheiten': Läufe aus dem Garmin-Trainingsplan haben Vorrang – baue den Plan darum herum, verschiebe sie nur
  mit Begründung. Feste Termine (z.B. Schwimmen) bleiben an ihrem Tag. Plane Kraft nicht am Tag vor einem langen Lauf
  oder Tempolauf mit schweren Beinen.
- Ist ein Rennen ('race' im Profil) eingetragen, richte den Plan auf die Phase bis zum Renntag aus (Aufbau, spezifisch, Tapering).
- Gliedere die Tipps in 2-4 Bereiche ('focus'), passend zu Zielen und Sportarten, den wichtigsten zuerst.
  Erholung/Prävention bekommt einen eigenen Bereich, sofern es etwas Relevantes gibt.
- Schreibe auf Deutsch in Schweizer Rechtschreibung (ss statt ß), direkt und motivierend, in der Du-Form."""

NUTRITION_RULES = """Ernährung (vom Athleten aktiviert):
- Gib alltagstaugliche FAUSTREGELN mit Beispielen für Lebensmittel – keine Grammrechnungen pro Mahlzeit, keine Kalorienpläne.
- Stütze dich auf die Leitlinien: ACSM/Academy of Nutrition and Dietetics/Dietitians of Canada (2016) – Kohlenhydratbedarf
  steigt mit der Belastung, 1-4 h vor intensiven Einheiten kohlenhydratbetont und fett-/ballaststoffarm essen;
  ISSN-Positionspapier Protein – Protein über den Tag verteilen, nach dem Training Protein + Kohlenhydrate;
  UEFA-Expertenstatement zur Ernährung im Fussball (2021) – am Vortag und am Matchtag Kohlenhydrate betonen,
  in der Halbzeit schnelle Kohlenhydrate, nach dem Match Regeneration, ausreichend trinken.
- Richte die Tagesregeln nach der geplanten Einheit (hart/Match → mehr Kohlenhydrate, Ruhetag → ausgewogen).
- Berücksichtige Ernährungsform und Unverträglichkeiten. Bei Gewichtsziel nur ein moderates Defizit an leichten Tagen,
  nie vor Matches oder harten Einheiten.
- Keine Supplement-Empfehlungen ausser gut belegten Basics (z.B. Koffein vor Wettkämpfen) mit Hinweis; keine medizinischen Aussagen."""


def normalize_profile(raw: dict) -> dict:
    """Mirror of normalizeProfile() in web/js/training.js – old profiles stored goals as free text."""
    p = dict(raw or {})
    goals = p.get("goals")
    if not isinstance(goals, dict):
        p["goals"] = {"main": "", "secondary": [], "phase": "", "notes": goals or "",
                      "targets": [{"text": p["raceGoal"], "date": ""}] if p.get("raceGoal") else []}
    p.setdefault("nutrition", {})
    return p


def build_system(profile: dict, sports: list[str]) -> str:
    g = profile["goals"]
    lines = []
    if g.get("main"):
        lines.append(f"- Hauptziel: {FOCUS_LABELS.get(g['main'], g['main'])}")
    if g.get("secondary"):
        lines.append("- Weitere Ziele: " + ", ".join(FOCUS_LABELS.get(k, k) for k in g["secondary"]))
    if g.get("phase"):
        lines.append(f"- Saisonphase: {PHASE_LABELS.get(g['phase'], g['phase'])}")
    for t in g.get("targets") or []:
        lines.append(f"- Messbares Ziel: {t['text']}" + (f" (bis {t['date']})" if t.get("date") else ""))
    if g.get("notes"):
        lines.append(f"- Details: {g['notes']}")
    weekly = {k: v for k, v in (profile.get("weekly") or {}).items() if v}
    if weekly:
        lines.append("- Wochenziele: " + ", ".join(f"{v} {WEEKLY_LABELS.get(k, k)}" for k, v in weekly.items()))
    goals = "\n".join(lines) or "- Keine Ziele angegeben: leite sinnvolle Schwerpunkte aus den Sportarten und Daten ab."

    text = f"""Du bist ein erfahrener Trainer und Sportwissenschaftler für Ausdauer-, Kraft- und Mannschaftssport.
Du betreust eine einzelne Person (Hobby-/Amateursport), die ihre Garmin-Daten und zusätzlich erfasste Trainings
(z.B. Mannschaftstraining, Matches, Krafttraining mit Sätzen, Gewichten und Wiederholungen) mit dir teilt.

Sportarten: {", ".join(sports) or "nicht angegeben"}
Ziele:
{goals}

Deine Aufgabe: Analysiere die Daten ehrlich und konkret und gib umsetzbare Empfehlungen, die genau auf diese Ziele
einzahlen – ohne Überlastung.

{PRINCIPLES}"""
    if profile["nutrition"].get("enabled"):
        text += "\n\n" + NUTRITION_RULES
    return text


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


def e1rm(st: dict) -> float | None:
    """Estimated one-rep max (Epley), only for weighted sets up to 12 reps."""
    kg, reps = st.get("kg"), st.get("reps")
    return kg * (1 + reps / 30) if kg and reps and reps <= 12 else None


def fmt_sets(exercise: dict) -> str:
    unit = "s" if exercise.get("unit") == "s" else ""
    return ", ".join(
        (f"{st['kg']:g}kg x{st.get('reps', '?')}{unit}" if st.get("kg") else f"{st.get('reps', '?')}{unit or ' Wdh'}")
        for st in exercise.get("sets", [])
    )


def strength_block(acts: list[dict]) -> dict:
    per_ex: dict[str, dict] = {}
    sets_per_group: dict[str, int] = defaultdict(int)
    for a in acts:  # newest first
        if not a.get("exercises") or not a.get("date") or day_offset(a["date"]) >= 56:
            continue
        for e in a["exercises"]:
            d = per_ex.setdefault(e["id"], {"übung": e["name"], "einheiten28Tage": 0, "_recent": [], "_prev": [],
                                            "letzteSätze": fmt_sets(e), "letztesDatum": a["date"]})
            best = max((e1rm(st) or 0 for st in e.get("sets", [])), default=0)
            if day_offset(a["date"]) < 28:
                d["einheiten28Tage"] += 1
                d["_recent"].append(best)
            else:
                d["_prev"].append(best)
            if day_offset(a["date"]) < 7:
                sets_per_group[e.get("group") or "Eigene"] += len(e.get("sets", []))
    exercises = []
    for d in per_ex.values():
        recent, prev = d.pop("_recent"), d.pop("_prev")
        if max(recent, default=0):
            d["best1RM28Tage"] = round(max(recent), 1)
        if max(prev, default=0):
            d["best1RMvorherige28Tage"] = round(max(prev), 1)
        exercises.append(d)
    return {"uebungen": exercises, "saetzeProMuskelgruppe7Tage": dict(sets_per_group),
            "hinweis": "1RM = geschätztes Maximalgewicht nach Epley"} if exercises else {}


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
        "kraft": strength_block(acts),
        "gesundheit": {"letzte7Tage": health_block(0, 7), "vorherige21Tage": health_block(7, 28)},
    }


def compact_activity(a: dict) -> dict:
    keys = ("date", "type", "title", "durationMin", "distanceKm", "paceSecPerKm", "avgHr", "maxHr",
            "trainingLoad", "aerobicTE", "anaerobicTE", "trainingEffectLabel", "hrZonesMin", "rpe", "feeling", "notes", "football", "source",
            "elevationGain", "cadence", "strideCm", "groundContactMs", "avgPower", "avgSpeedKmh",
            "paceSecPer100m", "poolLengthM", "lengths", "swolf", "avgStrokesPerLength", "strokeRate", "swimId", "eval")
    out = {k: a[k] for k in keys if a.get(k) not in (None, "", [], {})}
    laps = [l for l in a.get("lapsDetail") or [] if not l.get("rest")]
    if laps and a.get("type") in ("run", "swim") and day_offset(a["date"]) < 14:
        out["runden"] = laps[:30]
    if a.get("garminSets") and not a.get("exercises"):
        out["saetzeVonUhr"] = a["garminSets"][:40]
    if a.get("exercises"):
        out["uebungen"] = [{"name": e["name"], "saetze": fmt_sets(e)} for e in a["exercises"]]
    return out


WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def upcoming_plan(garmin: dict, manual: dict, profile: dict, days: int = 14) -> list[dict]:
    """Own plan entries, fixed weekly sessions and the Garmin training plan for the next days (overrides applied)."""
    plan = manual.get("plan") or []
    overridden = {p["recurOf"] for p in plan if p.get("recurOf")}
    out = [{"datum": p["date"], "sport": p.get("sport"), "titel": p.get("title"), "quelle": "Garmin (verschoben)" if str(p.get("recurOf", "")).startswith("g:") else "eigener Plan"}
           for p in plan if not p.get("removed") and p.get("date") and -1 <= -day_offset(p["date"]) < days]
    for i in range(days):
        d = date.today() + timedelta(days=i)
        for r in profile.get("recurring") or []:
            key = f"r:{r.get('id')}:{d.isoformat()}"
            if r.get("weekday") == d.weekday() and key not in overridden:
                out.append({"datum": d.isoformat(), "sport": r.get("sport"), "titel": r.get("title"), "quelle": f"fester Termin ({WEEKDAYS[d.weekday()]})"})
    for g in garmin.get("planned") or []:
        if f"g:{g.get('id')}" not in overridden and 0 <= -day_offset(g["date"]) < days:
            out.append({"datum": g["date"], "sport": g.get("sport"), "titel": g.get("title"), "quelle": "Garmin-Trainingsplan" + (" (Wettkampf)" if g.get("kind") == "race" else ""),
                        "dauerMin": g.get("durationMin"), "distanzKm": g.get("distanceKm")})
    return sorted(out, key=lambda x: x["datum"])


def weights(garmin: dict, manual: dict) -> dict:
    merged = {d["date"]: d["weightKg"] for d in garmin.get("daily", []) if d.get("weightKg")}
    merged.update(manual.get("weights") or {})
    recent = {d: w for d, w in sorted(merged.items()) if day_offset(d) < 90}
    if not recent:
        return {}
    vals = list(recent.values())
    return {"aktuell": vals[-1], "vor90Tagen": vals[0], "anzahlMessungen": len(vals)}


def month_data(garmin: dict, manual: dict, month: str) -> dict:
    """Everything of one calendar month for the monthly review."""
    acts = [compact_activity(a) for a in merged_activities(garmin, manual) if (a.get("date") or "").startswith(month)]
    daily = [d for d in garmin.get("daily", []) if d["date"].startswith(month)]
    checkins = {d: c for d, c in (manual.get("checkins") or {}).items() if d.startswith(month)}
    stretch_days = sum(1 for d, v in (manual.get("stretch") or {}).items() if d.startswith(month) and v.get("complete"))
    return {"monat": month, "aktivitaeten": acts,
            "gesundheitSchnitt": {k: avg([d.get(k) for d in daily]) for k in ("restingHr", "hrv", "sleepH", "stress", "steps", "weightKg")},
            "checkins": checkins or None, "dehnTage": stretch_days,
            "einschraenkungen": [l for l in manual.get("limits") or [] if (l.get("from") or "")[:7] <= month <= (l.get("to") or "9999")[:7]] or None}


def build_prompt(garmin: dict, manual: dict, profile: dict, previous: dict, question: str, review_month: str = "") -> str:
    acts = merged_activities(garmin, manual)
    daily = garmin.get("daily", [])
    recent_acts = [compact_activity(a) for a in acts if a.get("date") and day_offset(a["date"]) < 42]
    recent_daily = [d for d in daily if day_offset(d["date"]) < 21]
    last = previous.get("analysis") or {}

    sections = {
        "heute": f"{iso_today()} ({date.today().strftime('%A')})",
        "athletenprofil": {k: v for k, v in profile.items() if k not in ("goals", "customExercises", "raceGoal", "templates", "stretch", "recurring", "reminders")} or "nicht ausgefüllt",
        "kennzahlen": compute_metrics(acts, daily),
        "garminSnapshot": garmin.get("snapshot", {}),
        "aktivitaetenLetzte42Tage": recent_acts,
        "gesundheitLetzte21Tage": recent_daily,
        "checkinsLetzte14Tage": {d: c for d, c in sorted((manual.get("checkins") or {}).items()) if day_offset(d) < 14} or None,
        "einschraenkungen": [l for l in manual.get("limits") or [] if not l.get("resolved") and (not l.get("to") or day_offset(l["to"]) <= 0) and day_offset(l.get("from") or iso_today()) < 60] or None,
        "geplanteEinheiten": upcoming_plan(garmin, manual, profile) or None,
        "dehnenLetzte14Tage": {"tageErledigt": sum(1 for d, v in (manual.get("stretch") or {}).items() if day_offset(d) < 14 and v.get("complete")),
                               "uebungen": [i.get("name") for i in profile.get("stretch") or []]} if profile.get("stretch") or manual.get("stretch") else None,
        "koerpergewicht": weights(garmin, manual) or None,
        "rekorde": [{k: r.get(k) for k in ("sport", "label", "kind", "value", "date")} for r in garmin.get("records") or []] or None,
        "trainingsvorlagen": [{"name": t.get("name"), "uebungen": [i.get("id") for i in t.get("items", [])]} for t in profile.get("templates") or []] or None,
        "letzteAnalyse": {"datum": previous.get("generatedAt"), "zusammenfassung": last.get("summary"),
                           "plan": last.get("plan")} if last else None,
    }
    prompt = "Hier sind meine aktuellen Daten als JSON:\n\n" + json.dumps(sections, ensure_ascii=False, indent=1)
    if review_month:
        prompt += "\n\nDATEN DES RÜCKBLICK-MONATS:\n" + json.dumps(month_data(garmin, manual, review_month), ensure_ascii=False, indent=1)
        prev = (date.fromisoformat(review_month + "-01") - timedelta(days=1)).strftime("%Y-%m")
        pm = month_data(garmin, manual, prev)
        acts_prev = pm.pop("aktivitaeten")
        pm["proSportart"] = {t: {"einheiten": sum(1 for a in acts_prev if a.get("type") == t),
                                  "minuten": round(sum(a.get("durationMin") or 0 for a in acts_prev if a.get("type") == t)),
                                  "km": round(sum(a.get("distanceKm") or 0 for a in acts_prev if a.get("type") == t), 1)}
                             for t in sorted({a.get("type") for a in acts_prev})}
        pm.pop("checkins", None)
        prompt += "\n\nVORMONAT ZUM VERGLEICH:\n" + json.dumps(pm, ensure_ascii=False)
    prompt += "\n\nErstelle deine Analyse und den Plan für die nächsten 7 Tage (ab heute)."
    if question:
        prompt += f"\n\nMeine Frage an dich (beantworte sie im Feld 'answer'):\n{question}"
    return prompt


def supervise(client: "anthropic.Anthropic", prompt: str, coach_system: str, analysis: dict, schema: dict) -> tuple[dict, dict]:
    """Second pass: a supervisor checks the coach's analysis against the knowledge base and corrects it if needed."""
    knowledge = KNOWLEDGE_FILE.read_text(encoding="utf-8") if KNOWLEDGE_FILE.exists() else ""
    sup_schema = {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["freigegeben", "angepasst"]},
            "issues": {"type": "array", "items": {
                "type": "object",
                "properties": {"rule": {"type": "string", "description": "z.B. T1, S2, Q1"},
                               "problem": {"type": "string"}, "fix": {"type": "string"}},
                "required": ["rule", "problem", "fix"], "additionalProperties": False}},
            "analysis": schema,
        },
        "required": ["verdict", "issues", "analysis"],
        "additionalProperties": False,
    }
    system = f"""Du bist der Supervisor-Coach, also der Coach des Coachs: Sportwissenschaftler mit Wissen in Trainingslehre,
Sportmedizin und Gesundheitswissenschaft. Du prüfst die Analyse eines Coachs, bevor der Athlet sie sieht.
Deine verbindliche Grundlage ist diese Wissensbasis:

{knowledge}

Auftrag des Coachs (zur Einordnung):
{coach_system}

Prüfe die Analyse gegen alle Prüfregeln (S, T, Q) und gegen die Daten. Rechne Zahlen nach. Ist alles korrekt,
gib sie unverändert zurück (verdict 'freigegeben', issues leer). Ist etwas falsch, riskant, ungenau oder widerspricht
es der Wissensbasis, korrigiere so wenig wie möglich und so viel wie nötig (verdict 'angepasst') und nenne jede
Änderung in 'issues'. Schweizer Rechtschreibung (ss statt ß), Du-Form."""
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": prompt + "\n\nANALYSE DES COACHS (JSON):\n" + json.dumps(analysis, ensure_ascii=False)}],
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": sup_schema}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"Supervisor beendet mit {response.stop_reason}")
    result = json.loads(next(b.text for b in response.content if b.type == "text"))
    meta = {"verdict": result["verdict"], "issues": result["issues"][:12], "model": response.model}
    return result["analysis"], meta


def main() -> None:
    trigger = os.environ.get("TRIGGER") or "manual"
    pending = read_json("question.json", {})
    question = (os.environ.get("QUESTION") or pending.get("question") or "").strip()[:2000]
    review_month = ""
    if trigger == "monthly":
        if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("DRY_RUN"):
            print("Kein ANTHROPIC_API_KEY – Monatsrückblick übersprungen.")
            return
        review_month = os.environ.get("REVIEW_MONTH") or (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
        question = (f"Schreibe meinen Monatsrückblick für {review_month} (Daten siehe 'DATEN DES RÜCKBLICK-MONATS'). "
                    "Aufbau mit Markdown-Zwischentiteln: **Das lief gut**, **Zahlen im Vergleich zum Vormonat** (Einheiten, Stunden, Lauf-km, "
                    "Kraftfortschritt, Schlaf, Ruhepuls/HRV, Gewicht, Check-ins, Dehnen), **Darauf achten**, **Fokus für den nächsten Monat** "
                    "(2–3 konkrete Punkte). Ehrlich, motivierend, max. ca. 300 Wörter.")

    garmin = read_json("garmin.json", {})
    manual = read_json("manual.json", {})
    profile = normalize_profile(read_json("profile.json", {}))
    insights = read_json("insights.json", {})

    recent_types = {a.get("type") for a in merged_activities(garmin, manual) if a.get("date") and day_offset(a["date"]) < 42}
    sports = [SPORT_LABELS.get(k, k) for k in (profile.get("sports") or sorted(t for t in recent_types if t))]
    system = build_system(profile, sports)
    schema = build_schema(bool(profile["nutrition"].get("enabled")))

    prompt = build_prompt(garmin, manual, profile, insights, question, review_month)
    if os.environ.get("DRY_RUN"):
        print(system, "\n\n", prompt)
        return

    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": schema}},
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

    supervisor = {"verdict": "aus"}
    if SUPERVISOR:
        try:
            analysis, supervisor = supervise(client, prompt, system, analysis, schema)
            print(f"Supervisor: {supervisor['verdict']} ({len(supervisor['issues'])} Änderungen).")
        except Exception as err:  # the coach's analysis is still useful without the second check
            supervisor = {"verdict": "ungeprüft", "error": str(err)[:200]}
            print(f"Supervisor fehlgeschlagen: {err}")

    history = insights.get("history", [])
    if insights.get("analysis"):
        old = insights["analysis"]
        history = [{"at": insights.get("generatedAt"), "summary": old.get("summary"),
                    "readiness": (old.get("readiness") or {}).get("score")}] + history
    qa = insights.get("qa", [])
    reviews = insights.get("reviews", {})
    if review_month:
        reviews = {**reviews, review_month: {"text": analysis.get("answer", ""), "at": now_iso()}}
    elif question:
        qa = [{"question": question, "answer": analysis.get("answer", ""), "at": now_iso()}] + qa

    if pending.get("question") and not review_month:
        write_json("question.json", {})  # answered – clear it
    write_json("insights.json", {
        "generatedAt": now_iso(),
        "model": response.model,
        "trigger": trigger,
        "analysis": analysis,
        "supervisor": supervisor,
        "qa": qa[:30],
        "reviews": dict(sorted(reviews.items())[-24:]),
        "history": history[:20],
    })
    usage = response.usage
    print(f"Analyse gespeichert ({response.model}, {usage.input_tokens} in / {usage.output_tokens} out Tokens).")


if __name__ == "__main__":
    main()
