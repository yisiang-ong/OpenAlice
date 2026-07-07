---
name: trade-idea
description: >
  Produce a complete, risk-sized TRADE CARD on a candidate — entry signal with
  dates, quantified historical edge, macro regime, positioning/market-reaction
  read, and a position size computed from THIS account's equity and risk
  budget — or an explicit NO TRADE / WATCH verdict. Use when the user wants an
  actionable idea with the full reasoning: "find me a trade", "is X a buy
  here", "what should I buy this week", "give me an entry on Y", "size this
  for my account", "should I take this breakout". This is the
  research-to-order pipeline: it picks up from a scan (`scan-value-chain`,
  `sector-rotation`) or a thesis (`build-thesis`) and ends at a staged order
  plus a journal entry — never a pushed order without the user's approval.
---

# Trade idea → TRADE CARD — the research-to-order pipeline

Turn "find me a trade" into a card a hedge-fund PM would sign off on: a dated,
falsifiable entry signal, the setup's measured historical edge, the macro and
positioning context, and a size that risks a fixed fraction of the account —
or an honest "no trade today."

**"NO TRADE" is a first-class, common output.** Most days, most names, there
is no edge. A card that says *no trade, here's what would change that* is a
successful run of this skill, not a failure. Never manufacture conviction to
have something to show.

## Account defaults for this user profile

Beginner, medium/medium-high risk. Unless the user explicitly overrides:

- **Risk per trade: 1% of equity** (raise to at most 2% only when the user
  says so in this conversation — never silently).
- **Max position: 20% of equity. Max portfolio heat: 5%** (sum of open risk —
  if every stop hit at once, the account loses at most 5%).
- **Paper account until the user explicitly graduates to a live broker.**
- The account may be *thought of* in GBP while trading USD instruments — the
  sizing tool handles the conversion; always show risk in **both £ and $**.

## Procedure (run the tools — never answer from memory)

### 0. Account context first

`alice-uta account info` and `alice-uta account portfolio` — equity, currency,
open positions. Then read the journal (`journal/trades/*.md`, see Journal
section) and sum `riskUsd` across `status: open` entries — that is the
**current open risk** the heat cap needs. No journal dir yet → open risk 0.

### 1. Candidates (max 3 deep dives)

The user's ticker if they named one. Otherwise: `traderhub board rotation`
for the sector wind, `traderhub equity discover --list <list>` for candidates
inside the favored sectors (gainers / undervalued-growth / growth-tech…), or
the value-chain dossier if one exists. Shortlist ≤3; deep-dive in order.

### 2. Entry signal — is there a dated trigger?

`alice analysis signals` (tool `detectSignals`) on the barId you would
actually trade (prefer a realtime broker bar over a delayed vendor —
`alice analysis search-bars` first). Named setups to check, pick what fits
the chart regime:

- trend entry: `ma_cross` fast 20 slow 50 (golden cross), with
  `trend_filter` period 200 as the regime gate — only long above the 200d.
- breakout: `breakout` lookback 55 with `minRvol` 1.5 — range break on
  real volume.
- pullback-in-trend: `rsi_cross` level 40–50 cross_above while
  `trend_filter` is bullish.

No active signal and nothing recent → **verdict WATCH** with the exact
trigger ("breaks $187.50 on RVOL ≥ 1.5") or **NO TRADE**. Cite events with
their dates and context verbatim — "EMA20 crossed above EMA50 on 2026-07-01,
RVOL 2.1" is the standard of evidence.

### 3. Quant evidence panel

`alice analysis quant` on the same barId: RSI(14), ATR(14), 20d RVOL,
z-score of price vs 1y, distance to 52w high. This is the card's raw
material — report values, with dates where they matter.

### 4. Historical edge — backtest the exact setup you propose

`alice analysis backtest` (tool `backtestSignal`) with the SAME signal spec
and the SAME stop/target you are about to propose (e.g. ATR×2 stop, 2R
target, ≥3 years). Quote **n, win rate, avg R, expectancy** on the card. If
the result carries the small-sample note (n < 10), quote the note verbatim —
an anecdote is not evidence. Negative expectancy → the setup is disqualified;
say so.

### 5. Fundamentals sanity + the earnings landmine

`traderhub equity financials/ratios/estimates` — is the company solvent,
growing, and not wildly mispriced vs its own history? This is a sanity gate,
not a valuation thesis (that's `build-thesis`). **Hard rule:**
`traderhub equity earnings` — if earnings fall within the expected hold,
flag it on the card; **never open a fresh position < 5 trading days before
earnings without telling the user explicitly.**

### 6. Macro regime — one paragraph, tailwind or headwind

`traderhub board get macro` (rates, CPI, dollar, sentiment),
`traderhub board get valuation` (index PE/CAPE stretch),
`traderhub board get fed` when positioning matters. Answer one question: is
the macro wind at this trade's back or in its face, and via which 2–3
datapoints? No macro essay.

### 7. Positioning / market reaction — crowded, hated, or ignored?

`traderhub equity short-interest` (squeeze fuel vs bear case),
`traderhub equity insiders` (are insiders buying their own story?),
`traderhub equity estimates` (revision direction), and
`alice rss grep`/`alice rss window` for the narrative. Classify: **crowded**
(consensus long — who's left to buy?), **hated** (heavy shorts — fuel if
right, company if wrong), or **ignored** (no narrative — slow but clean).

### 8. Size it

`alice-uta plan size` (tool `positionSize`) with: the account's equity and
currency (GBP account trading USD → pass `currency: 'GBP'`), entry, stop
(ATR×2 or the structure level that falsifies the setup — whichever is
farther is honest, whichever is nearer is cheaper; pick the one that matches
the setup's logic and say which), `currentOpenRiskUsd` from step 0, and the
backtest stats as the Kelly inputs. The tool returns qty, targets, £/$ risk,
and which cap bound the size. It is advisory — guards re-check at push time.

### 9. Emit the TRADE CARD (this exact shape)

```
## TRADE CARD — <TICKER> LONG            <date>
Verdict: TRADE | NO TRADE | WATCH (trigger: <exact condition>)

1. Setup & entry   — <signal name>, fired <date> (<context values>);
                     entry zone <range>
2. Quant evidence  — RSI, ATR, RVOL, z-score, % from 52w high (dated)
3. Historical edge — n=<n> since <year>: <win>% win, avg <avgR>R,
                     expectancy <E>R, worst streak <k> losses
                     <small-sample note verbatim if present>
4. Macro           — <tailwind|headwind|neutral>: <2–3 board datapoints>
5. Positioning     — <crowded|hated|ignored>: short interest, insiders,
                     revisions, narrative one-liner
6. Risk plan (<equity> account)
                   — qty <q> @ <entry>, stop <stop> (<basis>),
                     targets <T1/T2/T3> (R:R <r> at T1),
                     risk £<x> / $<y> = <z>% of equity,
                     portfolio heat after: <h>%
7. What invalidates this — 2–3 falsifiable conditions (price level,
                     signal reversal, thesis event)
8. Confidence      — low|med|high, and the ONE thing that would change it
9. New terms       — one-line beginner definition of every term of art
                     used above (R-multiple, expectancy, ATR, RVOL, heat…)
```

Every number on the card must have come out of a tool call in this run — no
recalled statistics, no vibes.

### 10. Execution (only on the user's explicit yes) + journal

Paper account unless the user has graduated. On approval:
`alice-uta order place` **with the stop from the card as the `tpsl` stop**
(broker-side protection — the real safety net), then
`alice-uta git commit -m "<card title>"` and `alice-uta git push` (the user
approves the push in the UI). Then write the journal entry.

## Journal convention (shared with trade-mentor and retrospective)

One file per trade: `journal/trades/<YYYY-MM-DD>-<SYMBOL>.md`

```markdown
---
symbol: NVDA
direction: long
status: open            # open | closed
entryDate: 2026-07-06
entryPrice: 100.00
qty: 50
stopPrice: 95.00
targets: [105, 110, 115]
riskUsd: 250
riskGbp: 197
setup: ma_cross 20/50 + trend_filter 200
cardRef: <inbox doc or workspace path of the card>
---
<the full trade card>

## Exit / lessons (fill on close)
```

Open portfolio heat = Σ `riskUsd` over `status: open` files — step 0 of the
next run reads it, `trade-mentor` reviews it, `retrospective` replays closed
trades. Update `status`, exit details, and lessons when a position closes.
