"""Shared helpers for the Garmin sync and the Claude coach."""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))

# Garmin activityType.typeKey -> app sport type (keep in sync with web/js/util.js SPORTS)
SPORT_BY_GARMIN_TYPE = {
    "running": "run",
    "treadmill_running": "run",
    "trail_running": "run",
    "track_running": "run",
    "indoor_running": "run",
    "virtual_run": "run",
    "ultra_run": "run",
    "soccer": "football",
    "football": "football",
    "indoor_soccer": "football",
    "strength_training": "strength",
    "indoor_cardio": "hiit",
    "hiit": "hiit",
    "cardio": "hiit",
    "cycling": "cycle",
    "road_biking": "cycle",
    "indoor_cycling": "cycle",
    "mountain_biking": "cycle",
    "gravel_cycling": "cycle",
    "virtual_ride": "cycle",
    "e_bike_fitness": "cycle",
    "lap_swimming": "swim",
    "open_water_swimming": "swim",
    "swimming": "swim",
    "walking": "walk",
    "hiking": "walk",
    "yoga": "mobility",
    "pilates": "mobility",
    "breathwork": "mobility",
    "mobility": "mobility",
    "stretching": "mobility",
}

SPORT_LABELS = {
    "run": "Laufen",
    "football": "Fussball",
    "strength": "Kraft",
    "cycle": "Rad",
    "swim": "Schwimmen",
    "hiit": "HIIT / Cardio",
    "mobility": "Mobility / Yoga",
    "walk": "Gehen / Wandern",
    "other": "Sonstiges",
}


def sport_for(type_key: str | None) -> str:
    return SPORT_BY_GARMIN_TYPE.get((type_key or "").lower(), "other")


def read_json(name: str, default: Any) -> Any:
    path = DATA_DIR / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json(name: str, data: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def iso_today() -> str:
    return date.today().isoformat()


def iso_days_ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def set_output(name: str, value: str) -> None:
    """Expose a value to later GitHub Actions steps (no-op locally)."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


def merged_activities(garmin: dict, manual: dict) -> list[dict]:
    """Garmin activities with the user's annotations applied, plus manual entries, newest first."""
    annotations = manual.get("annotations", {})
    acts = [{**a, **annotations.get(a["id"], {})} for a in garmin.get("activities", [])]
    acts += manual.get("activities", [])
    return sorted(acts, key=lambda a: a.get("start") or a.get("date", ""), reverse=True)
