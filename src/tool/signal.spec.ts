import { describe, it, expect } from 'vitest'
import { createSignalTools, warmupCalendarDays } from './signal.js'
import type { BarService } from '@/domain/market-data/bars/index'
import type { OhlcvBar } from '@/domain/market-data/bars/types'

// Same hand-computed SMA2/SMA3 crossing dataset as detect.spec.ts: golden
// cross at index 3, death cross at index 5 — dated within the last year so
// the tool's default `start` (1 year back) doesn't filter them out.
function makeBars(closes: number[]): OhlcvBar[] {
  return closes.map((c, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    open: c, high: c, low: c, close: c, volume: 1000,
  }))
}
const bars = makeBars([10, 10, 10, 20, 20, 20, 5, 5, 5, 5])

function mockSvc(): BarService {
  return {
    searchBarSources: async (q: string) => {
      if (q === 'UNKNOWN') return []
      return [{ barId: `yfinance|${q}`, source: 'vendor', sourceId: 'yfinance', symbol: q, assetClass: 'equity', label: q, barCapability: 'delayed' }]
    },
    getBars: async () => ({
      bars,
      meta: { symbol: 'AAPL', from: bars[0].date, to: bars[bars.length - 1].date, bars: bars.length, source: 'vendor', sourceId: 'yfinance', barId: 'yfinance|AAPL' },
    }),
  } as unknown as BarService
}

const ctx = { toolCallId: 't', messages: [] as never, abortSignal: undefined as never }

describe('detectSignals tool', () => {
  it('happy path: returns dated crossover events for a resolved symbol', async () => {
    const { detectSignals } = createSignalTools(mockSvc())
    const r = (await detectSignals.execute!(
      { query: 'AAPL', signal: 'ma_cross', fast: 2, slow: 3, ma: 'sma' },
      ctx,
    )) as {
      symbol: string; barId?: string; source?: string; events: Array<{ date: string; label: string; direction: string }>
      state: { activeNow: boolean }; barsScanned: number
    }

    expect(r.symbol).toBe('AAPL')
    expect(r.barId).toBe('yfinance|AAPL')
    expect(r.barsScanned).toBe(10)
    expect(r.events).toHaveLength(2)
    expect(r.events[0]).toMatchObject({ date: '2026-06-04', label: 'SMA2 crossed above SMA3', direction: 'bullish' })
    expect(r.events[1]).toMatchObject({ date: '2026-06-06', label: 'SMA2 crossed below SMA3', direction: 'bearish' })
    expect(r.state.activeNow).toBe(false)
  })

  it('missing required param returns a named error instead of throwing', async () => {
    const { detectSignals } = createSignalTools(mockSvc())
    const r = (await detectSignals.execute!({ query: 'AAPL', signal: 'rsi_cross' }, ctx)) as { error: string }
    expect(r.error).toMatch(/rsi_cross/)
    expect(r.error).toMatch(/level/)
    expect(r.error).toMatch(/direction/)
  })

  it('breakout without lookback returns a named error', async () => {
    const { detectSignals } = createSignalTools(mockSvc())
    const r = (await detectSignals.execute!({ query: 'AAPL', signal: 'breakout' }, ctx)) as { error: string }
    expect(r.error).toMatch(/breakout/)
    expect(r.error).toMatch(/lookback/)
  })

  it('unknown symbol surfaces the source-resolution error', async () => {
    const { detectSignals } = createSignalTools(mockSvc())
    const r = (await detectSignals.execute!(
      { query: 'UNKNOWN', signal: 'ma_cross', fast: 2, slow: 3 },
      ctx,
    )) as { error: string }
    expect(r.error).toMatch(/No bar source found/)
  })
})

describe('backtestSignal tool', () => {
  it('happy path: replays the golden cross through a pct bracket and reports stats + capped trades', async () => {
    const { backtestSignal } = createSignalTools(mockSvc())
    // Golden cross at 2026-06-04 (entry 20, stop 18); the bar on 2026-06-07
    // OPENS at 5 — a gap straight through the stop, so the gap rule books the
    // real fill at the open (−7.5R), not a flattering −1R at the level.
    const r = (await backtestSignal.execute!(
      { query: 'AAPL', signal: 'ma_cross', fast: 2, slow: 3, ma: 'sma', stopType: 'pct', stopPct: 10, targetR: 2 },
      ctx,
    )) as {
      symbol: string; stats: { n: number; winRatePct: number; expectancyR: number }
      trades: Array<{ entryDate: string; exitDate: string | null; exitPrice: number | null; rMultiple: number | null; reason: string }>
      totalTrades: number; closedTrades: number; note?: string
    }

    expect(r.symbol).toBe('AAPL')
    expect(r.totalTrades).toBe(1)
    expect(r.closedTrades).toBe(1)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]).toMatchObject({
      entryDate: '2026-06-04', exitDate: '2026-06-07', exitPrice: 5, rMultiple: -7.5, reason: 'stop',
    })
    expect(r.stats).toMatchObject({ n: 1, winRatePct: 0, expectancyR: -7.5 })
    expect(r.note).toMatch(/Small sample/)
  })

  it('stopType pct without stopPct returns a named error', async () => {
    const { backtestSignal } = createSignalTools(mockSvc())
    const r = (await backtestSignal.execute!(
      { query: 'AAPL', signal: 'ma_cross', fast: 2, slow: 3, stopType: 'pct' },
      ctx,
    )) as { error: string }
    expect(r.error).toMatch(/stopPct/)
  })

  it('shares detectSignals’ trigger validation (missing ma_cross periods)', async () => {
    const { backtestSignal } = createSignalTools(mockSvc())
    const r = (await backtestSignal.execute!({ query: 'AAPL', signal: 'ma_cross' }, ctx)) as { error: string }
    expect(r.error).toMatch(/ma_cross/)
    expect(r.error).toMatch(/fast and slow/)
  })
})

describe('warmupCalendarDays — interval-aware fetch padding', () => {
  it('daily bars keep the ×1.6 weekend/holiday factor', () => {
    expect(warmupCalendarDays(200, '1d')).toBe(320)
  })

  it('weekly bars span whole calendar weeks — a 200-bar warm-up needs ~4 years, not 320 days', () => {
    expect(warmupCalendarDays(200, '1wk')).toBe(1400)
  })

  it('monthly bars span whole months', () => {
    expect(warmupCalendarDays(12, '1mo')).toBe(372)
  })

  it('intraday bars pack many bars into one trading day (never under one day)', () => {
    expect(warmupCalendarDays(200, '1h')).toBe(50) // ceil(200 / 6.5 * 1.6)
    expect(warmupCalendarDays(10, '15m')).toBe(1) // floored at one calendar day
  })

  it('distinguishes minutes ("1m") from months ("1mo")', () => {
    expect(warmupCalendarDays(390, '1m')).toBe(2) // one trading day of minute bars ≈ 1.6 days
    expect(warmupCalendarDays(390, '1mo')).toBe(12090)
  })
})
