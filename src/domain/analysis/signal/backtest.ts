/**
 * Signal backtesting — walk a signal's bullish events forward as ONE-shot
 * bracket entries (fixed stop + R-multiple target) and report the aggregate
 * edge. Answers "if I'd bought every `signal` trigger over the last N years
 * with a `stop`/`targetR` bracket, what would my win rate and expectancy have
 * been" — the historical-edge counterpart to `detectSignals` (which only
 * dates the triggers) and `simulate` (which walks a SINGLE entry).
 *
 * v1 is long-only: only `direction === 'bullish'` events from
 * `detectSignalEvents` are used as entries. Entry is at the CLOSE of the
 * signal bar (no lookahead — you'd only know the crossing fired once that
 * bar's close prints).
 *
 * Stop distance:
 *   atr   stopDistance = ATR(period, default 14) AT THE ENTRY BAR × mult.
 *         If ATR hasn't warmed up yet at that bar (still null), the signal
 *         is SKIPPED (not counted as a trade, not counted as a loss).
 *   pct   stopDistance = entryPrice × pct/100.
 * target = entryPrice + targetR × stopDistance (a fixed R-multiple target,
 * not an independent percent — that's the point of quoting size in R).
 *
 * Walking forward uses the SAME intrabar, stop-wins-on-tie semantics as
 * simulate.ts's `bracket` exit rule (see that file's header for the full
 * rationale): from the bar AFTER entry, bar.low <= stopPrice exits AT the
 * stop price (reason 'stop'); else bar.high >= targetPrice exits AT the
 * target price (reason 'target'); if both would touch in the same bar, stop
 * wins (conservative — OHLC alone can't tell us the intrabar path order).
 * `maxBars` (default 60) forces a 'time' exit at that bar's CLOSE if neither
 * level is hit first.
 *
 * NON-OVERLAPPING: this is a single simulated position, not a portfolio. A
 * signal that fires while a previous trade is still open (before its exit
 * bar) is skipped entirely — it never becomes a trade. The next eligible
 * entry is the first signal strictly AFTER the previous trade's exit bar.
 *
 * The last trade may still be open at the end of the bar series (reason
 * 'open', rMultiple/exitDate/exitPrice null) — it stayed on the books
 * because neither stop, target, nor maxBars had triggered by the last bar.
 * Aggregate stats are computed over CLOSED trades only ('stop' | 'target' |
 * 'time'); `n` in BacktestStats is that closed count, not total trades
 * returned. `wins` = closed trades with rMultiple > 0. expectancyR is the
 * mean R-multiple across closed trades — equivalently winRate×avgWinR −
 * lossRate×avgLossR (time exits contribute whatever R they closed at,
 * winning or losing, same as any other exit). A closed sample under 10
 * trades gets a `note` warning the caller not to over-read it.
 *
 * Pure over DetectBar[] + BacktestSpec: no BarService dependency, one pass,
 * no fetching — the tool layer fetches/pads the window and calls this.
 */

import { detectSignalEvents, type DetectBar, type SignalSpec } from './detect.js'
import { atrSeries } from './rolling.js'

export interface BacktestSpec {
  signal: SignalSpec
  stop: { type: 'atr'; mult: number; period?: number } | { type: 'pct'; pct: number }
  targetR: number
  /** Force a time exit at close after this many bars if neither stop nor target hit. Default 60. */
  maxBars?: number
  /** Ignore signals dated before this (YYYY-MM-DD). Lets the caller pad the bar
   *  window for indicator warm-up without widening the trade sample. */
  start?: string
}

export interface BacktestTrade {
  entryDate: string
  entryPrice: number
  stopPrice: number
  targetPrice: number
  exitDate: string | null
  exitPrice: number | null
  /** null while the trade is still open. */
  rMultiple: number | null
  reason: 'stop' | 'target' | 'time' | 'open'
  barsHeld: number
}

export interface BacktestStats {
  /** Closed-trade count — the denominator for every ratio below. */
  n: number
  wins: number
  winRatePct: number
  avgR: number
  expectancyR: number
  /** Positive magnitude (average winning R). */
  avgWinR: number
  /** Positive magnitude (average LOSING R, sign-flipped so it reads as a size, not a negative number). */
  avgLossR: number
  maxConsecutiveLosses: number
  avgBarsHeld: number
  bestR: number
  worstR: number
}

function r4(v: number): number {
  return Number(v.toFixed(4))
}

const EMPTY_STATS: BacktestStats = {
  n: 0, wins: 0, winRatePct: 0, avgR: 0, expectancyR: 0, avgWinR: 0, avgLossR: 0,
  maxConsecutiveLosses: 0, avgBarsHeld: 0, bestR: 0, worstR: 0,
}

function computeStats(closed: BacktestTrade[]): BacktestStats {
  const n = closed.length
  if (n === 0) return { ...EMPTY_STATS }

  const rValues = closed.map((t) => t.rMultiple as number)
  const wins = rValues.filter((r) => r > 0)
  const losses = rValues.filter((r) => r <= 0)
  const winRate = wins.length / n
  const lossRate = losses.length / n
  const avgWinR = wins.length > 0 ? wins.reduce((a, v) => a + v, 0) / wins.length : 0
  // Losses stored as (non-positive) R values; flip sign so avgLossR is a magnitude.
  const avgLossR = losses.length > 0 ? -(losses.reduce((a, v) => a + v, 0) / losses.length) : 0
  const avgR = rValues.reduce((a, v) => a + v, 0) / n
  const expectancyR = winRate * avgWinR - lossRate * avgLossR

  let maxConsecutiveLosses = 0
  let streak = 0
  for (const r of rValues) {
    if (r <= 0) { streak += 1; maxConsecutiveLosses = Math.max(maxConsecutiveLosses, streak) }
    else streak = 0
  }

  const avgBarsHeld = closed.reduce((a, t) => a + t.barsHeld, 0) / n

  return {
    n,
    wins: wins.length,
    winRatePct: r4(winRate * 100),
    avgR: r4(avgR),
    expectancyR: r4(expectancyR),
    avgWinR: r4(avgWinR),
    avgLossR: r4(avgLossR),
    maxConsecutiveLosses,
    avgBarsHeld: r4(avgBarsHeld),
    bestR: r4(Math.max(...rValues)),
    worstR: r4(Math.min(...rValues)),
  }
}

export function backtestSignal(
  bars: DetectBar[],
  spec: BacktestSpec,
): { trades: BacktestTrade[]; stats: BacktestStats; note?: string } {
  const maxBars = spec.maxBars ?? 60
  const n = bars.length
  if (n === 0) return { trades: [], stats: { ...EMPTY_STATS } }

  const dateToIdx = new Map<string, number>()
  bars.forEach((b, i) => dateToIdx.set(b.date, i))

  const detectResult = detectSignalEvents(bars, spec.signal)
  const bullishEvents = detectResult.events.filter(
    (e) => e.direction === 'bullish' && (spec.start == null || e.date.slice(0, 10) >= spec.start),
  )

  const atr = spec.stop.type === 'atr'
    ? atrSeries(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), spec.stop.period ?? 14)
    : null

  const trades: BacktestTrade[] = []
  // Last exit index consumed by an open/closed trade; the next entry must be
  // strictly AFTER this (non-overlapping positions).
  let blockedUntilIdx = -1

  for (const event of bullishEvents) {
    const entryIdx = dateToIdx.get(event.date)
    if (entryIdx == null) continue // defensive — event dates always come from bars
    if (entryIdx <= blockedUntilIdx) continue // a trade was still open — skip this trigger

    const entryPrice = bars[entryIdx].close

    let stopDistance: number
    if (spec.stop.type === 'atr') {
      const a = atr![entryIdx]
      if (a == null) continue // ATR not warmed up yet at this bar — skip, don't count
      stopDistance = a * spec.stop.mult
    } else {
      stopDistance = entryPrice * (spec.stop.pct / 100)
    }
    if (!(stopDistance > 0)) continue // degenerate guard (zero/negative distance)

    const stopPrice = entryPrice - stopDistance
    const targetPrice = entryPrice + spec.targetR * stopDistance

    let exitIdx: number | null = null
    let exitPrice: number | null = null
    let reason: BacktestTrade['reason'] = 'open'

    for (let i = entryIdx + 1; i < n; i++) {
      const b = bars[i]
      const hitStop = b.low <= stopPrice
      const hitTarget = b.high >= targetPrice
      if (hitStop) {
        exitIdx = i; exitPrice = stopPrice; reason = 'stop'
        break
      }
      if (hitTarget) {
        exitIdx = i; exitPrice = targetPrice; reason = 'target'
        break
      }
      if (i - entryIdx >= maxBars) {
        exitIdx = i; exitPrice = b.close; reason = 'time'
        break
      }
    }

    const barsHeld = exitIdx != null ? exitIdx - entryIdx : n - 1 - entryIdx
    const rMultiple = exitIdx != null ? (exitPrice as number - entryPrice) / stopDistance : null

    trades.push({
      entryDate: event.date,
      entryPrice: r4(entryPrice),
      stopPrice: r4(stopPrice),
      targetPrice: r4(targetPrice),
      exitDate: exitIdx != null ? bars[exitIdx].date : null,
      exitPrice: exitPrice != null ? r4(exitPrice) : null,
      rMultiple: rMultiple != null ? r4(rMultiple) : null,
      reason,
      barsHeld,
    })

    // Block the whole hold window (or the rest of the series, if still open).
    blockedUntilIdx = exitIdx != null ? exitIdx : n - 1
  }

  const closed = trades.filter((t) => t.reason !== 'open')
  const stats = computeStats(closed)
  const note = closed.length < 10 ? 'Small sample — treat stats as anecdote, not evidence.' : undefined

  return { trades, stats, ...(note ? { note } : {}) }
}
