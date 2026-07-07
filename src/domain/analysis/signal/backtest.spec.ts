import { describe, it, expect } from 'vitest'
import { backtestSignal } from './backtest.js'
import { atrSeries } from './rolling.js'
import type { DetectBar } from './detect.js'

function makeBars(closes: number[], opts?: { highs?: number[]; lows?: number[]; volumes?: number[] }): DetectBar[] {
  const highs = opts?.highs ?? closes
  const lows = opts?.lows ?? closes
  const volumes = opts?.volumes ?? closes.map(() => 1000)
  return closes.map((c, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: highs[i],
    low: lows[i],
    close: c,
    volume: volumes[i],
  }))
}

// The SMA2/SMA3 golden cross fixture from detect.spec.ts: closes
// [10,10,10,20,…] cross on idx3 (2024-01-04) at close 20. A 10% pct stop
// gives hand-computable numbers: stop 18, distance 2, 2R target 24.
const GOLDEN = { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma', direction: 'golden' } as const

describe('backtestSignal — pct stop, hand-computed R values', () => {
  it('target exit: entry at signal-bar close, exit AT the target level, R = +targetR', () => {
    const closes = [10, 10, 10, 20, 20, 20, 20]
    const highs = [10, 10, 10, 20, 25, 20, 20] // idx4 spikes through the 24 target
    const r = backtestSignal(makeBars(closes, { highs }), {
      signal: GOLDEN, stop: { type: 'pct', pct: 10 }, targetR: 2,
    })

    expect(r.trades).toHaveLength(1)
    const t = r.trades[0]
    expect(t.entryDate).toBe('2024-01-04')
    expect(t.entryPrice).toBe(20)
    expect(t.stopPrice).toBe(18)
    expect(t.targetPrice).toBe(24)
    expect(t.exitDate).toBe('2024-01-05')
    expect(t.exitPrice).toBe(24) // the LEVEL, not the bar's close/high
    expect(t.reason).toBe('target')
    expect(t.rMultiple).toBe(2)
    expect(t.barsHeld).toBe(1)

    expect(r.stats).toMatchObject({
      n: 1, wins: 1, winRatePct: 100, avgR: 2, expectancyR: 2,
      avgWinR: 2, avgLossR: 0, maxConsecutiveLosses: 0, bestR: 2, worstR: 2,
    })
    expect(r.note).toMatch(/Small sample/)
  })

  it('stop wins when one bar touches both stop and target (conservative tie-break)', () => {
    const closes = [10, 10, 10, 20, 20, 20, 20]
    const highs = [10, 10, 10, 20, 25, 20, 20] // touches target 24…
    const lows = [10, 10, 10, 20, 17, 20, 20] //  …and stop 18 in the same bar
    const r = backtestSignal(makeBars(closes, { highs, lows }), {
      signal: GOLDEN, stop: { type: 'pct', pct: 10 }, targetR: 2,
    })

    const t = r.trades[0]
    expect(t.reason).toBe('stop')
    expect(t.exitPrice).toBe(18)
    expect(t.rMultiple).toBe(-1)
    expect(r.stats.maxConsecutiveLosses).toBe(1)
    expect(r.stats.expectancyR).toBe(-1)
  })

  it('time exit at close after maxBars when neither level is hit', () => {
    const closes = [10, 10, 10, 20, 20, 20, 20]
    const r = backtestSignal(makeBars(closes), {
      signal: GOLDEN, stop: { type: 'pct', pct: 50 }, targetR: 10, maxBars: 2,
    })

    const t = r.trades[0]
    expect(t.reason).toBe('time')
    expect(t.exitDate).toBe('2024-01-06')
    expect(t.exitPrice).toBe(20) // that bar's close
    expect(t.rMultiple).toBe(0) // flat exit
    expect(t.barsHeld).toBe(2)
    expect(r.stats.wins).toBe(0) // R = 0 counts as a non-win
  })
})

describe('backtestSignal — non-overlapping positions', () => {
  it('a signal firing while a trade is open is skipped entirely', () => {
    // Goldens fire at idx3 AND idx6 (sma2/sma3 on [10,10,10,20,10,20,20,…]),
    // but the idx3 trade holds until its maxBars time exit at idx8 — so the
    // idx6 trigger must be skipped, leaving exactly ONE trade.
    const closes = [10, 10, 10, 20, 10, 20, 20, 20, 20, 20]
    const r = backtestSignal(makeBars(closes), {
      signal: GOLDEN, stop: { type: 'pct', pct: 90 }, targetR: 100, maxBars: 5,
    })

    expect(r.trades).toHaveLength(1)
    expect(r.trades[0].entryDate).toBe('2024-01-04')
    expect(r.trades[0].reason).toBe('time')
    expect(r.trades[0].exitDate).toBe('2024-01-09')
  })
})

describe('backtestSignal — open last trade', () => {
  it('a trade with no exit by the last bar stays reason "open" and is excluded from stats', () => {
    const closes = [10, 10, 10, 20, 20, 20]
    const r = backtestSignal(makeBars(closes), {
      signal: GOLDEN, stop: { type: 'pct', pct: 50 }, targetR: 10, maxBars: 60,
    })

    expect(r.trades).toHaveLength(1)
    const t = r.trades[0]
    expect(t.reason).toBe('open')
    expect(t.exitDate).toBeNull()
    expect(t.exitPrice).toBeNull()
    expect(t.rMultiple).toBeNull()
    expect(r.stats.n).toBe(0) // stats are over CLOSED trades only
  })
})

describe('backtestSignal — atr stop', () => {
  it('derives the stop distance from ATR at the entry bar × mult', () => {
    // Enough varied bars for ATR(2) to be warm at the idx3 entry.
    const closes = [10, 10, 10, 20, 20, 20, 20]
    const highs = [11, 11, 11, 21, 21, 21, 21]
    const lows = [9, 9, 9, 19, 19, 19, 19]
    const bars = makeBars(closes, { highs, lows })

    const atr = atrSeries(highs, lows, closes, 2)
    const expectedDistance = (atr[3] as number) * 2

    const r = backtestSignal(bars, {
      signal: GOLDEN, stop: { type: 'atr', mult: 2, period: 2 }, targetR: 2,
    })

    expect(r.trades).toHaveLength(1)
    const t = r.trades[0]
    expect(t.entryPrice).toBe(20)
    expect(t.stopPrice).toBeCloseTo(20 - expectedDistance, 4)
    expect(t.targetPrice).toBeCloseTo(20 + 2 * expectedDistance, 4)
  })

  it('skips a signal where ATR has not warmed up yet', () => {
    // ATR(14) needs 15 bars; the idx3 signal has no ATR → no trade, not a loss.
    const closes = [10, 10, 10, 20, 20, 20, 20]
    const r = backtestSignal(makeBars(closes), {
      signal: GOLDEN, stop: { type: 'atr', mult: 2 }, targetR: 2,
    })
    expect(r.trades).toHaveLength(0)
    expect(r.stats.n).toBe(0)
  })
})

describe('backtestSignal — start gate', () => {
  it('ignores signals dated before spec.start without touching later ones', () => {
    const closes = [10, 10, 10, 20, 20, 20, 20]
    const highs = [10, 10, 10, 20, 25, 20, 20]
    const withGate = backtestSignal(makeBars(closes, { highs }), {
      signal: GOLDEN, stop: { type: 'pct', pct: 10 }, targetR: 2, start: '2024-01-05',
    })
    expect(withGate.trades).toHaveLength(0)

    const withoutGate = backtestSignal(makeBars(closes, { highs }), {
      signal: GOLDEN, stop: { type: 'pct', pct: 10 }, targetR: 2, start: '2024-01-01',
    })
    expect(withoutGate.trades).toHaveLength(1)
  })
})

describe('backtestSignal — empty and degenerate input', () => {
  it('returns empty trades and zeroed stats on no bars', () => {
    const r = backtestSignal([], { signal: GOLDEN, stop: { type: 'pct', pct: 10 }, targetR: 2 })
    expect(r.trades).toEqual([])
    expect(r.stats.n).toBe(0)
  })

  it('state-type signals produce no entries', () => {
    const closes = [10, 10, 10, 20, 20, 20, 20]
    const r = backtestSignal(makeBars(closes), {
      signal: { type: 'trend_filter', period: 3 }, stop: { type: 'pct', pct: 10 }, targetR: 2,
    })
    expect(r.trades).toEqual([])
  })
})
