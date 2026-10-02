#!/usr/bin/env python3
"""Fetch daily weather for LA 90045 and Lake Oswego 97034 and write data.json."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data.json"

LOCATIONS = {
    "la": {
        "id": "90045",
        "label": "Los Angeles (90045)",
        "short": "Los Angeles",
        "latitude": 33.9631,
        "longitude": -118.3941,
    },
    "lo": {
        "id": "97034",
        "label": "Lake Oswego (97034)",
        "short": "Lake Oswego",
        "latitude": 45.4093,
        "longitude": -122.6847,
    },
}

START = date(2026, 1, 1)
TZ = "America/Los_Angeles"
DAILY = ",".join(
    [
        "temperature_2m_max",
        "temperature_2m_min",
        "relative_humidity_2m_mean",
        "precipitation_sum",
        "rain_sum",
        "cloud_cover_mean",
        "daylight_duration",
    ]
)


def pacific_today() -> date:
    return datetime.now(ZoneInfo(TZ)).date()


def fetch_location(loc: dict, end: date) -> dict:
    params = {
        "latitude": loc["latitude"],
        "longitude": loc["longitude"],
        "start_date": START.isoformat(),
        "end_date": end.isoformat(),
        "daily": DAILY,
        "timezone": TZ,
        "temperature_unit": "fahrenheit",
        "precipitation_unit": "inch",
    }
    url = "https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=120) as resp:
        raw = json.load(resp)
    if "daily" not in raw:
        raise RuntimeError(f"Unexpected response for {loc['id']}: {raw}")
    return raw["daily"]


def main() -> None:
    end = pacific_today()
    if end < START:
        end = START
    series = {}
    for key, loc in LOCATIONS.items():
        daily = fetch_location(loc, end)
        series[key] = {
            "meta": {
                "id": loc["id"],
                "label": loc["label"],
                "short": loc["short"],
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
            },
            "daily": daily,
        }

    # Sanity: dates should match
    la_times = series["la"]["daily"]["time"]
    lo_times = series["lo"]["daily"]["time"]
    if la_times != lo_times:
        raise RuntimeError("Date axes do not match between locations")

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ,
        "startDate": START.isoformat(),
        "endDate": end.isoformat(),
        "units": {
            "temperature": "°F",
            "humidity": "%",
            "rain": "in",
            "cloudCover": "%",
            "daylight": "hours",
        },
        "source": "Open-Meteo Historical Weather API",
        "dates": la_times,
        "locations": {
            "la": series["la"]["meta"],
            "lo": series["lo"]["meta"],
        },
        "series": {
            "la": {
                "high": series["la"]["daily"]["temperature_2m_max"],
                "low": series["la"]["daily"]["temperature_2m_min"],
                "humidity": series["la"]["daily"]["relative_humidity_2m_mean"],
                "rain": series["la"]["daily"]["rain_sum"],
                "cloudCover": series["la"]["daily"]["cloud_cover_mean"],
                "daylight": [
                    (None if v is None else round(v / 3600, 3))
                    for v in series["la"]["daily"]["daylight_duration"]
                ],
            },
            "lo": {
                "high": series["lo"]["daily"]["temperature_2m_max"],
                "low": series["lo"]["daily"]["temperature_2m_min"],
                "humidity": series["lo"]["daily"]["relative_humidity_2m_mean"],
                "rain": series["lo"]["daily"]["rain_sum"],
                "cloudCover": series["lo"]["daily"]["cloud_cover_mean"],
                "daylight": [
                    (None if v is None else round(v / 3600, 3))
                    for v in series["lo"]["daily"]["daylight_duration"]
                ],
            },
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(la_times)} days, through {end.isoformat()})")


if __name__ == "__main__":
    main()
