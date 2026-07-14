# cron-builder

**Read, write & preview cron expressions — instantly, in your browser.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/eng-AhmedMahmoud/cron-builder/pulls)

> Live demo: https://cron-builder-mu.vercel.app

## The problem

Cron expressions are terse, easy to get wrong, and hard to read at a glance. Is
`*/15 9-17 * * 1-5` really "every 15 minutes during business hours on weekdays"?
And when does it *actually* fire next? cron-builder answers both — it turns any
standard cron expression into plain English and lists the next run times, or
builds a correct expression for you from friendly presets. Everything runs
client-side: no build step, no dependencies, no network.

## Features

- **Live validation** with a clear inline error for malformed input.
- **Plain-English description** — e.g. `*/15 9-17 * * 1-5` → *"Every 15 minutes,
  between 09:00 and 17:59, Monday through Friday."*
- **Next 5 run times** computed from your local time, with friendly relative
  labels ("in 12 minutes").
- **Preset builder** — pick every minute / every N minutes / hourly / daily /
  weekly / monthly and generate the expression.
- **Shorthand macros** — `@hourly`, `@daily`, `@weekly`, `@monthly`,
  `@yearly`/`@annually`, `@midnight` are expanded automatically.
- **Copy** button and a field legend so the 5-field structure stays legible.
- 100% client-side, zero dependencies, zero build step.

## Supported syntax

Standard 5-field cron: `minute hour day-of-month month day-of-week`.

| Syntax        | Meaning                          | Example        |
| ------------- | -------------------------------- | -------------- |
| `*`           | every value                      | `* * * * *`    |
| `5`           | a specific value                 | `0 9 * * *`    |
| `1,2,3`       | a list of values                 | `0 9,17 * * *` |
| `1-5`         | a range                          | `0 9 * * 1-5`  |
| `*/5`         | a step over the whole range      | `*/5 * * * *`  |
| `1-30/2`      | a step over a range              | `1-30/2 * * *` |
| `jan`..`dec`  | month names (case-insensitive)   | `0 0 1 jan *`  |
| `sun`..`sat`  | day names (case-insensitive)     | `0 9 * * mon`  |
| `@daily` etc. | shorthand macros                 | `@weekly`      |

## Run locally

No install needed — just open `index.html` in a browser. Or serve it statically:

```bash
npm run dev   # runs: npx --yes serve .
```

## License

GPL-3.0-or-later.

---

Built by [Devya](https://devya.dev)
