(function () {
  // Colorblind-safe pair: orange = city A, blue = city B
  const COLOR_A = "#E06900";
  const COLOR_A_LOW = "#F4A261";
  const COLOR_B = "#0072B2";
  const COLOR_B_LOW = "#56B4E9";
  const COLOR_A_SOFT = "rgba(224, 105, 0, 0.35)";
  const COLOR_B_SOFT = "rgba(0, 114, 178, 0.35)";

  const DEFAULT_A = { zip: "90045", short: "Los Angeles", label: "Los Angeles (90045)", state: "CA" };
  const DEFAULT_B = { zip: "97034", short: "Lake Oswego", label: "Lake Oswego (97034)", state: "OR" };
  const START_DATE = "2026-01-01";
  const STORAGE_KEY = "weatherTracker.customPair.v2";
  const STORAGE_KEY_LEGACY = "weatherTracker.customPair.v1";
  const TZ = "America/Los_Angeles";
  const DAILY =
    "temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum,rain_sum,cloud_cover_mean,daylight_duration";
  const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
  const SUGGEST_DEBOUNCE_MS = 280;
  const SUGGEST_MIN_CHARS = 2;

  const US_STATE_ABBREV = {
    Alabama: "AL",
    Alaska: "AK",
    Arizona: "AZ",
    Arkansas: "AR",
    California: "CA",
    Colorado: "CO",
    Connecticut: "CT",
    Delaware: "DE",
    "District of Columbia": "DC",
    Florida: "FL",
    Georgia: "GA",
    Hawaii: "HI",
    Idaho: "ID",
    Illinois: "IL",
    Indiana: "IN",
    Iowa: "IA",
    Kansas: "KS",
    Kentucky: "KY",
    Louisiana: "LA",
    Maine: "ME",
    Maryland: "MD",
    Massachusetts: "MA",
    Michigan: "MI",
    Minnesota: "MN",
    Mississippi: "MS",
    Missouri: "MO",
    Montana: "MT",
    Nebraska: "NE",
    Nevada: "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    Ohio: "OH",
    Oklahoma: "OK",
    Oregon: "OR",
    Pennsylvania: "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    Tennessee: "TN",
    Texas: "TX",
    Utah: "UT",
    Vermont: "VT",
    Virginia: "VA",
    Washington: "WA",
    "West Virginia": "WV",
    Wisconsin: "WI",
    Wyoming: "WY",
  };

  const metaEl = document.getElementById("meta");
  const taglineEl = document.getElementById("tagline");
  const formEl = document.getElementById("zip-form");
  const zipAInput = document.getElementById("zip-a");
  const zipBInput = document.getElementById("zip-b");
  const zipAResolved = document.getElementById("zip-a-resolved");
  const zipBResolved = document.getElementById("zip-b-resolved");
  const sugAEl = document.getElementById("zip-a-suggestions");
  const sugBEl = document.getElementById("zip-b-suggestions");
  const errorEl = document.getElementById("zip-error");
  const compareBtn = document.getElementById("zip-compare");
  const resetBtn = document.getElementById("zip-reset");

  const charts = {};
  let bundledData = null;
  let lastData = null;
  let activeMode = "default";

  const fieldState = {
    a: { input: zipAInput, resolved: zipAResolved, list: sugAEl, selected: null, timer: null, activeIndex: -1 },
    b: { input: zipBInput, resolved: zipBResolved, list: sugBEl, selected: null, timer: null, activeIndex: -1 },
  };

  function isNarrow() {
    return window.matchMedia("(max-width: 640px)").matches;
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function pacificTodayIso() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function validateZip(raw) {
    const zip = String(raw || "").trim();
    return /^\d{5}$/.test(zip) ? zip : null;
  }

  function stateAbbrev(admin1) {
    if (!admin1) return "";
    if (/^[A-Z]{2}$/.test(admin1)) return admin1;
    return US_STATE_ABBREV[admin1] || admin1;
  }

  function setError(msg) {
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function setBusy(busy) {
    compareBtn.disabled = busy;
    resetBtn.disabled = busy;
    zipAInput.disabled = busy;
    zipBInput.disabled = busy;
    compareBtn.textContent = busy ? "Loading…" : "Compare";
    if (busy) {
      hideSuggestions("a");
      hideSuggestions("b");
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function placeDisplayQuery(loc) {
    if (loc.zip) return loc.zip;
    return loc.short + (loc.state ? ", " + loc.state : "");
  }

  function taglinePart(loc) {
    let html = escapeHtml(loc.short);
    if (loc.zip) {
      html += ' <span class="zip">' + escapeHtml(loc.zip) + "</span>";
    } else if (loc.state) {
      html += ' <span class="zip">' + escapeHtml(loc.state) + "</span>";
    }
    return html;
  }

  function updateTagline(locA, locB) {
    taglineEl.innerHTML =
      taglinePart(locA) + " vs " + taglinePart(locB) + ", from the start of 2026 through today.";
  }

  function setResolved(el, place) {
    if (!place) {
      el.textContent = "";
      return;
    }
    const bits = [place.short];
    if (place.state) bits.push(place.state);
    let text = bits.filter(Boolean).join(", ");
    if (place.zip && place.short) text = place.short + (place.state ? ", " + place.state : "");
    el.textContent = text;
  }

  function syncForm(locA, locB) {
    zipAInput.value = placeDisplayQuery(locA);
    zipBInput.value = placeDisplayQuery(locB);
    fieldState.a.selected = locA;
    fieldState.b.selected = locB;
    setResolved(zipAResolved, locA);
    setResolved(zipBResolved, locB);
    hideSuggestions("a");
    hideSuggestions("b");
  }

  function baseOptions(yLabel) {
    const narrow = isNarrow();
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: "#c9d0ef",
            boxWidth: narrow ? 10 : 12,
            font: { size: narrow ? 11 : 12 },
            usePointStyle: true,
            pointStyle: "circle",
            padding: narrow ? 10 : 12,
          },
        },
        tooltip: {
          backgroundColor: "rgba(8, 12, 28, 0.95)",
          titleColor: "#e8ecff",
          bodyColor: "#c9d0ef",
          borderColor: "rgba(232, 236, 255, 0.12)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#8b93b8",
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: narrow ? 5 : 10,
            font: { size: narrow ? 10 : 12 },
          },
          grid: { color: "rgba(232, 236, 255, 0.06)" },
        },
        y: {
          title: {
            display: !narrow,
            text: yLabel,
            color: "#8b93b8",
          },
          ticks: {
            color: "#8b93b8",
            font: { size: narrow ? 10 : 12 },
            maxTicksLimit: narrow ? 6 : 8,
          },
          grid: { color: "rgba(232, 236, 255, 0.06)" },
        },
      },
    };
  }

  function lineDataset(label, data, color, dashed) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 1.75,
      pointRadius: 0,
      pointHoverRadius: isNarrow() ? 4 : 3,
      hitRadius: isNarrow() ? 8 : 4,
      tension: 0.2,
      borderDash: dashed ? [5, 4] : undefined,
    };
  }

  function destroyCharts() {
    Object.keys(charts).forEach((id) => {
      if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
      }
    });
  }

  function makeChart(id, config) {
    const el = document.getElementById(id);
    if (!el || typeof Chart === "undefined") return null;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, config);
    return charts[id];
  }

  function shortLabel(loc) {
    return loc.short || loc.zip || "City";
  }

  function renderCharts(data) {
    const labels = data.dates;
    const a = data.series.a;
    const b = data.series.b;
    const nameA = shortLabel(data.locations.a);
    const nameB = shortLabel(data.locations.b);

    destroyCharts();

    makeChart("chart-temp", {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(nameA + " high", a.high, COLOR_A, false),
          lineDataset(nameA + " low", a.low, COLOR_A_LOW, true),
          lineDataset(nameB + " high", b.high, COLOR_B, false),
          lineDataset(nameB + " low", b.low, COLOR_B_LOW, true),
        ],
      },
      options: baseOptions("°F"),
    });

    makeChart("chart-humidity", {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(nameA, a.humidity, COLOR_A, false),
          lineDataset(nameB, b.humidity, COLOR_B, false),
        ],
      },
      options: (() => {
        const o = baseOptions("%");
        o.scales.y.min = 0;
        o.scales.y.max = 100;
        return o;
      })(),
    });

    makeChart("chart-rain", {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: nameA,
            data: a.rain,
            borderColor: COLOR_A,
            backgroundColor: COLOR_A_SOFT,
            borderWidth: 1.75,
            pointRadius: 0,
            pointHoverRadius: isNarrow() ? 4 : 3,
            hitRadius: isNarrow() ? 8 : 4,
            tension: 0.15,
            fill: true,
          },
          {
            label: nameB,
            data: b.rain,
            borderColor: COLOR_B,
            backgroundColor: COLOR_B_SOFT,
            borderWidth: 1.75,
            pointRadius: 0,
            pointHoverRadius: isNarrow() ? 4 : 3,
            hitRadius: isNarrow() ? 8 : 4,
            tension: 0.15,
            fill: true,
          },
        ],
      },
      options: (() => {
        const o = baseOptions("inches");
        o.scales.y.min = 0;
        return o;
      })(),
    });

    makeChart("chart-cloud", {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(nameA, a.cloudCover, COLOR_A, false),
          lineDataset(nameB, b.cloudCover, COLOR_B, false),
        ],
      },
      options: (() => {
        const o = baseOptions("%");
        o.scales.y.min = 0;
        o.scales.y.max = 100;
        return o;
      })(),
    });

    makeChart("chart-daylight", {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(nameA, a.daylight, COLOR_A, false),
          lineDataset(nameB, b.daylight, COLOR_B, false),
        ],
      },
      options: baseOptions("hours"),
    });
  }

  function updateMeta(data, sourceNote) {
    const refresh = data.generatedAt
      ? " · last refresh " +
        new Date(data.generatedAt).toLocaleString("en-US", {
          timeZone: "America/Phoenix",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }) +
        " PT"
      : "";
    metaEl.textContent =
      data.dates.length +
      " days · " +
      fmtDate(data.startDate) +
      " → " +
      fmtDate(data.endDate) +
      refresh +
      (sourceNote ? " · " + sourceNote : "");
  }

  function applyView(data, mode) {
    activeMode = mode;
    lastData = data;
    updateTagline(data.locations.a, data.locations.b);
    syncForm(data.locations.a, data.locations.b);
    updateMeta(data, mode === "custom" ? "live fetch" : "");
    renderCharts(data);
  }

  function normalizeBundled(raw) {
    return {
      generatedAt: raw.generatedAt,
      startDate: raw.startDate,
      endDate: raw.endDate,
      dates: raw.dates,
      locations: {
        a: {
          zip: raw.locations.la.id,
          short: raw.locations.la.short,
          label: raw.locations.la.label,
          state: "CA",
          latitude: raw.locations.la.latitude,
          longitude: raw.locations.la.longitude,
        },
        b: {
          zip: raw.locations.lo.id,
          short: raw.locations.lo.short,
          label: raw.locations.lo.label,
          state: "OR",
          latitude: raw.locations.lo.latitude,
          longitude: raw.locations.lo.longitude,
        },
      },
      series: {
        a: raw.series.la,
        b: raw.series.lo,
      },
    };
  }

  async function loadBundled() {
    const res = await fetch("./data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load weather data");
    bundledData = normalizeBundled(await res.json());
    return bundledData;
  }

  function locFromGeocodeResult(r) {
    const state = stateAbbrev(r.admin1);
    const zip =
      Array.isArray(r.postcodes) && r.postcodes.length
        ? String(r.postcodes[0])
        : "";
    const short = r.name || "City";
    return {
      zip,
      short,
      state,
      label: zip ? short + " (" + zip + ")" : short + (state ? ", " + state : ""),
      latitude: r.latitude,
      longitude: r.longitude,
      geocodeId: r.id,
    };
  }

  function suggestionLabel(loc) {
    const main = loc.short + (loc.state ? ", " + loc.state : "");
    const meta = loc.zip ? "ZIP " + loc.zip : "";
    return { main, meta };
  }

  async function searchCities(name) {
    const params = new URLSearchParams({
      name: name,
      count: "5",
      language: "en",
      format: "json",
      countryCode: "US",
    });
    const res = await fetch(GEOCODE_URL + "?" + params.toString());
    if (!res.ok) throw new Error("City lookup failed. Try again in a moment.");
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .filter((r) => r && r.country_code === "US" && r.latitude != null && r.longitude != null)
      .map(locFromGeocodeResult);
  }

  async function lookupZip(zip) {
    const res = await fetch("https://api.zippopotam.us/us/" + zip);
    if (res.status === 404 || !res.ok) {
      throw new Error("No match for ZIP " + zip + ".");
    }
    const data = await res.json();
    const place = data.places && data.places[0];
    if (!place) throw new Error("No match for ZIP " + zip + ".");
    return {
      zip,
      short: place["place name"],
      state: place["state abbreviation"] || "",
      label: place["place name"] + " (" + zip + ")",
      latitude: parseFloat(place.latitude),
      longitude: parseFloat(place.longitude),
    };
  }

  function selectedStillMatches(slot, query) {
    const sel = fieldState[slot].selected;
    if (!sel) return false;
    const q = String(query || "").trim().toLowerCase();
    if (!q) return false;
    if (sel.zip && q === String(sel.zip).toLowerCase()) return true;
    const cityState = (sel.short + (sel.state ? ", " + sel.state : "")).toLowerCase();
    if (q === cityState) return true;
    if (q === String(sel.short || "").toLowerCase()) return true;
    if (sel.label && q === String(sel.label).toLowerCase()) return true;
    return false;
  }

  async function resolvePlace(slot, raw) {
    const query = String(raw || "").trim();
    if (!query) throw new Error("Enter a city name or 5-digit ZIP for both sides.");

    if (selectedStillMatches(slot, query)) {
      return fieldState[slot].selected;
    }

    const zip = validateZip(query);
    if (zip) return lookupZip(zip);

    if (query.length < SUGGEST_MIN_CHARS) {
      throw new Error("Enter a city name (at least 2 letters) or a 5-digit ZIP.");
    }

    const results = await searchCities(query);
    if (!results.length) {
      throw new Error('No US cities matched "' + query + '". Try another spelling or a ZIP.');
    }
    return results[0];
  }

  function hideSuggestions(slot) {
    const st = fieldState[slot];
    st.list.hidden = true;
    st.list.innerHTML = "";
    st.activeIndex = -1;
    st.input.setAttribute("aria-expanded", "false");
  }

  function setActiveSuggestion(slot, index) {
    const st = fieldState[slot];
    const buttons = st.list.querySelectorAll(".place-suggestion");
    if (!buttons.length) {
      st.activeIndex = -1;
      return;
    }
    const next = ((index % buttons.length) + buttons.length) % buttons.length;
    st.activeIndex = next;
    buttons.forEach((btn, i) => {
      btn.setAttribute("aria-selected", i === next ? "true" : "false");
    });
    buttons[next].scrollIntoView({ block: "nearest" });
  }

  function chooseSuggestion(slot, loc) {
    const st = fieldState[slot];
    st.selected = loc;
    st.input.value = placeDisplayQuery(loc);
    setResolved(st.resolved, loc);
    hideSuggestions(slot);
    setError("");
  }

  function renderSuggestions(slot, places, emptyMsg) {
    const st = fieldState[slot];
    st.list.innerHTML = "";
    st.activeIndex = -1;

    if (!places.length) {
      const li = document.createElement("li");
      li.className = "place-suggestions-empty";
      li.textContent = emptyMsg || "No matching US cities.";
      st.list.appendChild(li);
      st.list.hidden = false;
      st.input.setAttribute("aria-expanded", "true");
      return;
    }

    places.forEach((loc, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "presentation");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "place-suggestion";
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", "false");
      btn.id = "place-opt-" + slot + "-" + i;
      const labels = suggestionLabel(loc);
      btn.innerHTML =
        "<span>" +
        escapeHtml(labels.main) +
        "</span>" +
        (labels.meta
          ? '<span class="place-meta">' + escapeHtml(labels.meta) + "</span>"
          : "");
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        chooseSuggestion(slot, loc);
      });
      li.appendChild(btn);
      st.list.appendChild(li);
    });

    st.list.hidden = false;
    st.input.setAttribute("aria-expanded", "true");
  }

  async function runCitySuggest(slot) {
    const st = fieldState[slot];
    const query = String(st.input.value || "").trim();

    if (validateZip(query) || /^\d+$/.test(query)) {
      hideSuggestions(slot);
      return;
    }

    if (query.length < SUGGEST_MIN_CHARS) {
      hideSuggestions(slot);
      return;
    }

    try {
      const places = await searchCities(query);
      if (String(st.input.value || "").trim() !== query) return;
      if (!places.length) {
        renderSuggestions(slot, [], 'No US cities matched "' + query + '".');
        return;
      }
      renderSuggestions(slot, places);
    } catch (err) {
      if (String(st.input.value || "").trim() !== query) return;
      renderSuggestions(slot, [], "City lookup unavailable. Try a ZIP or try again.");
      console.error(err);
    }
  }

  function scheduleSuggest(slot) {
    const st = fieldState[slot];
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.timer = null;
      runCitySuggest(slot);
    }, SUGGEST_DEBOUNCE_MS);
  }

  function onFieldInput(slot) {
    const st = fieldState[slot];
    st.selected = null;
    setError("");
    const raw = st.input.value;
    // Soft ZIP assist: if the field is digits-only, cap at 5
    if (/^\d*$/.test(raw)) {
      st.input.value = raw.slice(0, 5);
      hideSuggestions(slot);
      return;
    }
    scheduleSuggest(slot);
  }

  function onFieldKeydown(slot, e) {
    const st = fieldState[slot];
    const open = !st.list.hidden;
    const buttons = st.list.querySelectorAll(".place-suggestion");

    if (e.key === "Escape") {
      hideSuggestions(slot);
      return;
    }

    if (!open || !buttons.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion(slot, st.activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion(slot, st.activeIndex <= 0 ? buttons.length - 1 : st.activeIndex - 1);
    } else if (e.key === "Enter" && st.activeIndex >= 0) {
      e.preventDefault();
      buttons[st.activeIndex].dispatchEvent(new MouseEvent("mousedown"));
    }
  }

  function onFieldBlur(slot) {
    // Delay so mousedown on a suggestion can fire first
    setTimeout(() => hideSuggestions(slot), 150);
  }

  async function fetchArchiveDaily(loc, endDate) {
    const params = new URLSearchParams({
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      start_date: START_DATE,
      end_date: endDate,
      daily: DAILY,
      timezone: TZ,
      temperature_unit: "fahrenheit",
      precipitation_unit: "inch",
    });
    const res = await fetch(
      "https://archive-api.open-meteo.com/v1/archive?" + params.toString()
    );
    const where = loc.zip || loc.short || "location";
    if (!res.ok) throw new Error("Weather fetch failed for " + where + ".");
    const raw = await res.json();
    if (!raw.daily || !raw.daily.time) {
      throw new Error("Unexpected weather response for " + where + ".");
    }
    return raw.daily;
  }

  function seriesFromDaily(daily) {
    return {
      high: daily.temperature_2m_max,
      low: daily.temperature_2m_min,
      humidity: daily.relative_humidity_2m_mean,
      rain: daily.rain_sum,
      cloudCover: daily.cloud_cover_mean,
      daylight: daily.daylight_duration.map((v) =>
        v == null ? null : Math.round((v / 3600) * 1000) / 1000
      ),
    };
  }

  function isDefaultPair(locA, locB) {
    return locA.zip === DEFAULT_A.zip && locB.zip === DEFAULT_B.zip;
  }

  async function fetchCustomPair(locA, locB) {
    const end = pacificTodayIso();
    const endDate = end < START_DATE ? START_DATE : end;

    setResolved(zipAResolved, locA);
    setResolved(zipBResolved, locB);

    const [dailyA, dailyB] = await Promise.all([
      fetchArchiveDaily(locA, endDate),
      fetchArchiveDaily(locB, endDate),
    ]);

    if (JSON.stringify(dailyA.time) !== JSON.stringify(dailyB.time)) {
      throw new Error("Date ranges did not match between the two locations.");
    }

    return {
      generatedAt: new Date().toISOString(),
      startDate: START_DATE,
      endDate,
      dates: dailyA.time,
      locations: { a: locA, b: locB },
      series: {
        a: seriesFromDaily(dailyA),
        b: seriesFromDaily(dailyB),
      },
    };
  }

  function saveCustom(locA, locB) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          a: {
            zip: locA.zip || "",
            short: locA.short,
            state: locA.state || "",
            label: locA.label,
            latitude: locA.latitude,
            longitude: locA.longitude,
          },
          b: {
            zip: locB.zip || "",
            short: locB.short,
            state: locB.state || "",
            label: locB.label,
            latitude: locB.latitude,
            longitude: locB.longitude,
          },
        })
      );
      try {
        localStorage.removeItem(STORAGE_KEY_LEGACY);
      } catch (_) {
        /* ignore */
      }
    } catch (_) {
      /* ignore */
    }
  }

  function clearCustom() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY_LEGACY);
    } catch (_) {
      /* ignore */
    }
  }

  function normalizeSavedLoc(raw) {
    if (!raw || typeof raw !== "object") return null;
    const lat = Number(raw.latitude);
    const lon = Number(raw.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const short = String(raw.short || "").trim();
    if (!short && !raw.zip) return null;
    return {
      zip: raw.zip ? String(raw.zip) : "",
      short: short || String(raw.zip),
      state: raw.state ? String(raw.state) : "",
      label: raw.label || short || String(raw.zip || ""),
      latitude: lat,
      longitude: lon,
    };
  }

  function readSavedCustom() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const a = normalizeSavedLoc(parsed.a);
        const b = normalizeSavedLoc(parsed.b);
        if (!a || !b) return null;
        if (isDefaultPair(a, b)) return null;
        return { a, b };
      }
    } catch (_) {
      /* fall through */
    }

    try {
      const legacy = localStorage.getItem(STORAGE_KEY_LEGACY);
      if (!legacy) return null;
      const parsed = JSON.parse(legacy);
      const zipA = validateZip(parsed.zipA);
      const zipB = validateZip(parsed.zipB);
      if (!zipA || !zipB) return null;
      if (zipA === DEFAULT_A.zip && zipB === DEFAULT_B.zip) return null;
      return { zipA, zipB, legacy: true };
    } catch (_) {
      return null;
    }
  }

  async function showDefaults() {
    clearCustom();
    setError("");
    hideSuggestions("a");
    hideSuggestions("b");
    if (!bundledData) await loadBundled();
    applyView(bundledData, "default");
  }

  async function showCustom(locA, locB) {
    setError("");
    setBusy(true);
    const labelA = locA.zip || locA.short;
    const labelB = locB.zip || locB.short;
    metaEl.textContent = "Fetching weather for " + labelA + " and " + labelB + "…";
    try {
      const data = await fetchCustomPair(locA, locB);
      saveCustom(locA, locB);
      applyView(data, "custom");
    } catch (err) {
      console.error(err);
      setError(
        err && err.message
          ? err.message
          : "Could not load weather for those places. Check the cities or ZIPs and try again."
      );
      if (lastData) {
        updateMeta(lastData, activeMode === "custom" ? "live fetch" : "");
      } else {
        metaEl.textContent = "Comparison not updated.";
      }
      throw err;
    } finally {
      setBusy(false);
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    hideSuggestions("a");
    hideSuggestions("b");

    (async () => {
      setError("");
      setBusy(true);
      try {
        const [locA, locB] = await Promise.all([
          resolvePlace("a", zipAInput.value),
          resolvePlace("b", zipBInput.value),
        ]);
        fieldState.a.selected = locA;
        fieldState.b.selected = locB;
        setResolved(zipAResolved, locA);
        setResolved(zipBResolved, locB);

        if (isDefaultPair(locA, locB)) {
          setBusy(false);
          await showDefaults();
          return;
        }

        // showCustom manages busy flag
        setBusy(false);
        await showCustom(locA, locB);
      } catch (err) {
        console.error(err);
        setBusy(false);
        setError(
          err && err.message
            ? err.message
            : "Could not resolve those places. Try a city from the list or a 5-digit ZIP."
        );
        if (lastData) {
          updateMeta(lastData, activeMode === "custom" ? "live fetch" : "");
        }
      }
    })();
  });

  resetBtn.addEventListener("click", () => {
    showDefaults().catch((err) => {
      metaEl.textContent = "Could not load weather data. Try refreshing in a moment.";
      console.error(err);
    });
  });

  ["a", "b"].forEach((slot) => {
    const st = fieldState[slot];
    st.input.addEventListener("input", () => onFieldInput(slot));
    st.input.addEventListener("keydown", (e) => onFieldKeydown(slot, e));
    st.input.addEventListener("blur", () => onFieldBlur(slot));
  });

  document.addEventListener("click", (e) => {
    if (!formEl.contains(e.target)) {
      hideSuggestions("a");
      hideSuggestions("b");
    }
  });

  const mq = window.matchMedia("(max-width: 640px)");
  function onViewportChange() {
    if (lastData) renderCharts(lastData);
  }
  if (mq.addEventListener) mq.addEventListener("change", onViewportChange);
  else if (mq.addListener) mq.addListener(onViewportChange);

  async function boot() {
    if (typeof Chart === "undefined") {
      setTimeout(boot, 40);
      return;
    }
    try {
      await loadBundled();
      const saved = readSavedCustom();
      if (saved) {
        if (saved.legacy) {
          syncForm(
            { zip: saved.zipA, short: "…", state: "" },
            { zip: saved.zipB, short: "…", state: "" }
          );
          try {
            const [locA, locB] = await Promise.all([
              lookupZip(saved.zipA),
              lookupZip(saved.zipB),
            ]);
            await showCustom(locA, locB);
            return;
          } catch (_) {
            /* fall through to defaults */
          }
        } else {
          syncForm(saved.a, saved.b);
          try {
            await showCustom(saved.a, saved.b);
            return;
          } catch (_) {
            /* fall through to defaults */
          }
        }
      }
      applyView(bundledData, "default");
    } catch (err) {
      metaEl.textContent = "Could not load weather data. Try refreshing in a moment.";
      console.error(err);
    }
  }

  boot();
})();
