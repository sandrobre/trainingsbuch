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


def _kmh(v: float) -> float:
    return round(v * 3.6, 1)


# (our key, Garmin key, converter) – activity summary fields beyond the basics
EXTRA_FIELDS: list[tuple[str, str, Callable[[Any], Any]]] = [
    ("movingMin", "movingDuration", lambda v: round(v / 60, 1)),
    ("elapsedMin", "elapsedDuration", lambda v: round(v / 60, 1)),
    ("avgSpeedKmh", "averageSpeed", _kmh),
    ("maxSpeedKmh", "maxSpeed", _kmh),
    ("elevationLoss", "elevationLoss", round),
    ("minElevation", "minElevation", round),
    ("maxElevation", "maxElevation", round),
    ("maxCadence", "maxRunningCadenceInStepsPerMinute", round),
    ("strideCm", "avgStrideLength", lambda v: round(v, 1)),
    ("groundContactMs", "avgGroundContactTime", round),
    ("verticalOscillationCm", "avgVerticalOscillation", lambda v: round(v, 1)),
    ("verticalRatio", "avgVerticalRatio", lambda v: round(v, 1)),
    ("avgPower", "avgPower", round),
    ("maxPower", "maxPower", round),
    ("normPower", "normPower", round),
    ("bikeCadence", "averageBikingCadenceInRevPerMinute", round),
    ("steps", "steps", round),
    ("avgRespiration", "avgRespirationRate", lambda v: round(v, 1)),
    ("minTempC", "minTemperature", lambda v: round(v, 1)),
    ("maxTempC", "maxTemperature", lambda v: round(v, 1)),
    ("laps", "lapCount", int),
    ("trainingEffectLabel", "trainingEffectLabel", str),
    ("aerobicTEMessage", "aerobicTrainingEffectMessage", str),
    ("anaerobicTEMessage", "anaerobicTrainingEffectMessage", str),
    ("moderateMin", "moderateIntensityMinutes", round),
    ("vigorousMin", "vigorousIntensityMinutes", round),
    ("bodyBatteryImpact", "differenceBodyBattery", round),
    ("sweatMl", "waterEstimated", round),
    ("lactateHr", "lactateThresholdBpm", round),
    ("location", "locationName", str),
    # swimming
    ("lengths", "activeLengths", int),
    ("strokes", "strokes", round),
    ("avgStrokesPerLength", "averageStrokes", lambda v: round(v, 1)),
    ("swolf", "averageSwolf", round),
    ("strokeRate", "averageSwimCadenceInStrokesPerMinute", round),
    ("strokeDistanceM", "avgStrokeDistance", lambda v: round(v, 2)),
    # strength
    ("totalSets", "totalSets", int),
    ("activeSets", "activeSets", int),
    ("totalReps", "totalReps", int),
]


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
    # everything else Garmin reports in the activity summary (only fields that are present end up in the JSON)
    for key, raw_key, fn in EXTRA_FIELDS:
        value = raw.get(raw_key)
        if value not in (None, "", 0, 0.0):
            try:
                act[key] = fn(value)
            except (TypeError, ValueError):
                pass
    if sport == "swim":
        pool = raw.get("poolLength")
        if pool:
            unit = ((raw.get("unitOfPoolLength") or {}).get("unitKey") or "meter").lower()
            act["poolLengthM"] = round(pool / 100 if pool > 100 else pool, 1) if unit.startswith("meter") else round(pool * 0.9144 / (100 if pool > 100 else 1), 1)
        moving = raw.get("movingDuration") or duration_s
        if distance_m and moving:
            act["paceSecPer100m"] = round(moving / (distance_m / 100))
    if raw.get("summarizedExerciseSets"):
        act["garminSetsSummary"] = [
            {"category": x.get("category"), "subCategory": x.get("subCategory"), "reps": x.get("reps"), "sets": x.get("sets"),
             "volumeKg": num((x.get("volume") or 0) / 1000, 1) or None}
            for x in raw["summarizedExerciseSets"] if x.get("category")
        ]
    zones = [raw.get(f"hrTimeInZone_{i}") for i in range(1, 6)]
    if any(zones):
        act["hrZonesMin"] = [num((z or 0) / 60, 1) for z in zones]
    return {k: v for k, v in act.items() if v not in (None, "")}


def _lap(lap: dict, sport: str) -> dict:
    dist = lap.get("distance") or 0
    dur = lap.get("movingDuration") or lap.get("duration") or 0
    out = {
        "km": round(dist / 1000, 3) if dist else None,
        "sec": round(lap.get("duration") or 0) or None,
        "hr": num(lap.get("averageHR"), 0),
        "maxHr": num(lap.get("maxHR"), 0),
        "cadence": num(lap.get("averageRunCadence"), 0),
        "power": num(lap.get("averagePower"), 0),
        "elev": num(lap.get("elevationGain"), 0),
    }
    if sport == "run" and dist > 50 and dur:
        out["pace"] = round(dur / (dist / 1000))
    if sport == "swim":
        out.update(
            lengths=lap.get("numberOfActiveLengths"),
            strokes=num(lap.get("totalNumberOfStrokes"), 0),
            swolf=num(lap.get("averageSWOLF"), 0),
            stroke=(lap.get("swimStroke") or ((lap.get("lengthDTOs") or [{}])[0].get("swimStroke"))),
            pace100=round(dur / (dist / 100)) if dist and dur else None,
            rest=not dist,
        )
    return {k: v for k, v in out.items() if v not in (None, "", 0, False)}


def _weight_kg(w: Any) -> float | None:
    if not w:
        return None
    return round(w / 1000, 1) if w > 500 else round(w, 1)  # Garmin uses grams


def activity_details(api: Garmin, act: dict) -> dict:
    """Laps / swim intervals and strength sets recorded on the watch."""
    gid = act["id"][1:]
    extra: dict[str, Any] = {"detailsAt": iso_today()}
    splits = safe(f"Runden {gid}", api.get_activity_splits, gid) or {}
    laps = [_lap(l, act.get("type")) for l in splits.get("lapDTOs") or []]
    if act.get("type") in ("run", "swim", "cycle", "walk", "hiit", "other") and (len(laps) > 1 or act.get("type") == "swim"):
        extra["lapsDetail"] = laps[:120]
    if act.get("type") == "strength":
        data = safe(f"Kraftsätze {gid}", api.get_activity_exercise_sets, gid) or {}
        sets = []
        for st in data.get("exerciseSets") or []:
            if (st.get("setType") or "").upper() != "ACTIVE":
                continue
            ex = max(st.get("exercises") or [{}], key=lambda e: e.get("probability") or 0)
            sets.append({k: v for k, v in {
                "category": ex.get("category"), "name": ex.get("name"),
                "reps": st.get("repetitionCount"), "kg": _weight_kg(st.get("weight")),
                "sec": num(st.get("duration"), 0),
            }.items() if v not in (None, "", 0)})
        if sets:
            extra["garminSets"] = sets
    return extra


def _clock(ms: Any) -> str | None:
    """Garmin 'local' epoch milliseconds → 'HH:MM'."""
    if not ms:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%H:%M")


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
        bodyBatteryCharged=summary.get("bodyBatteryChargedValue"),
        bodyBatteryDrained=summary.get("bodyBatteryDrainedValue"),
        kcalTotal=num(summary.get("totalKilocalories"), 0),
        kcalActive=num(summary.get("activeKilocalories"), 0),
        floors=num(summary.get("floorsAscended"), 0),
        moderateMin=summary.get("moderateIntensityMinutes"),
        vigorousMin=summary.get("vigorousIntensityMinutes"),
        spo2=summary.get("averageSpo2"),
        spo2Low=summary.get("lowestSpo2"),
        respiration=num(summary.get("avgWakingRespirationValue"), 1),
        maxHr=summary.get("maxHeartRate"),
        minHr=summary.get("minHeartRate"),
        stressHighMin=num((summary.get("highStressDuration") or 0) / 60, 0) or None,
        restMin=num((summary.get("restStressDuration") or 0) / 60, 0) or None,
        distanceKm=num((summary.get("totalDistanceMeters") or 0) / 1000, 1) or None,
    )

    sleep_raw = safe(f"Schlaf {day}", api.get_sleep_data, day) or {}
    sleep = sleep_raw.get("dailySleepDTO") or {}
    if sleep.get("sleepTimeSeconds"):
        entry.update(
            sleepH=num(sleep["sleepTimeSeconds"] / 3600, 2),
            deepH=num((sleep.get("deepSleepSeconds") or 0) / 3600, 2),
            remH=num((sleep.get("remSleepSeconds") or 0) / 3600, 2),
            lightH=num((sleep.get("lightSleepSeconds") or 0) / 3600, 2),
            awakeH=num((sleep.get("awakeSleepSeconds") or 0) / 3600, 2),
            sleepScore=((sleep.get("sleepScores") or {}).get("overall") or {}).get("value"),
            sleepStress=num(sleep.get("avgSleepStress"), 0),
            sleepRespiration=num(sleep.get("averageRespirationValue"), 1),
            awakeCount=sleep.get("awakeCount"),
            sleepStart=_clock(sleep.get("sleepStartTimestampLocal")),
            sleepEnd=_clock(sleep.get("sleepEndTimestampLocal")),
            sleepRestingHr=sleep_raw.get("restingHeartRate"),
        )

    hrv = (safe(f"HRV {day}", api.get_hrv_data, day) or {}).get("hrvSummary") or {}
    baseline = hrv.get("baseline") or {}
    entry.update(
        hrv=hrv.get("lastNightAvg"),
        hrvWeekly=hrv.get("weeklyAvg"),
        hrvStatus=hrv.get("status"),
        hrvBaseLow=baseline.get("balancedLow"),
        hrvBaseHigh=baseline.get("balancedUpper"),
    )
    readiness = safe(f"Readiness {day}", api.get_training_readiness, day)
    if isinstance(readiness, list) and readiness:
        entry["readiness"] = readiness[0].get("score")
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

    endurance = safe("Ausdauerwert", api.get_endurance_score, today) or {}
    if isinstance(endurance, dict) and endurance.get("overallScore"):
        snap["enduranceScore"] = endurance.get("overallScore")
    hill = safe("Bergwert", api.get_hill_score, today) or {}
    if isinstance(hill, dict) and hill.get("overallScore"):
        snap["hillScore"] = hill.get("overallScore")

    lactate = safe("Laktatschwelle", api.get_lactate_threshold, latest=True) or {}
    shr = lactate.get("speed_and_heart_rate") or {}
    if shr.get("heartRate"):
        speed = shr.get("speed")  # Garmin reports m/s scaled by 10
        snap["lactateThreshold"] = {
            "heartRate": shr.get("heartRate"),
            "paceSecPerKm": round(1000 / (speed * 10)) if speed else None,
        }
    return snap


def _sport_from_item(item: dict) -> str:
    key = (item.get("sportTypeKey") or (item.get("activityType") or {}).get("typeKey") or "").lower()
    if not key and isinstance(item.get("sportType"), dict):
        key = (item["sportType"].get("sportTypeKey") or "").lower()
    sport = sport_for(key)
    if sport == "other":
        for word, s in (("run", "run"), ("lauf", "run"), ("marathon", "run"), ("swim", "swim"), ("cycl", "cycle"), ("bike", "cycle"),
                        ("strength", "strength"), ("yoga", "mobility"), ("mobility", "mobility")):
            if word in key or word in (item.get("title") or "").lower():
                return s
    return sport


PR_LABELS = {  # fallback when Garmin sends no label key
    1: ("run", "Schnellster 1 km", "time"), 2: ("run", "Schnellste Meile", "time"), 3: ("run", "Schnellste 5 km", "time"),
    4: ("run", "Schnellste 10 km", "time"), 5: ("run", "Schnellster Halbmarathon", "time"), 6: ("run", "Schnellster Marathon", "time"),
    7: ("run", "Längster Lauf", "distance"), 8: ("cycle", "Längste Radfahrt", "distance"),
    12: ("steps", "Meiste Schritte an einem Tag", "count"), 13: ("steps", "Meiste Schritte in einer Woche", "count"),
    14: ("steps", "Meiste Schritte in einem Monat", "count"),
}


def _pr_meta(key: str, type_id: Any, activity_type: str) -> tuple[str, str, str]:
    """Sport, German label and value kind from Garmin's prTypeLabelKey (e.g. 'pr.label.swim.fastest.100m')."""
    k = (key or "").lower()
    if not k and type_id in PR_LABELS:
        return PR_LABELS[type_id]
    sport = "swim" if "swim" in k or "swim" in (activity_type or "") else "cycle" if any(w in k for w in ("ride", "cycl", "bik")) \
        else "steps" if "step" in k else "run" if any(w in k for w in ("run", "1k", "5k", "10k", "mile", "marathon")) or "run" in (activity_type or "") else "other"
    dist = next((lab for tok, lab in (("half", "Halbmarathon"), ("marathon", "Marathon"), ("10k", "10 km"), ("5k", "5 km"), ("1k", "1 km"),
                                        ("1500", "1500 m"), ("1000", "1000 m"), ("750", "750 m"), ("400", "400 m"), ("100m", "100 m"),
                                        ("mile", "Meile"), ("40k", "40 km"), ("20min", "20 Min.")) if tok in k), "")
    if "power" in k:
        return sport, f"Höchste Leistung {dist}".strip(), "power"
    if "ascent" in k or "climb" in k:
        return sport, "Meiste Höhenmeter", "elevation"
    if "step" in k:
        span = "Woche" if "week" in k else "Monat" if "month" in k else "Tag"
        return "steps", f"Meiste Schritte ({span})", "count"
    if "streak" in k:
        return "other", "Längste Zielserie", "count"
    if any(w in k for w in ("longest", "farthest", "distance")):
        return sport, {"swim": "Längste Schwimmstrecke", "cycle": "Längste Radfahrt"}.get(sport, "Längster Lauf"), "distance"
    if "fastest" in k or dist:
        return sport, f"Schnellste {dist}".strip() if dist else "Schnellste Zeit", "time"
    if type_id in PR_LABELS:
        return PR_LABELS[type_id]
    return sport, key or f"Rekord {type_id}", "value"


def personal_records(api: Garmin) -> list[dict]:
    data = safe("Persönliche Rekorde", api.get_personal_record) or []
    out = []
    for r in data if isinstance(data, list) else []:
        sport, label, kind = _pr_meta(r.get("prTypeLabelKey") or "", r.get("typeId"), ((r.get("activityType") or "") if isinstance(r.get("activityType"), str) else ""))
        date_str = (r.get("prStartTimeLocalFormatted") or r.get("prStartTimeGmtFormatted") or r.get("actStartDateTimeInGMTFormatted") or "")[:10]
        out.append({k: v for k, v in {
            "typeId": r.get("typeId"), "key": r.get("prTypeLabelKey"), "sport": sport, "label": label, "kind": kind,
            "value": r.get("value"), "date": date_str or None,
            "activityId": f"g{r['activityId']}" if r.get("activityId") else None, "activityName": r.get("activityName"),
        }.items() if v not in (None, "")})
    return out


def body_composition(api: Garmin, days: int) -> dict[str, dict]:
    start = (date.today() - timedelta(days=days)).isoformat()
    data = safe("Körperzusammensetzung", api.get_body_composition, start, iso_today()) or {}
    out: dict[str, dict] = {}
    for e in data.get("dateWeightList") or []:
        day = (e.get("calendarDate") or "")[:10]
        if not day:
            continue
        vals = {"weightKg": _weight_kg(e.get("weight")), "bodyFat": num(e.get("bodyFat"), 1), "muscleKg": _weight_kg(e.get("muscleMass")),
                "bodyWater": num(e.get("bodyWater"), 1), "bmi": num(e.get("bmi"), 1)}
        out[day] = {k: v for k, v in vals.items() if v}
    return out


def planned_workouts(api: Garmin) -> list[dict]:
    """Scheduled workouts from the Garmin calendar (training plans, Garmin Coach, manually scheduled), -7 … +35 days."""
    today = date.today()
    first, last = today - timedelta(days=7), today + timedelta(days=35)
    months = sorted({(d.year, d.month) for d in (first, today, last)})
    out: dict[str, dict] = {}
    for year, month in months:
        cal = safe(f"Garmin-Kalender {year}-{month:02d}", api.get_scheduled_workouts, year, month) or {}
        for item in cal.get("calendarItems") or []:
            kind = (item.get("itemType") or "").lower()
            day = (item.get("date") or "")[:10]
            if kind == "activity" or not day or not (first.isoformat() <= day <= last.isoformat()):
                continue
            if kind not in ("workout", "fbtadaptiveworkout", "trainingplan", "event", "race") and "workout" not in kind and not item.get("isRace"):
                continue
            entry = {
                "id": f"gp{item.get('id') or item.get('workoutId') or day + (item.get('title') or '')}",
                "date": day,
                "title": item.get("title") or item.get("workoutName") or "Training",
                "sport": _sport_from_item(item),
                "kind": "race" if item.get("isRace") or kind in ("event", "race") else "workout",
                "durationMin": num((item.get("duration") or item.get("estimatedDurationInSecs") or 0) / 60, 0) or None,
                "distanceKm": num((item.get("distance") or item.get("estimatedDistanceInMeters") or 0) / 1000, 1) or None,
                "plan": item.get("trainingPlanName") or ("Garmin Coach" if "fbt" in kind else None),
                "description": (item.get("description") or "")[:400] or None,
            }
            out[entry["id"]] = {k: v for k, v in entry.items() if v not in (None, "")}
    return sorted(out.values(), key=lambda e: e["date"])


def weigh_ins(api: Garmin, days: int) -> dict[str, float]:
    """Body weight per day (kg) from Garmin (scale or manual entries in Garmin Connect)."""
    start = (date.today() - timedelta(days=days)).isoformat()
    data = safe("Gewicht", api.get_weigh_ins, start, iso_today()) or {}
    out: dict[str, float] = {}
    for summary in data.get("dailyWeightSummaries") or []:
        w = (summary.get("latestWeight") or {}).get("weight") or (summary.get("summaryDate") and summary.get("maxWeight"))
        day = summary.get("summaryDate")
        if day and w:
            out[day] = round(w / 1000, 1) if w > 1000 else round(w, 1)
    return out


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

    # laps / swim intervals / strength sets: new activities first, then older ones bit by bit
    budget = int(os.environ.get("DETAIL_BUDGET") or 30)
    todo = [a for a in activities if a["id"] in new_ids or not a.get("detailsAt")][:budget]
    log.info("Lade Details für %s Aktivitäten", len(todo))
    for act in todo:
        act.update(activity_details(api, act))

    health_days = min(days, 42)
    log.info("Lade Gesundheitsdaten für %s Tage", health_days)
    daily = {d["date"]: d for d in store.get("daily", [])}
    for offset in range(health_days, -1, -1):
        day = (date.today() - timedelta(days=offset)).isoformat()
        daily[day] = {**daily.get(day, {}), **daily_metrics(api, day)}

    for day, kg in weigh_ins(api, max(days, 30)).items():
        daily[day] = {**daily.get(day, {"date": day}), "weightKg": kg}
    for day, comp in body_composition(api, max(days, 30)).items():
        daily[day] = {**daily.get(day, {"date": day}), **comp}

    snap = {**store.get("snapshot", {}), **snapshot(api)}
    if snap.get("vo2max"):  # build a VO2max history over time
        daily[iso_today()] = {**daily.get(iso_today(), {"date": iso_today()}), "vo2max": snap["vo2max"]}
    records = personal_records(api) or store.get("records", [])

    planned = planned_workouts(api)
    log.info("%s geplante Garmin-Einheiten", len(planned))

    store.update(
        updatedAt=now_iso(),
        planned=planned,
        activities=activities,
        daily=sorted(daily.values(), key=lambda d: d["date"])[-400:],
        snapshot=snap,
        records=records,
    )
    write_json("garmin.json", store)
    log.info("%s Aktivitäten gespeichert, %s neu", len(activities), len(new_ids))

    set_output("new_activities", str(len(new_ids)))
    # Garmin rotates the refresh token; report it so the workflow can update the secret.
    rotated = TOKEN_FILE.exists() and TOKEN_FILE.read_text(encoding="utf-8").strip() != original_tokens
    set_output("tokens_rotated", "true" if rotated else "false")


if __name__ == "__main__":
    main()
