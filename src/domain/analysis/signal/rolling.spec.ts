import { describe, it, expect } from 'vitest'
import { smaSeries, emaSeries, rsiSeries, atrSeries, rvolSeries, macdSeries, rollingHighest, rollingLowest } from './rolling.js'
import { SMA, EMA } from '../indicator/functions/statistics.js'
import { RSI, ATR, RVOL, MACD } from '../indicator/functions/technical.js'

// Deterministic pseudo-random walk (LCG) — same seed every run, ~100 points,
// so parity assertions are reproducible without a real market-data fetch.
function lcgSeries(n: number, seed: number): number[] {
  const out: number[] = []
  let x = seed
  let price = 100
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648
    const r = x / 2147483648 // 0..1
    price = price * (1 + (r - 0.5) * 0.04) // ±2% steps
    out.push(Number(price.toFixed(4)))
  }
  return out
}

const N = 100
const closes = lcgSeries(N, 42)
// Highs/lows bracket the close with a small deterministic offset derived from
// the close itself so they stay internally consistent (high >= close >= low).
const highs = closes.map((c, i) => Number((c + Math.abs(Math.sin(i)) * 1.5).toFixed(4)))
const lows = closes.map((c, i) => Number((c - Math.abs(Math.cos(i)) * 1.5).toFixed(4)))
const volumes = lcgSeries(N, 7).map((v) => Math.round(Math.abs(v) * 1000 + 1000))

describe('smaSeries', () => {
  it('matches SMA() at the last bar', () => {
    const period = 20
    const series = smaSeries(closes, period)
    expect(series[series.length - 1]).toBeCloseTo(SMA(closes, period), 8)
  })
  it('is null during warm-up and defined at period - 1', () => {
    const series = smaSeries(closes, 10)
    expect(series[8]).toBeNull()
    expect(series[9]).not.toBeNull()
  })
  it('returns all-null series when input shorter than period', () => {
    const series = smaSeries([1, 2, 3], 10)
    expect(series).toEqual([null, null, null])
  })
})

describe('emaSeries', () => {
  it('matches EMA() at the last bar', () => {
    const period = 20
    const series = emaSeries(closes, period)
    expect(series[series.length - 1]).toBeCloseTo(EMA(closes, period), 8)
  })
  it('seeds at index period - 1 and is null before it', () => {
    const series = emaSeries(closes, 12)
    expect(series[10]).toBeNull()
    expect(series[11]).not.toBeNull()
  })
  it('matches EMA() at an interior prefix too (parity holds mid-series, not just at the end)', () => {
    const period = 9
    const series = emaSeries(closes, period)
    const prefixLen = 55
    expect(series[prefixLen - 1]).toBeCloseTo(EMA(closes.slice(0, prefixLen), period), 8)
  })
})

describe('rsiSeries', () => {
  it('matches RSI() at the last bar', () => {
    const period = 14
    const series = rsiSeries(closes, period)
    expect(series[series.length - 1]).toBeCloseTo(RSI(closes, period), 8)
  })
  it('is null through index period - 1 and defined starting at index period', () => {
    const series = rsiSeries(closes, 14)
    for (let i = 0; i < 14; i++) expect(series[i]).toBeNull()
    expect(series[14]).not.toBeNull()
  })
  it('matches RSI() at an interior prefix too', () => {
    const period = 14
    const series = rsiSeries(closes, period)
    const prefixLen = 60
    expect(series[prefixLen - 1]).toBeCloseTo(RSI(closes.slice(0, prefixLen), period), 8)
  })
  it('short input yields an all-null series', () => {
    const series = rsiSeries(closes.slice(0, 5), 14)
    expect(series.every((v) => v === null)).toBe(true)
  })
})

describe('atrSeries', () => {
  it('matches ATR() at the last bar', () => {
    const period = 14
    const series = atrSeries(highs, lows, closes, period)
    expect(series[series.length - 1]).toBeCloseTo(ATR(highs, lows, closes, period), 8)
  })
  it('is null through the warm-up window', () => {
    const series = atrSeries(highs, lows, closes, 14)
    for (let i = 0; i < 14; i++) expect(series[i]).toBeNull()
    expect(series[14]).not.toBeNull()
  })
})

describe('rvolSeries', () => {
  it('matches RVOL() at the last bar', () => {
    const period = 20
    const series = rvolSeries(volumes, period)
    expect(series[series.length - 1]).toBeCloseTo(RVOL(volumes, period), 8)
  })
  it('is null before index period', () => {
    const series = rvolSeries(volumes, 20)
    expect(series[19]).toBeNull()
    expect(series[20]).not.toBeNull()
  })
  it('is null (not throwing) when the trailing baseline is zero', () => {
    const vols = new Array(25).fill(0)
    vols[24] = 500
    const series = rvolSeries(vols, 20)
    expect(series[20]).toBeNull()
  })
})

describe('macdSeries', () => {
  it('matches MACD() at the last bar for macd/signal/histogram', () => {
    const scalar = MACD(closes, 12, 26, 9)
    const series = macdSeries(closes, 12, 26, 9)
    const last = series.macd.length - 1
    expect(series.macd[last]).toBeCloseTo(scalar.macd, 8)
    expect(series.signal[last]).toBeCloseTo(scalar.signal, 8)
    expect(series.histogram[last]).toBeCloseTo(scalar.histogram, 8)
  })
  it('has the expected shape — three same-length series, null before the slow EMA warms up', () => {
    const series = macdSeries(closes, 12, 26, 9)
    expect(series.macd).toHaveLength(closes.length)
    expect(series.signal).toHaveLength(closes.length)
    expect(series.histogram).toHaveLength(closes.length)
    expect(series.macd[24]).toBeNull() // slow EMA(26) seeds at index 25
    expect(series.macd[25]).not.toBeNull()
    expect(series.signal[25]).toBeNull() // signal needs 9 more macd points to seed
  })
})

describe('rollingHighest / rollingLowest', () => {
  it('excludes the current bar — a spike on the eval bar does not count toward its own range', () => {
    const values = [1, 2, 3, 100, 5, 6, 7, 8]
    const highest = rollingHighest(values, 3)
    // at i=3 (value 100), prior 3 bars are [1,2,3] -> highest 3, NOT 100
    expect(highest[3]).toBe(3)
    // at i=4 (value 5), prior 3 bars are [2,3,100] -> highest 100 now included
    expect(highest[4]).toBe(100)
  })
  it('is null before index period', () => {
    const highest = rollingHighest([1, 2, 3, 4, 5], 3)
    expect(highest[0]).toBeNull()
    expect(highest[1]).toBeNull()
    expect(highest[2]).toBeNull()
    expect(highest[3]).toBe(3) // max of values[0..2]
  })
  it('rollingLowest mirrors rollingHighest with min', () => {
    const values = [10, 9, 8, 0, 6, 5]
    const lowest = rollingLowest(values, 3)
    expect(lowest[3]).toBe(8) // prior [10,9,8]
    expect(lowest[4]).toBe(0) // prior [9,8,0]
  })
})
