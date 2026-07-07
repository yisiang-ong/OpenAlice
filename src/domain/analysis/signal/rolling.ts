/**
 * Rolling-series math — the per-bar counterparts of the scalar indicator
 * functions in `indicator/functions/{statistics,technical}.ts`.
 *
 * Those scalar functions answer "what is RSI/ATR/EMA... AT THE LAST BAR of
 * this array" (what calculateQuant scripts want). Signal detection needs the
 * WHOLE walk-forward series — "what was RSI at every bar" — so a crossing can
 * be located by date. Rather than re-deriving the math, every recursive
 * (Wilder / EMA) function here is written so that `series[i]` equals calling
 * the scalar function on `values.slice(0, i + 1)`; the parity spec asserts
 * this directly. That equivalence holds because Wilder/EMA smoothing is a
 * causal linear recursion — the seed only ever looks at the first `period`
 * points and every step after only depends on the past — so a single forward
 * pass across the full array reproduces exactly what re-running the scalar
 * function from scratch at each prefix would produce.
 *
 * Pure math only: no imports from outside this file (no market-data/BarService
 * dependency), so it can be unit tested and reused with zero setup.
 */

/** A per-bar value, `null` while the indicator is still warming up. */
export type Series = Array<number | null>

/** Simple Moving Average at every bar; null for i < period - 1. */
export function smaSeries(values: number[], period: number): Series {
  const n = values.length
  const result: Series = new Array(n).fill(null)
  for (let i = period - 1; i < n; i++) {
    let sum = 0
    for (let k = i - period + 1; k <= i; k++) sum += values[k]
    result[i] = sum / period
  }
  return result
}

/**
 * Exponential Moving Average at every bar. Seeded with the SMA of the FIRST
 * `period` values (matching EMA() in statistics.ts, which seeds from the
 * start of the array, not a trailing window), then standard smoothing with
 * k = 2 / (period + 1). Null before the seed bar (index period - 1).
 */
export function emaSeries(values: number[], period: number): Series {
  const n = values.length
  const result: Series = new Array(n).fill(null)
  if (n < period) return result

  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period
  result[period - 1] = ema
  for (let i = period; i < n; i++) {
    ema = (values[i] - ema) * k + ema
    result[i] = ema
  }
  return result
}

function rsiFromAvg(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * Wilder RSI at every bar — MUST stay in parity with RSI() in technical.ts.
 * Seeds avgGain/avgLoss from the first `period` changes (values[0..period]),
 * then applies Wilder's smoothing ((prev * (period-1) + new) / period) one
 * bar at a time. Null before index `period` (first bar with `period` prior
 * changes available).
 */
export function rsiSeries(values: number[], period: number = 14): Series {
  const n = values.length
  const result: Series = new Array(n).fill(null)
  if (n < period + 1) return result

  const changes: number[] = []
  for (let i = 1; i < n; i++) changes.push(values[i] - values[i - 1])
  const gains = changes.map((c) => (c > 0 ? c : 0))
  const losses = changes.map((c) => (c < 0 ? -c : 0))

  let avgGain = gains.slice(0, period).reduce((acc, v) => acc + v, 0) / period
  let avgLoss = losses.slice(0, period).reduce((acc, v) => acc + v, 0) / period
  result[period] = rsiFromAvg(avgGain, avgLoss)

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
    result[i + 1] = rsiFromAvg(avgGain, avgLoss)
  }
  return result
}

/**
 * Wilder ATR at every bar — parity with ATR() in technical.ts. Seeds from the
 * average of the first `period` true ranges, then Wilder-smooths one bar at a
 * time. Null before index `period`.
 */
export function atrSeries(high: number[], low: number[], close: number[], period: number = 14): Series {
  const n = high.length
  const result: Series = new Array(n).fill(null)
  if (n < period + 1 || low.length !== n || close.length !== n) return result

  const tr: number[] = []
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    ))
  }

  let atr = tr.slice(0, period).reduce((acc, v) => acc + v, 0) / period
  result[period] = atr
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period
    result[i + 1] = atr
  }
  return result
}

/**
 * Relative Volume at every bar — parity with RVOL() in technical.ts. Unlike
 * RSI/ATR this is NOT a recursive smoothing, just a plain rolling window:
 * volume[i] divided by the average of the `period` bars before it. Null
 * before index `period`, and also when the trailing baseline averages to
 * zero (RVOL undefined rather than throwing, since a series must keep going).
 */
export function rvolSeries(volume: number[], period: number = 20): Series {
  const n = volume.length
  const result: Series = new Array(n).fill(null)
  for (let i = period; i < n; i++) {
    const prior = volume.slice(i - period, i)
    const avg = prior.reduce((acc, v) => acc + v, 0) / period
    result[i] = avg === 0 ? null : volume[i] / avg
  }
  return result
}

/** MACD line, its signal line (EMA of the MACD line), and the histogram. */
export interface MacdSeries {
  macd: Series
  signal: Series
  histogram: Series
}

/**
 * MACD at every bar — parity with MACD() in technical.ts. macd[i] = fastEMA -
 * slowEMA at i; signal[i] is the EMA (period `signal`) OF the macd line
 * itself, seeded from the first bar the macd line is defined; histogram is
 * their difference.
 */
export function macdSeries(values: number[], fast: number = 12, slow: number = 26, signal: number = 9): MacdSeries {
  const n = values.length
  const macd: Series = new Array(n).fill(null)
  const signalSeries: Series = new Array(n).fill(null)
  const histogram: Series = new Array(n).fill(null)

  const fastEma = emaSeries(values, fast)
  const slowEma = emaSeries(values, slow)
  for (let i = 0; i < n; i++) {
    const f = fastEma[i]
    const s = slowEma[i]
    if (f != null && s != null) macd[i] = f - s
  }

  const firstIdx = macd.findIndex((v) => v !== null)
  if (firstIdx !== -1) {
    const macdCompact = macd.slice(firstIdx).map((v) => v as number)
    const signalCompact = emaSeries(macdCompact, signal)
    for (let i = 0; i < signalCompact.length; i++) {
      const sv = signalCompact[i]
      if (sv != null) {
        signalSeries[firstIdx + i] = sv
        histogram[firstIdx + i] = (macd[firstIdx + i] as number) - sv
      }
    }
  }

  return { macd, signal: signalSeries, histogram }
}

/**
 * Highest value over the PRIOR `period` bars, EXCLUSIVE of the current bar.
 * Breakout detection asks "did today's close clear the range set BEFORE
 * today" — including today's own high in its own range would make a breakout
 * definitionally impossible to ever register the day it happens. Null when
 * i < period (not enough prior bars yet).
 */
export function rollingHighest(values: number[], period: number): Series {
  const n = values.length
  const result: Series = new Array(n).fill(null)
  for (let i = period; i < n; i++) {
    let max = -Infinity
    for (let k = i - period; k < i; k++) if (values[k] > max) max = values[k]
    result[i] = max
  }
  return result
}

/** Lowest value over the PRIOR `period` bars, EXCLUSIVE of the current bar — see rollingHighest. */
export function rollingLowest(values: number[], period: number): Series {
  const n = values.length
  const result: Series = new Array(n).fill(null)
  for (let i = period; i < n; i++) {
    let min = Infinity
    for (let k = i - period; k < i; k++) if (values[k] < min) min = values[k]
    result[i] = min
  }
  return result
}
