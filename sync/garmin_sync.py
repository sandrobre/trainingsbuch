"""Pull activities and daily health metrics from Garmin Connect into data/garmin.json.

Runs in GitHub Actions (see .github/workflows/garmin-sync.yml) but works locally too:

    GARMIN_TOKENS="$(cat ~/.garminconnect/garmin_tokens.json)" python sync/garmin_sync.py

Environment:
    GARMIN_TOKENS    token JSON from sync/garmin_login.py (preferred, survives MFA)
    GARMIN_EMAIL / GARMIN_PASSWORD   fallback credential login (only without MFA)
    SYNC_DAYS        how many days of activities/health to (re)load, default 7 (first run: 90)
    DATA_DIR         where the JSON files live, default ./data
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from common import iso_today, now_iso, read_json, set_output, sport_for, write_json

log = logging.getLogger("garmin_sync")
TOKEN_DIR = Path.home() / ".garminconnect"
TOKEN_FILE = TOKEN_DIR / "garmin_tokens.json"


def login() -> tuple[Garmin, str]:
    tokens = os.environ.get("GARMIN_TOKENS", "").strip()
    if tokens:
        TOKEN_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        TOKEN_FILE.write_text(tokens, encoding="utf-8")
        TOKEN_FILE.chmod(0o600)
    elif not (os.environ.get("GARMIN_EMAIL") and os.environ.get("GARMIN_PASSWORD")):
        sys.exit("Weder GARMIN_TOKENS noch GARMIN_EMAIL/GARMIN_PASSWORD gesetzt – siehe README.")

    api = Garmin(os.environ.get("GARMIN_EMAIL") or None, os.environ.get("GARMIN_PASSWORD") or None)
    # Loads the token file (refreshing it in place when needed) or falls back to credentials.
    api.login(str(TOKEN_DIR))
    return api, tokens


def safe(label: str, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Call a Garmin endpoint; a single failing metric must not break the whole sync."""
    try:
        result = fn(*args, **kwargs)
        time.sleep(0.25)  # be gentle with Garmin's rate limits
        return result
    except GarminConnectTooManyRequestsError:
        raise
    except (GarminConnectConnectionError, KeyError, IndexError, TypeError, ValueError) as err:
        log.warning("%s fehlgeschlagen: %s", label, err)
        return None


def num(value: Any, digits: int = 1) -> float | int | None:
    if value is None:
        return None
    try:
        return round(float(value), digits) if digits else round(float(value))
    except (TypeError, ValueError):
        return None


def normalize_activity(raw: dict) -> dict:
    type_key = (raw.get("activityType") or {}).get("typeKey")
    sport = sport_for(type_key)
    duration_s = raw.get("duration") or raw.get("movingDuration") or 0
    distance_m = raw.get("distance") or 0
    start = (raw.get("startTimeLocal") or "").replace(" ", "T")
    act = {
        "id": f"g{raw.get('activityId')}",
        "source": "garmin",
        "type": sport,
        "garminType": type_key,
        "title": raw.get("activityName") or "",
        "date": start[:10],
        "start": start,
        "durationMin": num(duration_s / 60, 1),
        "distanceKm": num(distance_m / 1000, 2) if distance_m else None,
        "avgHr": num(raw.get("averageHR"), 0),
        "maxHr": num(raw.get("maxHR"), 0),
        "calories": num(raw.get("calories"), 0),
        "elevationGain": num(raw.get("elevationGain"), 0),
        "trainingLoad": num(raw.get("activityTrainingLoad"), 0),
        "aerobicTE": num(raw.get("aerobicTrainingEffect"), 1),
        "anaerobicTE": num(raw.get("anaerobicTrainingEffect"), 1),
        "vo2max": num(raw.get("vO2MaxValue"), 0),
        "cadence": num(raw.get("averageRunningCadenceInStepsPerMinute"), 0),
    }
    if sport == "run" and distance_m > 200 and duration_s:
        act["paceSecPerKm"] = round(duration_s / (distance_m / 1000))
    zones = [raw.get(f"hrTimeInZone_{i}") for i in range(1, 6)]
    if any(zones):
        act["hrZonesMin"] = [num((z or 0) / 60, 1) for z in zones]
    return {k: v for k, v in act.items() if v not in (None, "")}


def daily_metrics(api: Garmin, day: str) -> dict:
    entry: dict[str, Any] = {"date": day}

    summary = safe(f"Tageszusammenfassung {day}", api.get_user_summary, day) or {}
    entry.update(
        restingHr=summary.get("restingHeartRate"),
        steps=summary.get("totalSteps"),
        stress=summary.get("averageStressLevel"),
        bodyBatteryHigh=summary.get("bodyBatteryHighestValue"),
        bodyBatteryLow=summary.get("bodyBatteryLowestValue"),
        bodyBattery=summary.get("bodyBatteryMostRecentValue"),
    )

    sleep = (safe(f"Schlaf {day}", api.get_sleep_data, day) or {}).get("dailySleepDTO") or {}
    if sleep.get("sleepTimeSeconds"):
        entry.update(
            sleepH=num(sleep["sleepTimeSeconds"] / 3600, 2),
            deepH=num((sleep.get("deepSleepSeconds") or 0) / 3600, 2),
            remH=num((sleep.get("remSleepSeconds") or 0) / 3600, 2),
            lightH=num((sleep.get("lightSleepSeconds") or 0) / 3600, 2),
            awakeH=num((sleep.get("awakeSleepSeconds") or 0) / 3600, 2),
            sleepScore=((sleep.get("sleepScores") or {}).get("overall") or {}).get("value"),
        )

    hrv = (safe(f"HRV {day}", api.get_hrv_data, day) or {}).get("hrvSummary") or {}
    entry.update(
        hrv=hrv.get("lastNightAvg"),
        hrvWeekly=hrv.get("weeklyAvg"),
        hrvStatus=hrv.get("status"),
    )
    return {k: v for k, v in entry.items() if v is not None}


def snapshot(api: Garmin) -> dict:
    today = iso_today()
    snap: dict[str, Any] = {}

    readiness = safe("Training Readiness", api.get_training_readiness, today)
    if isinstance(readiness, list) and readiness:
        r = readiness[0]
        snap["readiness"] = {
            "score": r.get("score"),
            "level": r.get("level"),
            "feedback": r.get("feedbackShort"),
            "recoveryTimeH": num((r.get("recoveryTime") or 0) / 60, 0),
        }

    status = safe("Training Status", api.get_training_status, today) or {}
    latest = ((status.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData")) or {}
    device_status = next(iter(latest.values()), {}) if isinstance(latest, dict) else {}
    if device_status:
        acute = device_status.get("acuteTrainingLoadDTO") or {}
        snap["trainingStatus"] = {
            "phrase": device_status.get("trainingStatusFeedbackPhrase"),
            "acuteLoad": acute.get("dailyTrainingLoadAcute"),
            "chronicLoad": acute.get("dailyTrainingLoadChronic"),
            "acwr": acute.get("dailyAcuteChronicWorkloadRatio"),
            "acwrStatus": acute.get("acwrStatus"),
        }

    metrics = safe("VO2max", api.get_max_metrics, today)
    if isinstance(metrics, list) and metrics:
        generic = metrics[0].get("generic") or {}
        snap["vo2max"] = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
        snap["fitnessAge"] = generic.get("fitnessAge")

    races = safe("Wettkampfprognosen", api.get_race_predictions) or {}
    if isinstance(races, list):
        races = races[0] if races else {}
    if races:
        snap["racePredictions"] = {
            "5k": races.get("time5K"),
            "10k": races.get("time10K"),
            "half": races.get("timeHalfMarathon"),
            "marathon": races.get("timeMarathon"),
        }

    lactate = safe("Laktatschwelle", api.get_lactate_threshold, latest=True) or {}
    shr = lactate.get("speed_and_heart_rate") or {}
    if shr.get("heartRate"):
        speed = shr.get("speed")  # Garmin reports m/s scaled by 10
        snap["lactateThreshold"] = {
            "heartRate": shr.get("heartRate"),
            "paceSecPerKm": round(1000 / (speed * 10)) if speed else None,
        }
    return snap


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("garminconnect").setLevel(logging.WARNING)

    store = read_json("garmin.json", {})
    first_run = not store.get("activities")
    days = int(os.environ.get("SYNC_DAYS") or (90 if first_run else 7))

    try:
        api, original_tokens = login()
    except GarminConnectAuthenticationError as err:
        sys.exit(f"Garmin-Login fehlgeschlagen ({err}). Tokens mit sync/garmin_login.py erneuern.")

    start = (date.today() - timedelta(days=days)).isoformat()
    log.info("Lade Aktivitäten seit %s", start)
    raw_acts = safe("Aktivitäten", api.get_activities_by_date, start, iso_today()) or []

    known = {a["id"]: a for a in store.get("activities", [])}
    new_ids = []
    for raw in raw_acts:
        act = normalize_activity(raw)
        if act["id"] not in known:
            new_ids.append(act["id"])
        known[act["id"]] = act
    activities = sorted(known.values(), key=lambda a: a.get("start", ""), reverse=True)

    health_days = min(days, 42)
    log.info("Lade Gesundheitsdaten für %s Tage", health_days)
    daily = {d["date"]: d for d in store.get("daily", [])}
    for offset in range(health_days, -1, -1):
        day = (date.today() - timedelta(days=offset)).isoformat()
        daily[day] = {**daily.get(day, {}), **daily_metrics(api, day)}

    store.update(
        updatedAt=now_iso(),
        activities=activities,
        daily=sorted(daily.values(), key=lambda d: d["date"])[-400:],
        snapshot={**store.get("snapshot", {}), **snapshot(api)},
    )
    write_json("garmin.json", store)
    log.info("%s Aktivitäten gespeichert, %s neu", len(activities), len(new_ids))

    set_output("new_activities", str(len(new_ids)))
    # Garmin rotates the refresh token; report it so the workflow can update the secret.
    rotated = TOKEN_FILE.exists() and TOKEN_FILE.read_text(encoding="utf-8").strip() != original_tokens
    set_output("tokens_rotated", "true" if rotated else "false")


if __name__ == "__main__":
    main()
