"use strict";

/* ============================================================
 * cron-builder — vanilla, dependency-free cron toolkit
 * Standard 5-field cron: minute hour day-of-month month day-of-week
 * ============================================================ */

/* ---------- Constants ---------- */

var MONTH_NAMES = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
var DAY_NAMES = ["sun","mon","tue","wed","thu","fri","sat"];
var DAY_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var MONTH_FULL = ["January","February","March","April","May","June","July","August",
  "September","October","November","December"];

// Shorthand macros -> equivalent 5-field expression
var MACROS = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *"
};

// Per-field bounds and name maps.
var FIELDS = [
  { name: "minute",  min: 0, max: 59, names: null },
  { name: "hour",    min: 0, max: 23, names: null },
  { name: "day",     min: 1, max: 31, names: null },
  { name: "month",   min: 1, max: 12, names: MONTH_NAMES }, // names map to 1..12
  { name: "weekday", min: 0, max: 6,  names: DAY_NAMES }    // 0 & 7 == Sunday
];

/* ---------- Parser ---------- */

// Resolve a token that may be a number or a name into an integer, per field.
function resolveToken(tok, field) {
  var t = String(tok).trim().toLowerCase();
  if (t === "") return NaN;
  if (field.names) {
    var idx = field.names.indexOf(t.slice(0, 3));
    if (idx !== -1) {
      // month names -> 1..12 ; day names -> 0..6
      return field.name === "month" ? idx + 1 : idx;
    }
  }
  if (!/^\d+$/.test(t)) return NaN;
  return parseInt(t, 10);
}

// Parse a single field into a sorted, de-duplicated array of allowed values.
function parseField(raw, field) {
  var parts = String(raw).split(",");
  var set = {};
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part === "") throw new Error("empty term in " + field.name + " field");

    // Split off an optional step: "<range>/<step>"
    var step = 1;
    var slash = part.indexOf("/");
    var rangeExpr = part;
    if (slash !== -1) {
      rangeExpr = part.slice(0, slash);
      var stepStr = part.slice(slash + 1);
      if (!/^\d+$/.test(stepStr)) throw new Error("bad step in " + field.name + " field");
      step = parseInt(stepStr, 10);
      if (step < 1) throw new Error("step must be >= 1 in " + field.name + " field");
    }

    var lo, hi;
    if (rangeExpr === "*") {
      lo = field.min;
      hi = field.max;
    } else if (rangeExpr.indexOf("-") !== -1) {
      var bounds = rangeExpr.split("-");
      if (bounds.length !== 2) throw new Error("bad range in " + field.name + " field");
      lo = resolveToken(bounds[0], field);
      hi = resolveToken(bounds[1], field);
    } else {
      lo = resolveToken(rangeExpr, field);
      // A single value with a step means "from value to max, stepping".
      hi = (slash !== -1) ? field.max : lo;
    }

    if (isNaN(lo) || isNaN(hi)) throw new Error("invalid value in " + field.name + " field");

    // Normalize weekday 7 -> 0 (Sunday) for numeric bounds.
    if (field.name === "weekday") {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 0;
    }

    if (lo < field.min || hi > field.max) {
      throw new Error(field.name + " value out of range (" + field.min + "-" + field.max + ")");
    }
    if (lo > hi) throw new Error("range start after end in " + field.name + " field");

    for (var v = lo; v <= hi; v += step) set[v] = true;
  }

  var out = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  if (out.length === 0) throw new Error("no values in " + field.name + " field");
  return out;
}

// Parse a full cron expression (5 fields or a supported macro) into a schedule.
// Returns { fields: {minute,hour,day,month,weekday}, raw: [..5 strings..] }.
function parseCron(expr) {
  if (expr == null) throw new Error("empty expression");
  var text = String(expr).trim();
  if (text === "") throw new Error("empty expression");

  var lower = text.toLowerCase();
  if (lower.charAt(0) === "@") {
    if (!Object.prototype.hasOwnProperty.call(MACROS, lower)) {
      throw new Error("unknown shorthand: " + text);
    }
    text = MACROS[lower];
  }

  var tokens = text.split(/\s+/);
  if (tokens.length !== 5) {
    throw new Error("expected 5 fields, got " + tokens.length);
  }

  var parsed = {};
  for (var i = 0; i < 5; i++) {
    parsed[FIELDS[i].name] = parseField(tokens[i], FIELDS[i]);
  }
  return { fields: parsed, raw: tokens };
}

/* ---------- Matching & next-run computation ---------- */

// Does a given Date satisfy the parsed schedule?
// Cron semantics: if BOTH day-of-month and day-of-week are restricted
// (not "*"), a match on EITHER fires. Otherwise both must match.
function matches(sched, date) {
  var f = sched.fields;
  if (f.minute.indexOf(date.getMinutes()) === -1) return false;
  if (f.hour.indexOf(date.getHours()) === -1) return false;
  if (f.month.indexOf(date.getMonth() + 1) === -1) return false;

  var domRestricted = isRestricted(sched.raw[2]); // day-of-month
  var dowRestricted = isRestricted(sched.raw[4]); // day-of-week

  var domOk = f.day.indexOf(date.getDate()) !== -1;
  var dowOk = f.weekday.indexOf(date.getDay()) !== -1;

  if (domRestricted && dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

function isRestricted(fieldStr) {
  return String(fieldStr).trim() !== "*";
}

// Compute the next `count` fire times strictly after `from` (local time),
// stepping minute-by-minute with a cap to stay bounded.
function nextRuns(sched, from, count) {
  count = count || 5;
  var results = [];
  var d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // strictly after "from"

  // Cap: ~4 years of minutes so an impossible schedule (e.g. Feb 30) terminates.
  var MAX_STEPS = 366 * 4 * 24 * 60;
  for (var i = 0; i < MAX_STEPS && results.length < count; i++) {
    if (matches(sched, d)) results.push(new Date(d.getTime()));
    d.setMinutes(d.getMinutes() + 1);
  }
  return results;
}

/* ---------- Humanizer ---------- */

function pad2(n) { return n < 10 ? "0" + n : String(n); }

// Turn a parsed field array + its raw string into a phrase describing when.
function fieldPhrase(values, raw, field) {
  var trimmed = String(raw).trim();
  if (trimmed === "*") return { every: true };

  // Pure step over full range, e.g. "*/15"
  var stepMatch = /^\*\/(\d+)$/.exec(trimmed);
  if (stepMatch) return { step: parseInt(stepMatch[1], 10) };

  return { values: values };
}

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + " and " + items[1];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

// Detect a contiguous run start..end (used for "9 through 17").
function contiguousRange(values) {
  if (values.length < 2) return null;
  for (var i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return null;
  }
  return { start: values[0], end: values[values.length - 1] };
}

function describeTime(sched) {
  var m = sched.fields.minute;
  var h = sched.fields.hour;
  var rawMin = sched.raw[0].trim();
  var rawHour = sched.raw[1].trim();

  var minStar = rawMin === "*";
  var hourStar = rawHour === "*";
  var minStep = /^\*\/(\d+)$/.exec(rawMin);
  var hourStep = /^\*\/(\d+)$/.exec(rawHour);

  // Every minute.
  if (minStar && hourStar) return "Every minute";

  // Every N minutes.
  if (minStep && hourStar) return "Every " + minStep[1] + " minute" + (minStep[1] === "1" ? "" : "s");

  // Every N minutes within an hour window.
  if (minStep && !hourStar) {
    return "Every " + minStep[1] + " minutes, " + hourWindow(h, rawHour, hourStep);
  }

  // Minute wildcard within specific hours: "every minute past hour X".
  if (minStar && !hourStar) {
    return "Every minute, " + hourWindow(h, rawHour, hourStep);
  }

  // Specific minute(s) — the common exact-time case.
  if (m.length === 1 && h.length >= 1 && !hourStep) {
    if (h.length === 1) {
      return "At " + pad2(h[0]) + ":" + pad2(m[0]);
    }
    var times = h.map(function (hh) { return pad2(hh) + ":" + pad2(m[0]); });
    return "At " + joinList(times);
  }

  // Specific minute(s), hourly.
  if (hourStar) {
    var mins = m.map(function (mm) { return "minute " + mm; });
    return "At " + joinList(mins) + " past every hour";
  }

  // Fallback: minutes past a set of hours.
  var minLabel = m.map(function (mm) { return "minute " + mm; });
  return "At " + joinList(minLabel) + ", " + hourWindow(h, rawHour, hourStep);
}

function hourWindow(hours, rawHour, hourStep) {
  if (hourStep) {
    return "every " + hourStep[1] + " hours";
  }
  var range = contiguousRange(hours);
  if (range && hours.length > 1) {
    return "between " + pad2(range.start) + ":00 and " + pad2(range.end) + ":59";
  }
  if (hours.length === 1) {
    return "during hour " + pad2(hours[0]) + ":00";
  }
  var labels = hours.map(function (h) { return pad2(h) + ":00"; });
  return "at " + joinList(labels);
}

function describeDayOfWeek(sched) {
  var raw = sched.raw[4].trim();
  if (raw === "*") return null;
  var vals = sched.fields.weekday;

  var stepMatch = /^\*\/(\d+)$/.exec(raw);
  if (stepMatch) return "every " + stepMatch[1] + " days of the week";

  var range = contiguousRange(vals);
  if (range && vals.length > 1) {
    return DAY_FULL[range.start] + " through " + DAY_FULL[range.end];
  }
  var names = vals.map(function (v) { return DAY_FULL[v]; });
  return "on " + joinList(names);
}

function describeDayOfMonth(sched) {
  var raw = sched.raw[2].trim();
  if (raw === "*") return null;
  var vals = sched.fields.day;

  var stepMatch = /^\*\/(\d+)$/.exec(raw);
  if (stepMatch) return "every " + stepMatch[1] + " days of the month";

  var range = contiguousRange(vals);
  if (range && vals.length > 1) {
    return "on day " + range.start + " through " + range.end + " of the month";
  }
  var ords = vals.map(ordinal);
  return "on the " + joinList(ords);
}

function describeMonth(sched) {
  var raw = sched.raw[3].trim();
  if (raw === "*") return null;
  var vals = sched.fields.month;

  var stepMatch = /^\*\/(\d+)$/.exec(raw);
  if (stepMatch) return "every " + stepMatch[1] + " months";

  var range = contiguousRange(vals);
  if (range && vals.length > 1) {
    return MONTH_FULL[range.start - 1] + " through " + MONTH_FULL[range.end - 1];
  }
  var names = vals.map(function (v) { return MONTH_FULL[v - 1]; });
  return "in " + joinList(names);
}

function ordinal(n) {
  var s = ["th", "st", "nd", "rd"];
  var v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Build a full plain-English sentence for a parsed schedule.
function humanize(sched) {
  var parts = [describeTime(sched)];

  var dom = describeDayOfMonth(sched);
  var dow = describeDayOfWeek(sched);
  var month = describeMonth(sched);

  // Cron OR-semantics when both day fields restricted.
  if (dom && dow) {
    parts.push(dom + " and " + dow);
  } else {
    if (dom) parts.push(dom);
    if (dow) parts.push(dow);
  }
  if (month) parts.push(month);

  var sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

/* ---------- Formatting helpers (UI) ---------- */

function formatDateTime(d) {
  try {
    return d.toLocaleString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch (e) {
    return d.toString();
  }
}

function relativeTime(target, now) {
  var diffMs = target.getTime() - now.getTime();
  var mins = Math.round(diffMs / 60000);
  if (mins < 1) return "in under a minute";
  if (mins < 60) return "in " + mins + " minute" + (mins === 1 ? "" : "s");
  var hours = Math.round(mins / 60);
  if (hours < 24) return "in " + hours + " hour" + (hours === 1 ? "" : "s");
  var days = Math.round(hours / 24);
  if (days < 30) return "in " + days + " day" + (days === 1 ? "" : "s");
  var months = Math.round(days / 30);
  if (months < 12) return "in " + months + " month" + (months === 1 ? "" : "s");
  var years = Math.round(months / 12);
  return "in " + years + " year" + (years === 1 ? "" : "s");
}

/* ---------- Preset builder ---------- */

function buildExpression(state) {
  var hh = 0, mm = 0;
  if (state.time) {
    var bits = state.time.split(":");
    hh = parseInt(bits[0], 10) || 0;
    mm = parseInt(bits[1], 10) || 0;
  }
  switch (state.freq) {
    case "everyMinute":
      return "* * * * *";
    case "everyNMinutes":
      return "*/" + Math.max(1, state.n) + " * * * *";
    case "hourly":
      return "0 * * * *";
    case "daily":
      return mm + " " + hh + " * * *";
    case "weekly":
      return mm + " " + hh + " * * " + state.day;
    case "monthly":
      return mm + " " + hh + " " + state.date + " * *";
    default:
      return "* * * * *";
  }
}

/* ============================================================
 * DOM wiring (skipped in non-browser environments)
 * ============================================================ */

if (typeof document !== "undefined") {
  (function initUI() {
    var input = document.getElementById("cronInput");
    var errorEl = document.getElementById("cronError");
    var humanEl = document.getElementById("humanText");
    var dot = document.getElementById("statusDot");
    var runsEl = document.getElementById("nextRuns");
    var copyBtn = document.getElementById("copyBtn");

    var fieldEls = {
      minute: document.getElementById("f-minute"),
      hour: document.getElementById("f-hour"),
      day: document.getElementById("f-dom"),
      month: document.getElementById("f-month"),
      weekday: document.getElementById("f-dow")
    };

    // Preset controls
    var freqSelect = document.getElementById("freqSelect");
    var ctrlN = document.getElementById("ctrl-n");
    var ctrlTime = document.getElementById("ctrl-time");
    var ctrlDay = document.getElementById("ctrl-day");
    var ctrlDate = document.getElementById("ctrl-date");
    var everyN = document.getElementById("everyN");
    var timePick = document.getElementById("timePick");
    var daySelect = document.getElementById("daySelect");
    var dateSelect = document.getElementById("dateSelect");
    var applyPreset = document.getElementById("applyPreset");

    // Populate day-of-month options 1..31
    for (var d = 1; d <= 31; d++) {
      var opt = document.createElement("option");
      opt.value = String(d);
      opt.textContent = ordinal(d);
      dateSelect.appendChild(opt);
    }

    function updateFieldLegend(raw) {
      var names = ["minute", "hour", "day", "month", "weekday"];
      for (var i = 0; i < 5; i++) {
        fieldEls[names[i]].textContent = raw && raw[i] ? raw[i] : "—";
      }
    }

    function render() {
      var expr = input.value;
      var sched;
      try {
        sched = parseCron(expr);
      } catch (err) {
        input.classList.remove("is-valid");
        input.classList.add("is-invalid");
        dot.classList.remove("ok");
        dot.classList.add("bad");
        errorEl.hidden = false;
        errorEl.textContent = "Invalid: " + err.message;
        humanEl.textContent = "—";
        runsEl.innerHTML = '<li class="empty">Fix the expression to see next runs.</li>';
        updateFieldLegend(null);
        return;
      }

      input.classList.add("is-valid");
      input.classList.remove("is-invalid");
      dot.classList.add("ok");
      dot.classList.remove("bad");
      errorEl.hidden = true;
      errorEl.textContent = "";

      updateFieldLegend(sched.raw);
      humanEl.textContent = humanize(sched);

      var now = new Date();
      var runs = nextRuns(sched, now, 5);
      if (runs.length === 0) {
        runsEl.innerHTML = '<li class="empty">No upcoming runs within the search window.</li>';
      } else {
        runsEl.innerHTML = "";
        runs.forEach(function (r) {
          var li = document.createElement("li");
          var when = document.createElement("span");
          when.className = "when";
          when.textContent = formatDateTime(r);
          var rel = document.createElement("span");
          rel.className = "rel";
          rel.textContent = relativeTime(r, now);
          li.appendChild(when);
          li.appendChild(rel);
          runsEl.appendChild(li);
        });
      }
    }

    function syncPresetControls() {
      var freq = freqSelect.value;
      ctrlN.hidden = freq !== "everyNMinutes";
      ctrlTime.hidden = !(freq === "daily" || freq === "weekly" || freq === "monthly");
      ctrlDay.hidden = freq !== "weekly";
      ctrlDate.hidden = freq !== "monthly";
    }

    function applyPresetToInput() {
      var expr = buildExpression({
        freq: freqSelect.value,
        n: parseInt(everyN.value, 10) || 1,
        time: timePick.value,
        day: daySelect.value,
        date: dateSelect.value
      });
      input.value = expr;
      render();
    }

    // Copy button
    copyBtn.addEventListener("click", function () {
      var text = input.value;
      var done = function () {
        copyBtn.textContent = "Copied";
        copyBtn.classList.add("copied");
        setTimeout(function () {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("copied");
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
      } else {
        legacyCopy(text);
        done();
      }
    });

    function legacyCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }

    // Events
    input.addEventListener("input", render);
    freqSelect.addEventListener("change", syncPresetControls);
    applyPreset.addEventListener("click", applyPresetToInput);

    // Initial paint
    syncPresetControls();
    render();
  })();
}

/* ---------- Exports for testing (Node) ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseCron: parseCron, matches: matches, nextRuns: nextRuns, humanize: humanize };
}
