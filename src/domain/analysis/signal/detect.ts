/**
 * Signal detection — turn a declarative spec into DATED events over a bar
 * series (crossovers, breakouts, and two persistent "state" reads).
 *
 * calc-v2 (calculateQuant) deliberately has no crossover/boolean operators —
 * this is the layer that answers "when did X cross Y" without hand-rolling a
 * loop in a quant script every time. Pure over `DetectBar[]`: no BarService
 * dependency here (the tool layer fetches and pads the window; this module
 * just walks bars it's given).
 *
 * Crossing rule (event-type specs): a crossing fires at bar i when the boolean
 * condition is FALSE at i-1 and TRUE at i, with every series value involved
 * non-null at BOTH bars (so a crossing can't fire the moment an indicator
 * finishes warming up — that's a step, not a cross).
 *
 * State-type specs (`high_52w_proximity`, `trend_filter`) have no notion of a
 * "cross" — they describe a condition of the LATEST bar. `events` stays empty
 * for these; `state.activeNow` and `state.values` carry the read.
 */

import {
  emaSeries,
  smaSeries,
  rsiSeries,
  atrSeries,
  rvolSeries,
  macdSeries,
  rollingHighest,
  rollingLowest,
  type Series,
} from './rolling.js'

export interface DetectBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type SignalSpec =
  | { type: 'ma_cross'; fast: number; slow: number; ma?: 'ema' | 'sma'; direction?: 'golden' | 'death' | 'both' }
  | { type: 'rsi_cross'; level: number; direction: 'cross_above' | 'cross_below'; period?: number }
  | { type: 'macd_cross'; direction?: 'bullish' | 'bearish' | 'both'; fast?: number; slow?: number; signal?: number }
  | { type: 'breakout'; lookback: number; minRvol?: number }
  | { type: 'breakdown'; lookback: number; minRvol?: number }
  | { type: 'high_52w_proximity'; withinPct?: number }
  | { type: 'trend_filter'; period?: number }

export interface SignalEvent {
  date: string
  label: string
  direction: 'bullish' | 'bearish'
  close: number
  context: Record<string, number>
}

export interface DetectResult {
  events: SignalEvent[]
  state: { activeNow: boolean; asOfDate: string; values: Record<string, number> }
  barsScanned: number
}

function r4(v: number): number {
  return Number(v.toFixed(4))
}

/** Read a Series value, applying the standard 4dp rounding, or undefined if not computable. */
function put(ctx: Record<string, number>, key: string, v: number | null | undefined): void {
  if (v != null && Number.isFinite(v)) ctx[key] = r4(v)
}

const EMPTY_RESULT: DetectResult = { events: [], state: { activeNow: false, asOfDate: '', values: {} }, barsScanned: 0 }

export function detectSignalEvents(bars: DetectBar[], spec: SignalSpec): DetectResult {
  const n = bars.length
  if (n === 0) return { ...EMPTY_RESULT }

  const dates = bars.map((b) => b.date)
  const close = bars.map((b) => b.close)
  const high = bars.map((b) => b.high)
  const low = bars.map((b) => b.low)
  const volume = bars.map((b) => b.volume)
  const lastIdx = n - 1
  const asOfDate = dates[lastIdx]

  // Common context — always computed once, reused across every spec type so
  // an event's `context` can cite RVOL/ATR/RSI/52w-proximity "for free" (no
  // extra data fetches, just a read from an array already in memory).
  const rvol20 = rvolSeries(volume, 20)
  const atr14 = atrSeries(high, low, close, 14)
  const rsi14 = rsiSeries(close, 14)
  const high252Prior = rollingHighest(high, 252) // prior 252 bars, EXCLUSIVE of today
  // 52w-high proximity conventionally includes today's own high (a fresh
  // intraday high IS the 52-week high), unlike the breakout definition above.
  const high252Incl: Series = high.map((h, i) => {
    const prior = high252Prior[i]
    return prior == null ? h : Math.max(prior, h)
  })
  const pctFrom52wHigh: Series = close.map((c, i) => {
    const h = high252Incl[i]
    return h != null && h > 0 ? ((c - h) / h) * 100 : null
  })

  function baseContext(i: number): Record<string, number> {
    const ctx: Record<string, number> = {}
    put(ctx, 'rvol20', rvol20[i])
    put(ctx, 'atr14', atr14[i])
    put(ctx, 'rsi14', rsi14[i])
    put(ctx, 'pctFrom52wHigh', pctFrom52wHigh[i])
    return ctx
  }

  switch (spec.type) {
    case 'ma_cross': return detectMaCross(spec)
    case 'rsi_cross': return detectRsiCross(spec)
    case 'macd_cross': return detectMacdCross(spec)
    case 'breakout': return detectBreakout(spec)
    case 'breakdown': return detectBreakdown(spec)
    case 'high_52w_proximity': return detectHigh52wProximity(spec)
    case 'trend_filter': return detectTrendFilter(spec)
  }

  function detectMaCross(spec: Extract<SignalSpec, { type: 'ma_cross' }>): DetectResult {
    const ma = spec.ma ?? 'ema'
    const direction = spec.direction ?? 'both'
    const fastSeries = ma === 'sma' ? smaSeries(close, spec.fast) : emaSeries(close, spec.fast)
    const slowSeries = ma === 'sma' ? smaSeries(close, spec.slow) : emaSeries(close, spec.slow)
    const label = ma === 'sma' ? 'SMA' : 'EMA'
    const fastKey = `${label}${spec.fast}`
    const slowKey = `${label}${spec.slow}`
    const fastCtxKey = `${ma}${spec.fast}`
    const slowCtxKey = `${ma}${spec.slow}`

    const events: SignalEvent[] = []
    for (let i = 1; i <= lastIdx; i++) {
      const pf = fastSeries[i - 1], ps = slowSeries[i - 1]
      const cf = fastSeries[i], cs = slowSeries[i]
      if (pf == null || ps == null || cf == null || cs == null) continue
      const wasAbove = pf > ps
      const isAbove = cf > cs
      if (wasAbove === isAbove) continue // no cross this bar
      const golden = isAbove // fast crossed above slow
      if (direction === 'golden' && !golden) continue
      if (direction === 'death' && golden) continue
      const ctx = baseContext(i)
      put(ctx, fastCtxKey, cf)
      put(ctx, slowCtxKey, cs)
      events.push({
        date: dates[i],
        label: `${fastKey} crossed ${golden ? 'above' : 'below'} ${slowKey}`,
        direction: golden ? 'bullish' : 'bearish',
        close: r4(close[i]),
        context: ctx,
      })
    }

    const lf = fastSeries[lastIdx], ls = slowSeries[lastIdx]
    const values: Record<string, number> = {}
    put(values, fastCtxKey, lf)
    put(values, slowCtxKey, ls)
    // activeNow answers the DIRECTION the caller asked about: for 'death',
    // "is the death-cross state (fast below slow) in effect now"; for
    // 'golden'/'both', the golden state (fast above slow).
    const activeNow = lf != null && ls != null && (direction === 'death' ? lf < ls : lf > ls)
    return {
      events,
      state: { activeNow, asOfDate, values },
      barsScanned: n,
    }
  }

  function detectRsiCross(spec: Extract<SignalSpec, { type: 'rsi_cross' }>): DetectResult {
    const period = spec.period ?? 14
    const rsi = period === 14 ? rsi14 : rsiSeries(close, period)
    const rsiKey = `rsi${period}`
    const crossAbove = spec.direction === 'cross_above'

    const events: SignalEvent[] = []
    for (let i = 1; i <= lastIdx; i++) {
      const prev = rsi[i - 1], cur = rsi[i]
      if (prev == null || cur == null) continue
      const fired = crossAbove ? (prev <= spec.level && cur > spec.level) : (prev >= spec.level && cur < spec.level)
      if (!fired) continue
      const ctx = baseContext(i)
      put(ctx, rsiKey, cur)
      events.push({
        date: dates[i],
        label: `RSI(${period}) crossed ${crossAbove ? 'above' : 'below'} ${spec.level}`,
        direction: crossAbove ? 'bullish' : 'bearish',
        close: r4(close[i]),
        context: ctx,
      })
    }

    const last = rsi[lastIdx]
    const values: Record<string, number> = {}
    put(values, rsiKey, last)
    const activeNow = last != null && (crossAbove ? last > spec.level : last < spec.level)
    return { events, state: { activeNow, asOfDate, values }, barsScanned: n }
  }

  function detectMacdCross(spec: Extract<SignalSpec, { type: 'macd_cross' }>): DetectResult {
    const fast = spec.fast ?? 12
    const slow = spec.slow ?? 26
    const signal = spec.signal ?? 9
    const direction = spec.direction ?? 'both'
    const { macd, signal: sig } = macdSeries(close, fast, slow, signal)

    const events: SignalEvent[] = []
    for (let i = 1; i <= lastIdx; i++) {
      const pm = macd[i - 1], ps = sig[i - 1]
      const cm = macd[i], cs = sig[i]
      if (pm == null || ps == null || cm == null || cs == null) continue
      const wasAbove = pm > ps
      const isAbove = cm > cs
      if (wasAbove === isAbove) continue
      const bullish = isAbove
      if (direction === 'bullish' && !bullish) continue
      if (direction === 'bearish' && bullish) continue
      const ctx = baseContext(i)
      put(ctx, 'macd', cm)
      put(ctx, 'macdSignal', cs)
      events.push({
        date: dates[i],
        label: `MACD(${fast},${slow},${signal}) crossed ${bullish ? 'above' : 'below'} its signal line`,
        direction: bullish ? 'bullish' : 'bearish',
        close: r4(close[i]),
        context: ctx,
      })
    }

    const lm = macd[lastIdx], ls = sig[lastIdx]
    const values: Record<string, number> = {}
    put(values, 'macd', lm)
    put(values, 'macdSignal', ls)
    // activeNow answers the DIRECTION the caller asked about — see ma_cross.
    const activeNow = lm != null && ls != null && (direction === 'bearish' ? lm < ls : lm > ls)
    return {
      events,
      state: { activeNow, asOfDate, values },
      barsScanned: n,
    }
  }

  function detectBreakout(spec: Extract<SignalSpec, { type: 'breakout' }>): DetectResult {
    const priorHigh = rollingHighest(high, spec.lookback)
    const levelKey = `high${spec.lookback}`

    const events: SignalEvent[] = []
    for (let i = 1; i <= lastIdx; i++) {
      const ph = priorHigh[i - 1], ch = priorHigh[i]
      if (ph == null || ch == null) continue
      const wasAbove = close[i - 1] > ph
      const isAbove = close[i] > ch
      if (wasAbove || !isAbove) continue // only the first bar that clears the range
      const rv = rvol20[i]
      if (spec.minRvol != null && (rv == null || rv < spec.minRvol)) continue
      const ctx = baseContext(i)
      put(ctx, levelKey, ch)
      const rvolPhrase = rv != null ? ` with RVOL ${rv.toFixed(1)}` : ''
      events.push({
        date: dates[i],
        label: `close broke above ${spec.lookback}-bar high${rvolPhrase}`,
        direction: 'bullish',
        close: r4(close[i]),
        context: ctx,
      })
    }

    const lastLevel = priorHigh[lastIdx]
    const lastRvol = rvol20[lastIdx]
    const activeNow = lastLevel != null && close[lastIdx] > lastLevel &&
      (spec.minRvol == null || (lastRvol != null && lastRvol >= spec.minRvol))
    const values: Record<string, number> = {}
    put(values, levelKey, lastLevel)
    return { events, state: { activeNow, asOfDate, values }, barsScanned: n }
  }

  function detectBreakdown(spec: Extract<SignalSpec, { type: 'breakdown' }>): DetectResult {
    const priorLow = rollingLowest(low, spec.lookback)
    const levelKey = `low${spec.lookback}`

    const events: SignalEvent[] = []
    for (let i = 1; i <= lastIdx; i++) {
      const pl = priorLow[i - 1], cl = priorLow[i]
      if (pl == null || cl == null) continue
      const wasBelow = close[i - 1] < pl
      const isBelow = close[i] < cl
      if (wasBelow || !isBelow) continue
      const rv = rvol20[i]
      if (spec.minRvol != null && (rv == null || rv < spec.minRvol)) continue
      const ctx = baseContext(i)
      put(ctx, levelKey, cl)
      const rvolPhrase = rv != null ? ` with RVOL ${rv.toFixed(1)}` : ''
      events.push({
        date: dates[i],
        label: `close broke below ${spec.lookback}-bar low${rvolPhrase}`,
        direction: 'bearish',
        close: r4(close[i]),
        context: ctx,
      })
    }

    const lastLevel = priorLow[lastIdx]
    const lastRvol = rvol20[lastIdx]
    const activeNow = lastLevel != null && close[lastIdx] < lastLevel &&
      (spec.minRvol == null || (lastRvol != null && lastRvol >= spec.minRvol))
    const values: Record<string, number> = {}
    put(values, levelKey, lastLevel)
    return { events, state: { activeNow, asOfDate, values }, barsScanned: n }
  }

  function detectHigh52wProximity(spec: Extract<SignalSpec, { type: 'high_52w_proximity' }>): DetectResult {
    const withinPct = spec.withinPct ?? 5
    const pct = pctFrom52wHigh[lastIdx]
    const activeNow = pct != null && pct >= -withinPct
    const values: Record<string, number> = {}
    put(values, 'pctFrom52wHigh', pct)
    put(values, 'high52w', high252Incl[lastIdx])
    put(values, 'close', close[lastIdx])
    return { events: [], state: { activeNow, asOfDate, values }, barsScanned: n }
  }

  function detectTrendFilter(spec: Extract<SignalSpec, { type: 'trend_filter' }>): DetectResult {
    const period = spec.period ?? 200
    const sma = smaSeries(close, period)
    const key = `sma${period}`
    const last = sma[lastIdx]
    const activeNow = last != null && close[lastIdx] > last
    const values: Record<string, number> = {}
    put(values, key, last)
    put(values, 'close', close[lastIdx])
    return { events: [], state: { activeNow, asOfDate, values }, barsScanned: n }
  }
}
