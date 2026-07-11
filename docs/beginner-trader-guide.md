# The Beginner Trader's Guide to OpenAlice

*How to use OpenAlice's trade-card toolkit to learn the craft the way
professionals actually practice it — process first, survival always,
edge measured rather than felt.*

> [!CAUTION]
> OpenAlice is experimental software and nothing in it — including this
> guide — is financial advice. Hedge funds lose money in bad years too;
> no tool makes profit certain. What this toolkit *can* give you is the
> thing that separates professionals from gamblers: a disciplined,
> measurable, survivable process. Trade on a **paper account** until your
> own journal proves you're ready for anything else.

---

## 1. The honest starting point

Ask what a hedge-fund PM actually does differently from a beginner, and
it's not "picks better stocks." It's four habits:

1. **They never enter without knowing where they're wrong.** Every
   position has a stop — the price at which the idea is falsified —
   *before* the entry, and the size is derived from that stop.
2. **They risk a tiny, fixed fraction per idea** (typically ~1% of the
   book), so a losing streak — which *will* happen — is survivable.
3. **They measure their edge instead of trusting their feelings.** A
   setup is only tradeable if its historical record says it makes money
   on average.
4. **They review their own trades like an outsider would**, grading the
   process (did I follow my rules?) rather than the outcome (did I win?).

Everything OpenAlice's trade-card layer ships exists to make those four
habits your default — the math is done by deterministic tools, the
reasoning is shown to you line by line, and the hard limits are enforced
even when you (or the agent) get excited.

## 2. Setup — fifteen minutes

1. **Install and run OpenAlice** — follow the [Quick Start in the
   README](../README.md#quick-start) (`pnpm install && pnpm dev`, or the
   desktop build), and have one agent CLI (`claude` or `codex`) installed
   and logged in.
2. **Create a chat workspace** in the UI. The three trading skills this
   guide is built around — `trade-idea`, `trade-mentor`,
   `daily-briefing` — ship bundled in the chat workspace template, so the
   agent in that workspace already knows the procedures.
3. **Connect a paper account.** In **Settings → Trading**, add a
   demo/paper broker account (Alpaca paper is the easiest). **Do not
   connect a live funded account yet** — Section 8 defines what "yet"
   means.
4. **Add the beginner guard rails.** Guards live on the account itself,
   not on a separate settings page: in **Settings → Trading**, open your
   account's edit dialog and expand its collapsible **Guards** section
   (it shows a count, e.g. *Guards (0)*). Add these three (stored in
   `accounts.json`):

   ```json
   "guards": [
     { "type": "max-position-size", "options": { "maxPercentOfEquity": 20 } },
     { "type": "max-drawdown",      "options": { "maxDrawdownPct": 10 } },
     { "type": "daily-loss-limit",  "options": { "maxDailyLossPct": 3 } }
   ]
   ```

   These are enforced by the trading process itself at order-push time,
   *regardless* of what you or the agent computed: no single position
   over 20% of equity, no new entries once the account is 10% below its
   high-water mark, no new entries after a 3% down day. Exits always
   pass — you can always get out. When a guard blocks you, it explains
   why in plain language; that message is a lesson, not a punishment.

## 3. Your first trade card — the core loop

Open your chat workspace and ask, in plain English:

> *"Find me a trade this week"* — or — *"Is NVDA a buy here?"*

That triggers the **`trade-idea`** skill, which runs a fixed
research-to-order procedure — the same sequence a junior analyst would be
made to follow at a desk:

| Step | What the agent does | The tool doing the math |
|---|---|---|
| Account context | Reads your equity, currency, open positions, and current open risk from your journal | `alice-uta account info/portfolio` |
| Entry signal | Looks for a **dated, falsifiable trigger** — a moving-average cross, a volume-confirmed breakout, an RSI pullback in a trend — never "it looks strong" | `detectSignals` |
| Quant evidence | RSI, ATR, relative volume, distance from 52-week high, all with dates | `alice analysis quant` |
| **Historical edge** | Replays *every past firing* of that exact signal with the exact stop and target being proposed: win rate, average R, expectancy | `backtestSignal` |
| Fundamentals + landmines | Solvency sanity check, and a hard rule: you're warned about any earnings date within the holding window | `traderhub equity …` |
| Macro & positioning | One paragraph: is the macro wind at this trade's back or in its face? Is the name crowded, hated, or ignored? | market boards, short interest, insiders |
| **Sizing** | Computes quantity from your equity so the stop costs ~1% of the account, capped by position size and total portfolio heat | `positionSize` |

The output is a **TRADE CARD** — a one-line plain-English summary on top,
nine numbered lines where every metric carries a plain reading in
parentheses, and a mandatory glossary at the bottom defining every term of
art in the card's own numbers (the full reference lives in
[`trading-glossary.md`](trading-glossary.md)). By rule, a card you can't
understand top to bottom without looking anything up isn't finished. Or,
very often, the output is:

> **Verdict: NO TRADE** (or **WATCH**, with the exact trigger that would
> change the answer)

**This is the single most important design decision to internalize:**
most days, most tickers, there is no edge, and the toolkit is built to
say so. If you find yourself annoyed by NO TRADE verdicts and pushing
for action, that feeling is the #1 thing that separates you from the
professionals you're trying to emulate. They wait.

### Nothing executes without you

A trade card ends at a *staged* order. OpenAlice's "Trading as Git"
model means the agent stages and commits the order like a code change,
and **you push it** through the approval gate in the UI. When you
approve, the stop from the card is placed **broker-side** with the order
(`tpsl`) — so your safety net exists at the venue, not just in a note.

## 4. How to read a trade card (line by line)

```
## TRADE CARD — NVDA LONG                        2026-07-06
Verdict: TRADE

Plain English — Buy NVDA: it just broke into an uptrend on above-average
                volume. Risk £197 aiming for £394, and get out if it closes
                below $93.60.

1. Setup & entry   — 20-day average crossed above the 50-day (an uptrend
                     starting), fired 2026-07-01 on heavy volume; entry 98–101
2. Quant evidence  — RSI 61 (momentum firm, not overbought >70);
                     ATR $3.20 (typical daily swing — sets the stop);
                     RVOL 1.8 (80% more volume than usual → real interest);
                     4% below its 52-week high (near the top of its range)
3. Historical edge — of the last 14 times this setup fired since 2021, 57%
                     made money; average +0.8R (earned 0.8× the risk per
                     trade — expectancy +0.31R); worst streak 3 losses
4. Macro           — tailwind (market at its back): rates paused, dollar
                     soft, sentiment neutral
5. Positioning     — ignored (no crowd either way): short interest 1.2%,
                     insiders quiet, analyst estimates drifting up
6. Risk plan (£20,000 account)
                   — buy 50 shares @ 100.00; stop-loss 93.60 (2× ATR);
                     targets 106.4/112.8 — at the first you make 2× your
                     risk (R:R 2.0);
                     you risk £197 / $250 = 1.0% of the account;
                     total open risk after: 2.4% (cap 5%)
7. What invalidates — closes below 93.60; the 20-day drops back under the
                     50-day; an earnings guidance cut
8. Confidence      — med; earnings 2026-08-27 is the one thing to watch
9. Glossary        — R-multiple: profit/loss in units of what you risked
                     (here 1R = £197). Expectancy: average R per trade.
                     ATR: typical daily swing. … (full: trading-glossary.md)
```

The lines to spend your attention on, in order of importance:

- **Line 6 first, always.** What do I lose if I'm wrong, and is it ~1%
  of my account? If yes, no single trade can hurt you. Everything else
  is refinement.
- **Line 3 is the license to trade.** `expectancy +0.31R` means this
  setup historically made +0.31 units of risk per trade *on average,
  including the losers*. Negative expectancy disqualifies a setup no
  matter how good the story is. And if the card carries a small-sample
  note (fewer than 10 historical firings), treat the number as an
  anecdote, not evidence — the card is required to tell you.
- **Line 7 is your pre-commitment.** You are agreeing *now*, while calm,
  about what will make you exit *later*, when you won't be.
- **Line 3's win rate is the vanity metric.** A 40%-win system that
  makes +2R on wins and −1R on losses is profitable. Learn to feel good
  about expectancy, not win rate.

Every number on a card comes from a tool call in that run — the agent is
forbidden from quoting statistics from memory. If a number looks odd,
ask "show me the backtest for line 3" and it will re-run it in front of
you.

## 5. The journal — where your edge becomes measurable

Every executed trade gets one markdown file in your workspace at
`journal/trades/<date>-<SYMBOL>.md`: the full card, the entry details,
the stop — and later, the exit and the lessons. This isn't bookkeeping
for its own sake; the journal is load-bearing:

- **Portfolio heat** (the sum of open risk across all positions) is
  computed from it — the next trade card reads your journal before
  sizing, so five open 1%-risk positions mean the sixth gets capped by
  the 5% heat limit.
- The **daily briefing** reviews each open position against *its own
  journaled plan* — not against how you feel about it today.
- The **mentor** computes your realized expectancy from it — the number
  that eventually proves (or disproves) that you're ready for real money.

Keep it honest. A journal that flatters you is a map that lies.

## 6. The mentor — your risk curriculum

The **`trade-mentor`** skill is the teaching layer. Ask it anything a
card made you wonder about, and it answers **in your account's own
numbers** — "1% of your £20,000 is £200" — never in textbook
abstractions. Prompts worth using in your first weeks:

- *"Why am I only allowed to risk 1%?"* — it will walk you through
  streak math: at 1% risk, a 10-loss streak (which will happen to you)
  costs ~10% of the account — recoverable. At 10% risk, the same streak
  destroys 65% of it.
- *"What is an R-multiple / expectancy / ATR / portfolio heat?"* — every
  term, with your numbers.
- *"Why did the guard block my order?"* — drawdown arithmetic is
  asymmetric: lose 20% and you need +25% to get back; lose 50% and you
  need +100%. The max-drawdown guard exists to keep the recovery
  climbable.
- *"Review my trades. Am I improving?"* — the journal-review protocol:
  realized R per closed trade, realized expectancy vs. what the cards'
  backtests promised, and a count of **improvised exits** (exiting on
  emotion instead of at the journaled stop/target — the #1 beginner
  leak). It ends with exactly one thing to do differently next week.

One rule of the mentor's that you should adopt as your own: **a good
trade is one that followed the rules, even if it lost; a bad trade is a
rule break, even if it won.** Grade your process. Outcomes average out
into expectancy.

## 7. The daily briefing — your morning desk note

Once you have open positions, set up the **`daily-briefing`** skill as a
scheduled pre-open run (ask the agent: *"schedule a morning briefing one
hour before the US open"* — it writes the issue file itself). Every
trading morning you get one Inbox document:

1. **Today's landmines** — CPI, FOMC, payrolls, and any holding
   reporting earnings within 5 trading days.
2. **Open-position review** — each position vs. its journaled stop and
   targets, with distance measured in R, and a recommendation: ratchet
   the stop to breakeven, take a partial, exit (regime broken), or hold
   as planned. Recommendations only — it never places orders.
3. **Account risk status** — drawdown, portfolio heat vs. the cap, and
   headroom under each guard, so a guard rejection never surprises you.
4. **At most 1–2 fresh cards** — and only if the book has risk headroom.

On a quiet day it's three lines. That's deliberate — filler teaches you
to skim, and skimming is how you miss the landmine.

## 8. The graduation path

A realistic curriculum, in phases. Move to the next phase on **evidence
from your journal**, not on enthusiasm or a good week.

**Phase 1 — Read-only (week 1).** No orders at all. Ask for trade cards
on names you know. For each card, before reading line 3, write down your
guess of the verdict — then compare. Ask the mentor about every term you
don't own yet. Goal: you can explain someone else's card line by line.

**Phase 2 — Paper trading (months, not weeks).** Take TRADE-verdict
cards on the paper account, always through the approval gate, always
journaled. Set up the daily briefing. Run *"review my trades"* every
weekend. Goals before you even think about Phase 3:
- **≥20 closed trades** in the journal (fewer is statistical noise),
- **realized expectancy > 0** across them,
- **zero improvised exits** in the last ten trades,
- zero rule breaks (no earnings-window entries, no >1% risk, no heat-cap
  breaches).

**Phase 3 — Small live account (optional, only after Phase 2's goals are
met).** Same process, same 1% rule, same guards, real (small) money —
the only new variable is your emotions, which is exactly the variable
Phase 2 couldn't test. If your live journal's expectancy diverges from
your paper journal's, the difference *is* your psychology; take it back
to the mentor.

There is no Phase 4 where the rules stop applying. The professionals you
want to emulate are the people who *never* stop following Phase 2's
rules — that's the whole secret.

## 9. What this toolkit will not do

Being honest about the boundary is part of the education:

- **It will not predict the market.** Backtested expectancy is a
  measured historical tendency, not a promise. Edges decay; that's why
  you keep measuring your realized results against the cards.
- **It will not trade for you.** Every order crosses the approval gate
  with your click. The daily briefing recommends; you decide.
- **It will not protect you from overriding it.** You can raise risk
  toward the 2% hard clamp, loosen guards, or ignore NO TRADE verdicts.
  The toolkit will warn you with the arithmetic first — but the account
  is yours, and so is the discipline.
- **Current v1 limits:** signal backtests are long-only; portfolio heat
  is advisory (the hard guards are drawdown, daily-loss, and position
  size); and the intraday stop-proximity checker is a narrator, not
  protection — the real safety net is the broker-side stop placed with
  every order.

## 10. Cheat sheet — things to say to Alice

| You want | Say |
|---|---|
| An idea, fully reasoned | *"Find me a trade this week"* |
| A verdict on a name | *"Is AAPL a buy here?"* |
| Just the signal check | *"Run signal detection on TSLA daily"* |
| Proof the setup works | *"Backtest a 20/50 golden cross on NVDA with a 2×ATR stop and 2R target over 3 years"* |
| Size without a full card | *"Size a long at 100 with a stop at 94 for my account"* |
| Understanding | *"Explain line 3 of that card like I'm new"* / *"Why only 1%?"* |
| Accountability | *"Review my trades — am I improving?"* |
| The morning routine | *"Schedule a daily briefing an hour before the US open"* |

---

*Further reading in this repo:
[`docs/trading-glossary.md`](trading-glossary.md) (every term of art a card
can use — plain definition, why it matters, worked example in £/$),
[`docs/beginner-trading-walkthrough.md`](beginner-trading-walkthrough.md)
(the end-to-end product walkthrough — which tab to look at, what happens
on screen when a trade executes, and how to read the Portfolio dashboard),
[`docs/trade-cards.md`](trade-cards.md)
(the feature map and architecture), and the skill definitions themselves
in [`default/skills/trade-idea/`](../default/skills/trade-idea/SKILL.md),
[`trade-mentor/`](../default/skills/trade-mentor/SKILL.md), and
[`daily-briefing/`](../default/skills/daily-briefing/SKILL.md) — they're
written to be read by humans too.*
