# Your First Weeks of Paper Trading — an End-to-End Walkthrough

*The companion to [the Beginner Trader's Guide](beginner-trader-guide.md).
That guide teaches the ideas; this one walks the actual product — which tab
to look at, what each number means, and exactly what happens on screen when
a trade goes from "find me an idea" to money moving in your paper account.*

Assumes setup is done: a paper broker account connected (Settings →
Trading), the three guards on it, and a chat workspace with a working AI
credential.

---

## 1. The map — what each tab in the sidebar is for

You'll live in five tabs. Learn what each one is *for* and the rest of this
guide reads itself:

| Tab | What it's for | When you look at it |
|---|---|---|
| **Ask Alice / Workspaces** | Talking to the agent — trade cards, questions, mentor lessons | When you want something |
| **Inbox** | Finished reports delivered to you — the daily briefing, pushed documents | Every morning |
| **Trading as Git** | **The approval gate.** Orders the agent staged wait HERE for your push | When you've said yes to a trade |
| **Portfolio** | **The money dashboard.** Equity, cash, P&L, open positions, equity curve | Daily, after the briefing |
| **Settings → Trading** | Accounts and their guards | Setup, and when a guard message confuses you |

Supporting cast: **Market** (boards and charts for your own research),
**News** (the RSS archive the agent cites), **Issues** (the scheduled tasks
behind the daily briefing), **Tracked** (the memory graph of tickers and
theses the agent maintains).

> **Tripwire:** if *Trading as Git* says it's **"unavailable in Lite
> mode"**, your instance is running with UTA (the broker process)
> disconnected. Go to **Agent Permissions** and change the trading mode —
> until then nothing can reach a broker, even a paper one.

## 2. The life of one paper trade, tab by tab

This is the whole loop. Run it once slowly and the product stops being
mysterious.

### Step 1 — Ask (Workspace)

Open your chat workspace and type:

> *find me a trade this week*

The agent runs the `trade-idea` pipeline — you'll watch it call tools in
the terminal: account info, signal detection, a backtest, fundamentals,
macro boards, position sizing. This takes a few minutes. Every number on
the card it produces came out of one of those tool calls — nothing is
recalled from the model's memory.

### Step 2 — Read the card (Workspace)

You get a TRADE CARD ending in a verdict. Reading order for a beginner:
**line 6 first** (what do I lose if wrong — should be ~1% of equity), then
**line 3** (the measured edge), then **line 7** (what proves it wrong).
Full line-by-line literacy is in the
[Beginner Guide §4](beginner-trader-guide.md#4-how-to-read-a-trade-card-line-by-line).

### Step 3 — Decide. Three paths:

- **The card says NO TRADE or WATCH** → you're done. Nothing to click,
  nothing to approve. This is the most common outcome and it is the system
  *working*, not failing. A WATCH card names the exact trigger that would
  change the answer — you can ask the agent to watch for it.
- **The card says TRADE but you're not convinced** → interrogate it.
  *"Why is the stop there and not under the support level?"*, *"Show me
  the losing trades in that backtest"*, *"What happens to this thesis if
  CPI comes in hot?"* Saying no to a TRADE verdict is always allowed and
  always free. The agent never escalates a card you ignored.
- **You want it** → say so explicitly: *"take it"*. Nothing executes from
  the card itself.

### Step 4 — The approval gate (Trading as Git)

On your yes, the agent doesn't send an order to the broker. It **stages**
the operation — like a git commit waiting for a push. The sidebar shows a
**"pending to push"** badge, and the **Trading as Git** tab now lists it as
a card like:

```
BUY NVDA          alpaca-paper
limit 100.00 × 50, stop (tpsl) 93.60
[ Push ]  [ Reject ]
```

This is the last human checkpoint, so actually read it: does the symbol,
side, quantity, limit price, and — most importantly — the **attached stop**
match the card you approved? The stop here is placed **broker-side** with
the order; it's your real safety net, not a note.

- **Push** (it asks you to confirm) → the order goes to the paper venue.
- **Reject** → the staged operation is discarded. Nothing happened.

The guards run at this moment too. If the order violates one — position
too big, account past its drawdown or daily-loss limit — the push is
rejected with a plain-English explanation *even though you approved it*.
A guard rejection is never a bug; it's the rail doing its job. Ask the
mentor to explain it: *"why did the guard block my order?"*

### Step 5 — Watch the position (Portfolio)

Once filled, the **Portfolio** tab is where your money lives. Section 3
below teaches you to read it. The position appears as a row under your
paper account with live P&L; total equity and the equity curve update as
prices move.

Meanwhile the agent writes the **journal entry**
(`journal/trades/<date>-<SYMBOL>.md` in the workspace) — the card, entry,
stop, and targets on file. That file is load-bearing: the daily briefing
and the mentor both read it.

### Step 6 — Live with it (Inbox, every morning)

You don't babysit the position; the **daily briefing** does. Each morning
(once you've scheduled it — ask the workspace: *"schedule a morning
briefing an hour before the US open"*) one document lands in your Inbox:

- today's landmines (CPI, FOMC, earnings on your names),
- each open position vs **its own journaled plan** — distance to stop and
  target measured in R — with a recommendation: hold, ratchet the stop,
  take a partial, or exit,
- account risk status: drawdown, portfolio heat, guard headroom.

**Recommendations only.** If it says "ratchet the stop to breakeven" and
you agree, tell the workspace to do it — the change is staged and goes
through the same Trading-as-Git push as everything else. If you disagree,
do nothing. Silence never places orders.

### Step 7 — Exit

Three ways a position ends:

1. **The broker-side stop or target fills on its own** (this is why it's
   attached at entry). The briefing notices, marks the journal entry
   closed with its realized R, and flags it for review.
2. **The briefing recommends an exit** (regime broken, target reached) and
   you approve it → staged close → your push.
3. **You just want out** — tell the workspace *"close NVDA"* → staged
   close → your push. Exits are never blocked by guards.

### Step 8 — Learn from it (Workspace, weekends)

After a handful of closed trades: *"review my trades — am I improving?"*
The mentor computes your realized R per trade and realized expectancy from
the journal, compares it against what the cards' backtests promised, counts
improvised exits (the #1 beginner leak), and ends with exactly **one thing
to do differently next week**. This review is the actual product of paper
trading — the P&L is just its raw material.

## 3. Reading the Portfolio dashboard as a beginner

What the numbers are, and — more useful — which ones deserve your
attention:

- **Equity** — what the account is worth right now if everything closed at
  current prices: cash + positions. **This is the number the guards watch**
  (drawdown from its high, loss since yesterday).
- **Cash** — the uninvested part. Fine for it to be most of the account;
  a beginner book with 1–3 positions is mostly cash by design.
- **Unrealized P&L** — paper profit/loss on OPEN positions. It breathes
  with every tick. **Do not react to it** — your plan reacts at the stop
  and targets, nowhere in between. Checking it hourly is how improvised
  exits happen.
- **Realized P&L** — banked profit/loss from CLOSED trades. This moves
  rarely and honestly. Judge yourself here (in R, via the mentor), not on
  unrealized swings.
- **Position rows** — per holding: quantity, average cost, market price,
  market value, its P&L. The one habit that matters: for each row you
  should be able to say *where its stop is* without looking it up. If you
  can't, open the journal.
- **Equity curve** — account value over time. Beginners read the wiggles;
  professionals read the **depth of the dips** (drawdown). A flat-ish curve
  with shallow dips while you learn is a *good* outcome — it means the 1%
  rule is containing your tuition costs.

A useful daily discipline: look at Portfolio **once**, after the morning
briefing, ask "is anything here off-plan?", and close the tab. Everything
else is noise the plan already accounts for.

## 4. Saying no — the skill the product is built around

Every layer has a veto, and using them is the point:

| Layer | How you say no | Cost |
|---|---|---|
| Trade card | Ignore it, or ask harder questions | Free, always |
| WATCH verdict | Do nothing — it's already a no | Free |
| Staged order | **Reject** in Trading as Git | Free — nothing reached the broker |
| Briefing recommendation | Don't act on it | Free |
| Everything, automatically | Guards block rule-breaking pushes | Free — and educational |

The system is deliberately built so that **doing nothing is always safe**.
No timer expires into an order; no agent pushes its own staged commit; a
card you never answer just goes stale. If a week goes by where you took
zero trades because no card earned a yes — that week was practiced
discipline, not wasted time.

## 5. The daily rhythm (≈ 10 minutes)

1. **Inbox** — read the briefing: landmines, positions vs plan, guard
   headroom. (3 min)
2. **Portfolio** — one look: anything off-plan? (1 min)
3. **Act only if something needs it** — approve a stop ratchet, or run one
   fresh card if the briefing surfaced a setup and you have risk headroom.
   (0–5 min)
4. **Weekend** — the mentor review, and its one correction for next week.

That's the whole tool, used fully: research in the workspace, delivery in
the Inbox, approval in Trading as Git, truth in Portfolio, learning in the
journal. Everything else in the sidebar exists to feed those five.
