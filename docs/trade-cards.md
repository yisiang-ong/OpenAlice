# Trade Cards — the beginner-safe research-to-order pipeline

The trade-card layer turns OpenAlice's research surface into risk-sized,
fully-explained trade decisions: a dated entry signal, its measured
historical edge, macro and positioning context, and a position size derived
from a fixed fraction of account equity — presented so a beginner can follow
the reasoning and learn from it. Recommendations end at a staged order; the
user always pushes.

## Feature map

| Layer | What | Where |
|---|---|---|
| Signal detection | `detectSignals` — dated crossings (`ma_cross`, `rsi_cross`, `macd_cross`), volume-confirmed `breakout`/`breakdown`, regime states (`trend_filter`, `high_52w_proximity`) with citation-grade context | `src/domain/analysis/signal/{rolling,detect}.ts`, tool `src/tool/signal.ts`, CLI `alice analysis signals` |
| Edge measurement | `backtestSignal` — every historical firing of a signal spec replayed through an ATR/pct stop + R-multiple target bracket (intrabar, stop wins ties, gap-aware: a bar that opens beyond a level fills at the open, so a gapped stop books its real, worse-than-−1R loss; non-overlapping); win rate, avg R, expectancy, small-sample flag. `simulate` gained the same `bracket` exit rule for single entries | `src/domain/analysis/signal/backtest.ts`, `src/domain/analysis/simulate.ts`, CLI `alice analysis backtest` |
| Position sizing | `positionSize` — fixed-fractional risk (default 1%/trade, hard error above 2%), position-% cap, portfolio-heat cap, optional fractional-Kelly cap; account-currency aware (GBP account trading USD instruments shows risk in both £ and $) | `src/domain/trading-plan/position-size.ts`, tool `src/tool/position-size.ts`, CLI `alice-uta plan size` |
| Enforced risk guards | `max-drawdown` (blocks new entries beyond N% below the account's high-water mark; exits always pass) and `daily-loss-limit` (blocks new entries after an N% down day) join the existing guard pipeline | `services/uta/src/domain/trading/guards/{max-drawdown,daily-loss-limit}.ts` |
| Orchestration | `trade-idea` skill — the research-to-order procedure ending in the TRADE CARD template and a journal entry; "no trade" is a first-class verdict | `default/skills/trade-idea/SKILL.md` |
| Education | `trade-mentor` skill — beginner explanations in the account's own £ numbers, risk curriculum, journal-review protocol | `default/skills/trade-mentor/SKILL.md` |
| Automation | `daily-briefing` skill — scheduled pre-open Inbox briefing: landmines, open-position review vs journaled stops, guard/heat status, ≤2 fresh cards | `default/skills/daily-briefing/SKILL.md` |

All three skills ship in the chat workspace template
(`src/workspaces/templates/chat/template.json` → `bundledSkills`).

## Recommended account guard config

For a beginner-profile account (`accounts.json` entry, editable in
Settings → the guards apply per account):

```json
"guards": [
  { "type": "max-position-size", "options": { "maxPercentOfEquity": 20 } },
  { "type": "max-drawdown", "options": { "maxDrawdownPct": 10 } },
  { "type": "daily-loss-limit", "options": { "maxDailyLossPct": 3 } }
]
```

Guard state lives at `data/trading/<accountId>/hwm.json` and
`day-anchor.json` (atomic writes, self-healing). Both guards reject with
teaching messages and never block `closePosition` OR a risk-reducing
`placeOrder` (a sell against an existing long / buy against a short, no
larger than the position) — you can always get out, including via staged
limit exits. The daily-loss anchor rolls over to **yesterday's last-known
equity**, so an overnight gap down counts against today's limit rather than
giving the first order of the day a free pass. A non-numeric guard option
falls back to the default with a warning — a config typo can never silently
disable a safety guard.

## The journal convention

One file per trade at `journal/trades/<YYYY-MM-DD>-<SYMBOL>.md` inside the
workspace (YAML frontmatter: symbol, direction, status, entry, qty, stop,
targets, riskUsd, riskGbp, setup; body: the trade card, later the exit and
lessons). Portfolio heat = Σ `riskUsd` over `status: open` files —
`trade-idea` reads it before sizing, `daily-briefing` reports it,
`trade-mentor` reviews realized R against the cards' promised edge.
Defined in `default/skills/trade-idea/SKILL.md`.

## Division of labor (matches the repo philosophy)

Deterministic math and data are tools (`detectSignals`, `backtestSignal`,
`positionSize`, boards, fundamentals); judgment and narrative are skills the
workspace agent executes; hard limits are guards UTA enforces at push time
regardless of what the agent computed. Sizing output is advisory; guards are
the law.

## Known follow-ups

- Portfolio-heat is advisory only (UTA doesn't know per-position stop
  prices, so open risk isn't computable inside the guard pipeline without a
  stop registry).
- `backtestSignal` is long-only v1.
- No LSE/UK-equity broker — GBP is handled as an account/valuation currency;
  instruments trade in USD venues.
