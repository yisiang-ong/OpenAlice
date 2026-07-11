# The Plain-English Trading Glossary

*Every term of art a TRADE CARD can use, defined for a smart friend with
zero finance background. Each entry is: **what it is** → **why it matters**
→ **a worked example in real money**. This is the reference the `trade-idea`
cards link to and the `trade-mentor` skill teaches from. Read it once; come
back whenever a card uses a word you don't yet own.*

The goal isn't to memorise definitions — it's that after a few weeks you
read a card and the words have *become* how you think. That's what turns a
beginner into someone who reasons like a desk.

---

## The one idea everything hangs on: R

**R = the amount you risk on a trade.** Not the trade's size — the *risk*:
how much you lose if your stop is hit. Everything else is measured in
multiples of R.

- **What it is:** your entry price minus your stop price, times your
  share count. If you buy 50 shares at $100 with a stop at $95, your R is
  50 × $5 = **$250**.
- **Why it matters:** R makes a £50 trade and a £5,000 trade *comparable*.
  "I made 2R" means the same thing whatever the position size — you made
  twice what you were willing to lose. It's the unit professionals think
  in, and once you do too, "cut losers, let winners run" becomes something
  you can actually measure.
- **Example:** risk £197 (1% of a £20,000 account). Make £394 → **+2R**.
  Hit your stop → **−1R**. Scratch out flat → **0R**.

---

## The metrics on a card (Section 2 — "Quant evidence")

These describe the stock's current state. On a beginner card each comes
with a plain reading already attached — this is the deeper "why".

### RSI (Relative Strength Index)
- **What it is:** a 0–100 momentum gauge. Above ~70 is "overbought"
  (run up fast, may be due a rest); below ~30 is "oversold".
- **Why it matters:** it tells you whether you're chasing something already
  stretched or entering with room to run. It is *not* a buy/sell button on
  its own — a strong stock can stay "overbought" for weeks.
- **Example:** *RSI 61* — momentum is firm and healthy, not yet in the
  overheated zone. *RSI 78* — hot; you're paying up.

### ATR (Average True Range)
- **What it is:** the stock's typical daily price swing, in dollars.
- **Why it matters:** it's how far the stock "normally" moves, so it sets a
  sensible **stop distance**. A stop tighter than 1 ATR gets hit by ordinary
  noise; the card usually places the stop about 2× ATR away so random wiggle
  doesn't stop you out.
- **Example:** *ATR $3.20* on a $100 stock means it routinely swings ~$3 a
  day. A 2×ATR stop sits ~$6.40 below entry, at $93.60 — outside the noise.

### RVOL (Relative Volume)
- **What it is:** today's volume divided by its recent average. 1.0 = a
  normal day; 2.0 = twice the usual number of shares trading.
- **Why it matters:** a breakout on *high* volume means real money is behind
  the move (conviction); the same move on quiet volume is often a fake-out.
  It's the difference between a crowd and a whisper.
- **Example:** *RVOL 1.8* — about 80% more shares trading than normal;
  the move has genuine interest behind it.

### z-score (of price vs its year)
- **What it is:** how many "standard steps" the price is above or below its
  own past-year average. +1 is modestly high; +2 is unusually high.
- **Why it matters:** it flags whether you're buying something historically
  cheap or stretched relative to its own norm — a quick sanity check on "am
  I late?"
- **Example:** *z +1.1* — a bit above its typical range for the year, not
  yet extreme.

### % from 52-week high
- **What it is:** how far below its highest price of the past year the stock
  is trading.
- **Why it matters:** stocks near their highs are in strong trends (nothing
  overhead to slow them); stocks far below have "resistance" — past buyers
  waiting to sell at breakeven — to fight through.
- **Example:** *4% below its 52-week high* — near the top of its range, a
  strength signal.

---

## The risk vocabulary (Section 6 — "Risk plan")

This is the most important section of any card. Master these first.

### Stop (stop-loss)
- **What it is:** the price at which you admit the trade idea is wrong and
  get out. Placed **at the broker** with the order, so it protects you
  automatically.
- **Why it matters:** the stop is where your trade is *falsified*. If you
  can't say where that is, you don't have a trade — you have a hope. Your
  position size is *derived from* the stop, never the other way round.
- **Example:** entry $100, stop $93.60. If it's hit you're out, down 1R.

### Target
- **What it is:** a price where you plan to take profit, quoted as a
  multiple of R (1R, 2R, 3R away).
- **Why it matters:** deciding your exits *before* you're emotional is the
  whole game. Cards usually stage several (T1/T2/T3) so you can bank some
  and let the rest run.
- **Example:** stop is $6.40 away (1R). A 2R target sits $12.80 above
  entry, at $112.80 — hit it and you've made 2× your risk.

### R:R (risk-to-reward ratio)
- **What it is:** how many R you stand to make versus the 1R you're
  risking, measured to the first target.
- **Why it matters:** a 2:1 R:R means you only need to be right ~40% of the
  time to make money. It's what lets a losing-most-of-the-time system still
  win (see *expectancy*).
- **Example:** *R:R 2.0 at T1* — you're risking £197 to make £394 if the
  first target hits.

### Position size
- **What it is:** how many shares to buy, calculated so that hitting your
  stop costs a fixed small % of the account (1% by default).
- **Why it matters:** sizing is the survival mechanism. It's derived from
  risk ÷ stop distance — the tool does the maths so every trade risks the
  same tiny slice, no matter the stock's price.
- **Example:** £197 risk budget ÷ $6.40 stop distance ≈ 50 shares.

### Portfolio heat
- **What it is:** the sum of open risk across *all* your positions. Five
  positions each risking 1% = 5% heat.
- **Why it matters:** if a bad day stops out everything at once, heat is
  what you lose. The 5% cap exists because correlated trades fall together.
- **Example:** *heat after: 2.4%* — even if every open position stopped out
  today, the account loses 2.4%; you're well under the 5% ceiling.

---

## The edge vocabulary (Section 3 — "Historical edge")

How we know a setup has a real, measured edge — not a vibe.

### Backtest
- **What it is:** replaying every past time this exact signal fired, with
  this exact stop and target, to see how it actually did.
- **Why it matters:** it turns "this looks good" into "this made money 34
  times out of the last 58". Evidence, not a story.

### Win rate
- **What it is:** the % of past trades that made money.
- **Why it matters:** *the least important stat on the card.* A high win
  rate with tiny wins and huge losses is a losing system. Never judge a
  setup on win rate alone.
- **Example:** *57% win* — better than a coin flip, but meaningless until
  you know the size of wins vs losses.

### Expectancy
- **What it is:** the average R a setup makes per trade, wins and losses
  blended: (win% × average win) − (loss% × average loss).
- **Why it matters:** **this is the number that says whether a setup makes
  money.** A 40%-win system that makes +2R on wins and −1R on losses has
  +0.2R expectancy — it loses most of the time and still earns. Positive
  expectancy = tradeable; negative = disqualified no matter how good the
  story.
- **Example:** *expectancy +0.31R* — historically earned about a third of
  one R per trade on average, after the losers.

### Small-sample note
- **What it is:** a warning printed when a setup has fewer than ~10 past
  firings.
- **Why it matters:** three good trades is an anecdote, not evidence. If the
  card carries this note, treat the stats as a hint, not proof.

### Worst losing streak
- **What it is:** the most consecutive losses this setup had historically.
- **Why it matters:** it prepares you emotionally. If the setup once lost 5
  in a row, expect that to happen again — at 1% risk it's a survivable ~5%
  dip, which is exactly why we size small.

---

## The signals (Section 1 — "Setup & entry")

The dated triggers that say "now". A card names one in plain words; here's
what each means.

- **Moving-average cross (golden / death):** a fast average of price
  crossing above (golden = bullish) or below (death = bearish) a slow one.
  A trend-change flag.
- **Trend filter:** is price above its long (e.g. 200-day) average? A simple
  "is the tide coming in or going out" gate — we usually only buy above it.
- **Breakout / breakdown:** price pushing above the highest (or below the
  lowest) point of a recent range — often on high volume. An escape from a
  holding pattern.
- **RSI cross:** momentum crossing a chosen level (e.g. rising back above
  40) — used to time pullback entries within an uptrend.
- **MACD cross:** a momentum indicator crossing its own signal line;
  another trend/momentum trigger.
- **52-week-high proximity:** a *state*, not an event — "is the stock near
  the top of its yearly range right now".

---

## The positioning reads (Section 5)

Who else is in the trade — because that shapes what happens next.

- **Crowded:** everyone's already long. Who's left to buy? Upside may be
  tapped out.
- **Hated:** heavily shorted. Fuel for a squeeze if you're right — but the
  bears may know something.
- **Ignored:** no strong narrative either way. Slower, but cleaner.
- **Short interest:** the % of shares sold short (betting on a fall).
- **Insiders:** company executives buying or selling their own stock — a
  tell about how they see it.
- **Estimate revisions:** whether analysts are raising or cutting their
  forecasts — the direction of the herd's expectations.

---

## Account-level guardrails (the safety net around every trade)

- **Drawdown:** how far the account is below its highest-ever value. The
  arithmetic is asymmetric and brutal: lose 20% and you need +25% to
  recover; lose 50% and you need +100%. This is why we protect the downside
  obsessively.
- **High-water mark:** the account's peak equity — what drawdown is measured
  from. The `max-drawdown` guard blocks *new* entries once you're too far
  below it, to keep the climb back survivable.
- **Fixed-fractional risk:** risking the same small % (1%) every trade.
  A 10-loss streak at 1% costs ~10% (recoverable); at 10% a trade it
  destroys ~65% of the account. Sizing small is how you survive long enough
  to collect your edge.
- **Kelly (fractional):** a formula for the mathematically "optimal" bet
  size given your edge. Full Kelly is wildly aggressive, so cards use a
  *quarter* of it at most — and only ever to make a position *smaller*,
  never bigger than the 1% rule allows.

---

*Deeper on the reasoning behind the risk rules: the `trade-mentor` skill
(ask it "why only 1%?", "what is expectancy?", "review my trades"). The
product walkthrough — which screen shows what — is in
[`beginner-trading-walkthrough.md`](beginner-trading-walkthrough.md). The
philosophy and graduation path are in
[`beginner-trader-guide.md`](beginner-trader-guide.md).*
