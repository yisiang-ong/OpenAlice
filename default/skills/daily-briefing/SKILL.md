---
name: daily-briefing
description: >
  Produce the pre-open morning briefing as a scheduled headless run: today's
  macro/earnings landmines, an open-position review against each trade's
  journaled stop and targets (with stop-ratchet recommendations), account
  drawdown/heat status vs the guard limits, and at most 1–2 fresh trade-idea
  scans — pushed to the Inbox as ONE document. Use when the user asks for "a
  morning briefing", "daily market summary before the open", "check my
  positions every morning", or when a scheduled issue fires this workspace
  headlessly for its daily run. Recommendations only — this skill NEVER
  pushes orders on its own.
---

# Daily briefing — the pre-open desk note

A hedge-fund PM's morning packet, scaled to one account: what could hurt
today, how the open book stands against its plan, and whether anything new
deserves a card. It ends in exactly one `alice-uta inbox push` — never in an
autonomous order. Staging is allowed only when the user asked for it
explicitly and standing; pushing is always theirs.

## Procedure

### 1. Today's landmines

`alice-uta market clock` (is it even a trading day?), then
`traderhub economy fred-search` / FOMC docs for scheduled macro events
(CPI, FOMC, payrolls) and `traderhub equity earnings` for any holding or
watchlist name reporting within 5 trading days. Lead the briefing with these
— surprises are what kill risk plans.

### 2. Open-position review (the core section)

`alice-uta account info` + `alice-uta account portfolio`, then for each
`status: open` file in `journal/trades/` (convention in `trade-idea`):

- `alice-uta contract quote` — where is price vs the journaled stop and
  targets? Report distance in R (price − entry, divided by entry − stop),
  **with a plain reading** — e.g. "+0.6R (up about £118 of the way to your
  first target; stop still $93.60, ~1.4R below)".
- `alice analysis signals` with `trend_filter` — is the setup's regime
  still intact? Say it plainly: "still above its trend line" / "trend broke".
- Recommend, don't act: **ratchet the stop** (move it up to lock in gains —
  e.g. to breakeven after +1R, or trail below a rising average), **take
  partial at target**, **exit** (regime broken), or **hold as planned**.
  Each recommendation cites its evidence, states the order the user would
  place, AND says in one plain clause *why* — no bare jargon.
- Position in the journal but not the portfolio (stopped out overnight)
  → mark the journal entry `closed`, note realized R, flag it for a
  `trade-mentor` review.

### 3. Account risk status

From `alice-uta account info` + the journal: current equity, drawdown from
recent high, portfolio heat (Σ open `riskUsd`) vs the 5% cap, and headroom
under the max-drawdown / daily-loss guards. Each number gets a plain reading:
"heat 2.4% of the 5% cap (if every position stopped out today you'd lose
2.4%)"; "3% below your high-water mark — the max-drawdown guard blocks new
buys at 10%, so you have room". If a guard is close (within a third of its
limit), say so plainly — the user should never be surprised by a guard
rejection.

### 4. Fresh candidates (optional, capped)

Only if the book has risk headroom: run the `trade-idea` skill on the
watchlist / `traderhub board rotation` leaders. **At most 1–2 cards**, and
WATCH/NO TRADE verdicts are fine. No headroom → skip and say why.

### 5. Emit the briefing (this shape) + push ONE

Write to a dated file (`briefings/<YYYY-MM-DD>.md`) and
`alice-uta inbox push --doc <file> --comments "<two-line summary>"`.

```
# Morning briefing — <date>

In plain English — <1–2 sentences a beginner fully gets: is today risky,
                    how do my positions stand, is there anything to do.
                    E.g. "Quiet open, no data due. Your one position (NVDA)
                    is +0.6R and healthy — nothing to do. No new setups
                    worth taking today.">

## ⚠️ Landmines today
<CPI / FOMC / payrolls / earnings within 5 days on your names — or
 "none scheduled">

## Your positions
<per open trade: TICKER — R-distance WITH plain reading, regime in plain
 words, and → Recommendation (hold / ratchet / partial / exit) + why.
 "No open positions" if flat.>

## Account health
- Equity £<x> — <drawdown> below your high-water mark (<plain reading>)
- Portfolio heat <h>% of the 5% cap (<what you'd lose if all stopped at once>)
- Guard headroom: <how close to any limit, plainly — or "comfortable">

## New ideas
<0–2 trade cards if there's risk headroom; WATCH/NO TRADE fine — or
 "no fresh setups / no risk headroom, skipping and here's why">

Terms used: <one-line plain gloss of any term of art in THIS briefing —
R, heat, drawdown, high-water mark, ratchet…>. Full glossary:
docs/trading-glossary.md
```

**No naked jargon (same rule as the trade card).** A beginner reads the
briefing over breakfast and understands where they stand and what (if
anything) to do — without looking anything up. Every R-figure, heat %,
drawdown, and "ratchet/regime/partial" carries a plain reading; the Terms
line catches the rest. This is a daily-read surface, so the bar is *higher*
than the card, not lower.

**Quiet-day rule (still holds):** nothing actionable → the briefing is the
Plain-English line + three lines (clock, book unchanged, no setups), not
filler. Brevity and plainness are not in tension — a short briefing is still
fully readable by a beginner. Respect the reader's attention or lose it.

## Scheduling this (one-time setup)

Self-schedule via an issue file (see the `self-scheduling` skill). Create
`.alice/issues/morning-briefing.md`:

```markdown
---
title: Morning briefing
when: { kind: cron, cron: "30 13 * * 1-5" }
what: Run the daily-briefing skill end to end and push the result to the Inbox.
---
Pre-open desk note: landmines, open-position review vs journal stops,
guard/heat status, and at most 1-2 fresh trade cards.
```

`30 13 * * 1-5` ≈ 1h before the NYSE open (14:30 UK time in summer) —
confirm the scanner host's timezone and the user's preference before
writing the file, and adjust the cron accordingly.

### Optional: intraday stop-proximity check

A second issue (`when: { kind: every, every: 1h }` during your first weeks)
that quotes each open position and pushes to the Inbox **only** when price
has consumed >90% of the distance to a journaled stop or target — otherwise
it ends silently with no push. Be honest about what this is: a polling
narrator, not protection. The real safety net is the broker-side `tpsl`
stop placed with the order; if a position has no broker-side stop, that is
the finding to escalate.
