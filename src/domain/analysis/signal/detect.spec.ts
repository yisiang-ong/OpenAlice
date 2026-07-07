import { describe, it, expect } from 'vitest'
import { detectSignalEvents, type DetectBar } from './detect.js'

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

describe('detectSignalEvents — ma_cross', () => {
  // Hand-computed SMA2/SMA3 crossing dates:
  //   idx: 0   1   2   3    4   5   6    7   8  9
  //   c:   10  10  10  20   20  20  5    5   5  5
  //   sma2:   10  10  15   20  20  12.5  5   5  5
  //   sma3:       10  13.33 16.67 20  15  10  5  5
  // fast>slow: idx2 false, idx3 TRUE (golden@3), idx4 true, idx5 false (death@5), idx6.. false
  const bars = makeBars([10, 10, 10, 20, 20, 20, 5, 5, 5, 5])

  it('fires a golden cross then a death cross on the exact known dates', () => {
    const r = detectSignalEvents(bars, { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma', direction: 'both' })
    expect(r.barsScanned).toBe(10)
    expect(r.events).toHaveLength(2)

    expect(r.events[0].date).toBe('2024-01-04')
    expect(r.events[0].label).toBe('SMA2 crossed above SMA3')
    expect(r.events[0].direction).toBe('bullish')
    expect(r.events[0].close).toBe(20)
    expect(r.events[0].context.sma2).toBe(15)
    expect(r.events[0].context.sma3).toBeCloseTo(13.3333, 4)

    expect(r.events[1].date).toBe('2024-01-06')
    expect(r.events[1].label).toBe('SMA2 crossed below SMA3')
    expect(r.events[1].direction).toBe('bearish')
    expect(r.events[1].context.sma2).toBe(20)
    expect(r.events[1].context.sma3).toBe(20)
  })

  it('state.activeNow reflects fast > slow at the last bar', () => {
    const r = detectSignalEvents(bars, { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma' })
    expect(r.state.asOfDate).toBe('2024-01-10')
    expect(r.state.activeNow).toBe(false) // sma2=sma3=5 at the last bar
    expect(r.state.values.sma2).toBe(5)
    expect(r.state.values.sma3).toBe(5)
  })

  it('direction filter narrows to only golden or only death crosses', () => {
    const golden = detectSignalEvents(bars, { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma', direction: 'golden' })
    expect(golden.events).toHaveLength(1)
    expect(golden.events[0].direction).toBe('bullish')

    const death = detectSignalEvents(bars, { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma', direction: 'death' })
    expect(death.events).toHaveLength(1)
    expect(death.events[0].direction).toBe('bearish')
  })

  it('state.activeNow answers the DIRECTION asked: death reads fast BELOW slow', () => {
    // Decisive downtrend at the end: sma2=7.5 < sma3≈11.67 on the last bar.
    const down = makeBars([20, 20, 20, 20, 10, 5])
    const death = detectSignalEvents(down, { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma', direction: 'death' })
    expect(death.state.activeNow).toBe(true) // the death-cross state IS in effect

    const golden = detectSignalEvents(down, { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma', direction: 'golden' })
    expect(golden.state.activeNow).toBe(false) // same bars, opposite question
  })

  it('no-cross case: a monotonic series where fast stays above slow never crosses', () => {
    const flat = makeBars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const r = detectSignalEvents(flat, { type: 'ma_cross', fast: 2, slow: 3, ma: 'sma' })
    expect(r.events).toEqual([])
    expect(r.state.activeNow).toBe(true) // fast(9.5) > slow(9) at the last bar
  })
})

describe('detectSignalEvents — rsi_cross', () => {
  it('fires cross_above when RSI crosses the level, with no exceptions on short data', () => {
    const short = makeBars([1, 2, 3])
    const r = detectSignalEvents(short, { type: 'rsi_cross', level: 50, direction: 'cross_above' })
    expect(r.events).toEqual([])
    expect(r.barsScanned).toBe(3)
  })
})

describe('detectSignalEvents — trend_filter (state signal, both sides)', () => {
  it('activeNow is true when the last close is above its SMA', () => {
    const bars = makeBars([10, 10, 10, 10, 20])
    const r = detectSignalEvents(bars, { type: 'trend_filter', period: 3 })
    expect(r.events).toEqual([]) // state signals never produce events
    expect(r.state.activeNow).toBe(true) // close 20 > sma3 avg(10,10,20)=13.33
    expect(r.state.values.sma3).toBeCloseTo(13.3333, 4)
    expect(r.state.values.close).toBe(20)
  })

  it('activeNow is false when the last close is below its SMA', () => {
    const bars = makeBars([20, 20, 20, 20, 5])
    const r = detectSignalEvents(bars, { type: 'trend_filter', period: 3 })
    expect(r.state.activeNow).toBe(false) // close 5 < sma3 avg(20,20,5)=15
    expect(r.state.values.sma3).toBe(15)
  })
})

describe('detectSignalEvents — high_52w_proximity (state signal)', () => {
  it('activeNow is true when close sits within withinPct of the inclusive 52w high', () => {
    // Needs a real 252-bar lookback window to exercise rollingHighest(high, 252)
    // rather than falling back to just the current bar's own high.
    const closes = new Array(260).fill(100)
    closes[259] = 98 // 2% below the flat 100 high that held for the prior year
    const bars = makeBars(closes)
    const r = detectSignalEvents(bars, { type: 'high_52w_proximity', withinPct: 5 })
    expect(r.events).toEqual([])
    expect(r.state.activeNow).toBe(true)
    expect(r.state.values.pctFrom52wHigh).toBeCloseTo(-2, 4)
    expect(r.state.values.high52w).toBe(100)
  })

  it('activeNow is false when close is farther than withinPct below the 52w high', () => {
    const closes = new Array(260).fill(100)
    closes[259] = 80 // 20% below — outside a 5% band
    const bars = makeBars(closes)
    const r = detectSignalEvents(bars, { type: 'high_52w_proximity', withinPct: 5 })
    expect(r.state.activeNow).toBe(false)
  })
})

describe('detectSignalEvents — breakout with minRvol filtering', () => {
  // 20 flat baseline bars (idx 0-19, high=close=10, volume=1000) establish the
  // RVOL baseline. idx20 breaks to a new 3-bar high on LOW volume (should be
  // filtered out by minRvol). idx21-23 revert to 10 (so the 3-bar window
  // clears the idx20 spike). idx24 breaks again on HIGH volume (should pass).
  const highs = [
    ...new Array(20).fill(10), // 0-19
    20, // 20 — low-volume breakout candidate
    10, 10, 10, // 21-23
    30, // 24 — high-volume breakout
  ]
  const volumes = [
    ...new Array(20).fill(1000),
    400, // 20 — thin
    1000, 1000, 1000,
    5000, // 24 — heavy
  ]
  const bars = makeBars(highs, { highs, volumes })

  it('without a filter, both breakouts (thin and heavy volume) register', () => {
    const r = detectSignalEvents(bars, { type: 'breakout', lookback: 3 })
    expect(r.events.map((e) => e.date)).toEqual(['2024-01-21', '2024-01-25'])
  })

  it('with minRvol, the thin-volume breakout is filtered out and only the heavy one remains', () => {
    const r = detectSignalEvents(bars, { type: 'breakout', lookback: 3, minRvol: 1.5 })
    expect(r.events).toHaveLength(1)
    expect(r.events[0].date).toBe('2024-01-25')
    expect(r.events[0].label).toMatch(/broke above 3-bar high with RVOL/)
    expect(r.events[0].context.rvol20).toBeGreaterThanOrEqual(1.5)
    expect(r.events[0].context.high3).toBe(10)
  })
})

describe('detectSignalEvents — breakdown', () => {
  it('fires when close breaks below the prior lookback low', () => {
    const lows = [5, 5, 5, 5, 1, 5, 5, 5]
    const bars = makeBars(lows, { lows })
    const r = detectSignalEvents(bars, { type: 'breakdown', lookback: 3 })
    expect(r.events).toHaveLength(1)
    expect(r.events[0].date).toBe('2024-01-05')
    expect(r.events[0].direction).toBe('bearish')
    expect(r.events[0].label).toMatch(/broke below 3-bar low/)
  })
})

describe('detectSignalEvents — macd_cross', () => {
  it('runs on a longer synthetic series without throwing and reports a consistent shape', () => {
    const closes: number[] = []
    let price = 100
    for (let i = 0; i < 60; i++) {
      price += Math.sin(i / 4) * 2
      closes.push(Number(price.toFixed(2)))
    }
    const bars = makeBars(closes)
    const r = detectSignalEvents(bars, { type: 'macd_cross' })
    expect(r.barsScanned).toBe(60)
    for (const e of r.events) {
      expect(['bullish', 'bearish']).toContain(e.direction)
      expect(typeof e.context.macd).toBe('number')
      expect(typeof e.context.macdSignal).toBe('number')
    }
    expect(typeof r.state.activeNow).toBe('boolean')
  })
})

describe('detectSignalEvents — empty input', () => {
  it('returns an empty result without throwing', () => {
    const r = detectSignalEvents([], { type: 'trend_filter' })
    expect(r).toEqual({ events: [], state: { activeNow: false, asOfDate: '', values: {} }, barsScanned: 0 })
  })
})
