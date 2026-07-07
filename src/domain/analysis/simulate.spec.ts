import { describe, it, expect } from 'vitest'
import { simulate, type SimulateResult } from './simulate.js'
import type { BarService } from '@/domain/market-data/bars/index'
import type { OhlcvBar } from '@/domain/market-data/bars/types'

function makeBars(closes: number[]): OhlcvBar[] {
  return closes.map((c, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000,
  }))
}
function svcOf(bars: OhlcvBar[]): BarService {
  return {
    searchBarSources: async () => [],
    getBars: async () => ({
      bars,
      meta: { symbol: 'XLE', from: bars[0]?.date ?? '', to: bars[bars.length - 1]?.date ?? '', bars: bars.length, source: 'uta', barId: 'alpaca|XLE', asOf: bars[bars.length - 1]?.date ?? '' },
    }),
  } as unknown as BarService
}
const ok = (r: SimulateResult | { error: string }): SimulateResult => {
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('simulate', () => {
  it('trailing_stop exits when close falls pct% from the running peak', async () => {
    // up to 110 then drop to 99 (−10% from peak 110)
    const svc = svcOf(makeBars([100, 105, 110, 108, 99]))
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-01', exit: { type: 'trailing_stop', pct: 8 },
    }))
    expect(r.entry).toMatchObject({ date: '2026-04-01', price: 100 })
    expect(r.exit).not.toBeNull()
    expect(r.exit!.date).toBe('2026-04-05') // 99 is −10% from 110 peak (> 8%)
    expect(r.open).toBe(false)
    expect(r.mfePct).toBeGreaterThan(0) // ran up to 110.5 high
  })

  it('ma_break exits on the first close below its SMA', async () => {
    // slow climb then a sharp drop below the 3-bar SMA
    const svc = svcOf(makeBars([50, 51, 52, 53, 54, 45]))
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-03', exit: { type: 'ma_break', period: 3 },
    }))
    expect(r.exit).not.toBeNull()
    expect(r.exit!.date).toBe('2026-04-06') // close 45 < SMA3
    expect(r.exit!.reason).toMatch(/SMA3/)
  })

  it('hold never exits — return is mark-to-market to the last bar', async () => {
    const svc = svcOf(makeBars([100, 110, 120]))
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-01', exit: { type: 'hold' },
    }))
    expect(r.open).toBe(true)
    expect(r.exit).toBeNull()
    expect(r.returnPct).toBe(20) // 100 → 120
    expect(r.note).toMatch(/open/)
  })

  it('target exits on the first close at/above +pct%', async () => {
    const svc = svcOf(makeBars([100, 103, 106]))
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-01', exit: { type: 'target', pct: 5 },
    }))
    expect(r.exit!.date).toBe('2026-04-03') // 106 ≥ +5%
    expect(r.returnPct).toBe(6)
  })

  it('bracket: a bar that OPENS below the stop fills at the open (gap rule)', async () => {
    // entry 100, stop 5% -> 95. bar 04-02 gaps open at 88, straight through the stop.
    const svc = svcOf([
      { date: '2026-04-01', open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 },
      { date: '2026-04-02', open: 88, high: 90, low: 86, close: 89, volume: 1000 },
    ])
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-01', exit: { type: 'bracket', stopPct: 5, targetPct: 10 },
    }))
    expect(r.exit).not.toBeNull()
    expect(r.exit!.price).toBe(88) // the OPEN, not a flattering fill at the 95 level
    expect(r.exit!.reason).toMatch(/gapped below/)
    expect(r.returnPct).toBe(-12) // a real gap loss exceeds the stop percent
  })

  it('bracket exits at the target LEVEL (intrabar high) when hit', async () => {
    // entry 100 on 04-01. stop 5% -> 95, target 10% -> 110.
    // bar 04-02 high 108 (below target), bar 04-03 high 111 (touches target 110), low 106 (no stop).
    const svc = svcOf([
      { date: '2026-04-01', open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 },
      { date: '2026-04-02', open: 100, high: 108, low: 99, close: 103, volume: 1000 },
      { date: '2026-04-03', open: 103, high: 111, low: 106, close: 109, volume: 1000 },
    ])
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-01', exit: { type: 'bracket', stopPct: 5, targetPct: 10 },
    }))
    expect(r.exit).not.toBeNull()
    expect(r.exit!.date).toBe('2026-04-03')
    expect(r.exit!.price).toBe(110) // target LEVEL, not close
    expect(r.exit!.reason).toMatch(/target/)
  })

  it('bracket: stop wins when a single bar touches both stop and target', async () => {
    // entry 100, stop 5% -> 95, target 10% -> 110. bar 04-02 low 94 (touches stop) AND high 112 (touches target).
    const svc = svcOf([
      { date: '2026-04-01', open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 },
      { date: '2026-04-02', open: 100, high: 112, low: 94, close: 105, volume: 1000 },
    ])
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-01', exit: { type: 'bracket', stopPct: 5, targetPct: 10 },
    }))
    expect(r.exit).not.toBeNull()
    expect(r.exit!.date).toBe('2026-04-02')
    expect(r.exit!.price).toBe(95) // stop LEVEL wins on tie
    expect(r.exit!.reason).toMatch(/stop/)
  })

  it('bracket: maxBars forces a time exit at close when neither level is hit', async () => {
    // entry 100, stop 20% -> 80, target 20% -> 120. bars stay in [95,105] the whole way, maxBars=2.
    const svc = svcOf([
      { date: '2026-04-01', open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 },
      { date: '2026-04-02', open: 100, high: 103, low: 98, close: 101, volume: 1000 },
      { date: '2026-04-03', open: 101, high: 104, low: 97, close: 102, volume: 1000 },
      { date: '2026-04-04', open: 102, high: 105, low: 96, close: 103, volume: 1000 },
    ])
    const r = ok(await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-04-01', exit: { type: 'bracket', stopPct: 20, targetPct: 20, maxBars: 2 },
    }))
    expect(r.exit).not.toBeNull()
    expect(r.exit!.date).toBe('2026-04-03') // 2 bars past entry (entryIdx=0, i=2)
    expect(r.exit!.price).toBe(102) // time exit at close
    expect(r.exit!.reason).toMatch(/time exit at close|no stop\/target hit/)
  })

  it('errors when the entry date is past the available window', async () => {
    const svc = svcOf(makeBars([100, 101]))
    const r = await simulate(svc, { barId: 'alpaca|XLE' } as never, {
      entryDate: '2026-09-01', exit: { type: 'hold' },
    })
    expect('error' in r).toBe(true)
  })
})
