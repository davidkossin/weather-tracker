# Weather Tracker

Daily weather comparison (defaults: Los Angeles `90045` vs Lake Oswego `97034`) for [Objects In Space](https://dkossin.com/).

**Live:** https://dkossin.com/weather/

## How publishing works

This repo is the **source of truth** (HTML/CSS/JS, `data.json`, fetch script, Actions).

A GitHub Action (`deploy-to-site.yml`) copies the static files into
[`davidkossin/davidkossin.github.io`](https://github.com/davidkossin/davidkossin.github.io)
under `weather/`, so the app stays on the same URL path:

`https://dkossin.com/weather/`

(GitHub Pages project sites cannot mount under a custom path of a user domain; mirroring into the user site is intentional.)

Shared site chrome (`styles.css`, `stars.js`) is loaded from `https://dkossin.com/`.

## Daily data updates

Workflow `update-weather.yml` runs daily ~7:00 AM PT (`cron: 0 14 * * *`) and on
manual dispatch. It runs `scripts/fetch_weather.py` (Open-Meteo archive API) and
commits `data.json` when data changes. That push then triggers deploy to the site.

## Local development

```bash
python3 scripts/fetch_weather.py
# serve this directory, e.g.
python3 -m http.server 8080
# open http://localhost:8080/
```

## Edit policy

- Change app code and workflows **here**.
- Do not hand-edit `weather/` in the site repo; it is overwritten by deploy CI.
