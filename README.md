# Token Radar — make.fun token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zesty-pika-87/token-radar-01-v3-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zesty-pika-87/token-radar-01-v3-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it ranks pre-token protocols by the implied value of a token
they might one day issue, and gives each one a concrete seven-step farm plan.

## How it runs

```sh
mkdir -p /tmp/tr-out
MAKEFUN_OUTPUT_DIR=/tmp/tr-out node main.ts --input input/snapshot.json
```

Node 22, standard library only. `main.ts` reads the sealed snapshot, writes
`board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes
`dossier.json` with the vendored `vendor/makefun-board.ts` library.

## The model (radar-2.2)

- **Live set.** Protocols whose token already trades (positive market cap, not a
  CEX) are the comparables. Their mcap/TVL ratios are the market's own price for
  one dollar of TVL.
- **Category multiple.** A category gets its own multiple only when at least 3
  live protocols in it trade: the median live ratio, shrunk toward the global
  median with a prior of 3: `(n·median + 3·global) / (n + 3)`, clamped to
  [0.02, 1.0]. With fewer than 3 live protocols — or none — the category takes
  the global median: one or two comparables are not enough evidence for a
  multiple of their own. Measured from the snapshot at run time — no name is
  hardcoded.
- **Growth.** 7-day TVL change clamped to [−50%, +100%]; multiplier
  `1 + (growth/100)·0.5`.
- **Maturity.** `0.6 + min(age, 1095)/1095·0.4`, age from `listed_at` (365 when
  unknown).
- **Chains.** `1 + min(chains−1, 4)·0.02`.
- **Implied value** = TVL × multiple × growth × maturity × chains.

The board covers the whole 40-protocol watchlist plus every pre-token protocol
that passes the exclusion rules, whatever its TVL (225 rows): the $50M floor
defines the watchlist, it is not a ceiling on discovery — the largest pre-token
protocols are the most valuable discoveries. Liquid-staking and liquid-restaking
protocols are ranked (the category demonstrably launches tokens); bridges stay out
(their largest entries are wrapped-asset and custodial products, and no record
field separates them from the farmable few). Live-token protocols are never ranked;
all 119 appear on the Live tab as the evidence the multiples come from, and each
category's multiple names its three largest live comparables. The Live tab shows the raw ratios
exactly as recorded in the snapshot; the model works from medians, so one
extreme value (Rain, about 400×) cannot move a multiple on its own.

## The dashboard

`dashboard/` is a static page with no network: a sortable, filterable board, a
detail view per protocol (model breakdown, category evidence, farm steps), a
Live-tokens tab, and a Methodology tab with the full formula and every measured
multiple. Seven page features: sortable headers, pins, a compare dialog, a
command palette (Ctrl/⌘K), a live what-if model sandbox, CSV export, and a
tabbed detail drawer — plus log-scale bars, so small values stay visible.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1aaz13gb&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
