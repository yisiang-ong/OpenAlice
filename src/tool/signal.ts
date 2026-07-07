/**
 * Signal detection — MCP tool.
 *
 * Wraps `detectSignalEvents` (domain/analysis/signal): the crossover / entry-
 * signal detector calc-v2 deliberately doesn't have. calc-v2 (calculateQuant)
 * gives you indicator SERIES/SCALARS with no boolean or crossover operators —
 * "when did the 50 cross the 200" has no expression to write there. This tool
 * answers exactly that, over dated bars, with citation-grade output (an exact
 * date + a plain-English label + the context that backs it).
 *
 * Same freshest-source resolution as simulate/marketSnapshot — a bare symbol
 * auto-picks a realtime broker over a delayed vendor.
 *
 * Two tools: `detectSignals` (date the triggers) and `backtestSignal` (replay
 * every historical trigger through a stop/target bracket and report the
 * aggregate edge — win rate, avg R, expectancy).
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService } from '@/domain/market-data/bars/index'
import { detectSignalEvents, backtestSignal, type DetectBar, type SignalSpec, type BacktestSpec } from '@/domain/analysis/signal/index'
import { resolveBarSource } from './source-resolve.js'

const SIGNAL_TYPES = ['ma_cross', 'rsi_cross', 'macd_cross', 'breakout', 'breakdown', 'high_52w_proximity', 'trend_filter'] as const

function isMaCrossDirection(v: string | undefined): v is 'golden' | 'death' | 'both' | undefined {
  return v == null || v === 'golden' || v === 'death' || v === 'both'
}
function isMacdDirection(v: string | undefined): v is 'bullish' | 'bearish' | 'both' | undefined {
  return v == null || v === 'bullish' || v === 'bearish' || v === 'both'
}
function isRsiDirection(v: string | undefined): v is 'cross_above' | 'cross_below' {
  return v === 'cross_above' || v === 'cross_below'
}

/** Calendar days to pad BEFORE `start` so every rolling series (MA/RSI/ATR/
 *  rolling-high) has warmed up by the requested start date — same buffer
 *  idiom as simulate.ts (bars-needed × 1.6 to cover weekends/holidays). */
function warmupBars(spec: SignalSpec): number {
  switch (spec.type) {
    case 'ma_cross': return Math.max(spec.fast, spec.slow)
    case 'rsi_cross': return spec.period ?? 14
    case 'macd_cross': return (spec.slow ?? 26) + 9 // + default signal-line EMA period
    case 'breakout': case 'breakdown': return spec.lookback
    case 'high_52w_proximity': return 252
    case 'trend_filter': return spec.period ?? 200
  }
}

function defaultStart(daysBack = 365): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

/** Flat tool params → SignalSpec, validating what each signal type needs.
 *  Shared by detectSignals and backtestSignal (same trigger grammar). */
function buildSignalSpec(p: {
  signal: (typeof SIGNAL_TYPES)[number]
  fast?: number; slow?: number; ma?: 'ema' | 'sma'; direction?: string
  level?: number; period?: number; lookback?: number; minRvol?: number; withinPct?: number
}): SignalSpec | { error: string } {
  const { signal, fast, slow, ma, direction, level, period, lookback, minRvol, withinPct } = p
  switch (signal) {
    case 'ma_cross': {
      if (fast == null || slow == null) return { error: 'signal "ma_cross" needs fast and slow (the MA periods).' }
      if (!isMaCrossDirection(direction)) return { error: 'ma_cross direction must be one of golden, death, both.' }
      return { type: 'ma_cross', fast, slow, ...(ma ? { ma } : {}), ...(direction ? { direction } : {}) }
    }
    case 'rsi_cross': {
      if (level == null || direction == null) return { error: 'signal "rsi_cross" needs level and direction (cross_above or cross_below).' }
      if (!isRsiDirection(direction)) return { error: 'rsi_cross direction must be cross_above or cross_below.' }
      return { type: 'rsi_cross', level, direction, ...(period != null ? { period } : {}) }
    }
    case 'macd_cross': {
      if (!isMacdDirection(direction)) return { error: 'macd_cross direction must be one of bullish, bearish, both.' }
      return { type: 'macd_cross', ...(direction ? { direction } : {}), ...(fast != null ? { fast } : {}), ...(slow != null ? { slow } : {}) }
    }
    case 'breakout': {
      if (lookback == null) return { error: 'signal "breakout" needs lookback (bars in the prior range).' }
      return { type: 'breakout', lookback, ...(minRvol != null ? { minRvol } : {}) }
    }
    case 'breakdown': {
      if (lookback == null) return { error: 'signal "breakdown" needs lookback (bars in the prior range).' }
      return { type: 'breakdown', lookback, ...(minRvol != null ? { minRvol } : {}) }
    }
    case 'high_52w_proximity':
      return { type: 'high_52w_proximity', ...(withinPct != null ? { withinPct } : {}) }
    case 'trend_filter':
      return { type: 'trend_filter', ...(period != null ? { period } : {}) }
  }
}

function toDetectBars(bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume?: number | null }>): DetectBar[] {
  return bars.map((b) => ({
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume ?? 0,
  }))
}

export function createSignalTools(barService: BarService) {
  return {
    detectSignals: tool({
      description: `Detect crossover / entry-signal EVENTS (and two persistent state reads) on dated bars: MA crosses, RSI/MACD crosses, breakouts/breakdowns, 52-week-high proximity, trend filter.

Use this — not calculateQuant/calculateIndicator — whenever the question is "when/did X cross Y", "did it break out of its range", or "is it near its 52-week high". calc-v2 deliberately has NO crossover or boolean operators: it gives you indicator series/scalars (sma(...), rsi(...)) but "when did the 50-day cross the 200-day" has no expression to write there. This tool is that missing piece.

Output is citation-grade: every event carries an exact date, a plain-English label, and a context object built from the SAME rolling arrays (no extra fetches) — e.g. "EMA20 crossed above EMA50 on 2026-07-01 with RVOL 2.1" comes from an event { date: '2026-07-01', label: 'EMA20 crossed above EMA50', context: { ema20, ema50, rvol20, atr14, rsi14, pctFrom52wHigh } }.

Signal types (pass \`signal\` + its params):
  ma_cross            fast, slow, ma='ema'|'sma' (default ema), direction='golden'|'death'|'both' (default both)
  rsi_cross           level, direction='cross_above'|'cross_below' (both required), period (default 14)
  macd_cross          direction='bullish'|'bearish'|'both' (default both), fast (default 12), slow (default 26)
  breakout            lookback (required), minRvol (optional — require RVOL confirmation on the break)
  breakdown           lookback (required), minRvol (optional)
  high_52w_proximity  withinPct (default 5) — STATE signal: no events; state.activeNow = close within withinPct% of the 252-bar high
  trend_filter        period (default 200) — STATE signal: state.activeNow = close above its SMA(period)

Returns { events, state, barsScanned }. state.activeNow always reflects the LATEST bar (for event types: is the crossing condition true right now; for state types: the actual read). Events are capped at the most recent 50 (note added if truncated). Source: a barId pins one; a bare symbol/query auto-picks the freshest (realtime broker > delayed vendor).`,
      inputSchema: z.object({
        query: z.string().optional().describe('Symbol/keyword — auto-picks the freshest source. Omit if barId given.'),
        barId: z.string().optional().describe('Pin a source, e.g. "alpaca-paper|XLE". Wins over query.'),
        asset: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional().describe('Needed only for a VENDOR barId/symbol.'),
        signal: z.enum(SIGNAL_TYPES).describe('Which signal to detect.'),
        fast: z.number().int().positive().optional().describe('ma_cross: fast MA period. macd_cross: fast EMA period (default 12).'),
        slow: z.number().int().positive().optional().describe('ma_cross: slow MA period. macd_cross: slow EMA period (default 26).'),
        ma: z.enum(['ema', 'sma']).optional().describe('ma_cross: moving-average type (default ema).'),
        direction: z.string().optional().describe('ma_cross: golden|death|both (default both). rsi_cross: cross_above|cross_below (required). macd_cross: bullish|bearish|both (default both).'),
        level: z.number().optional().describe('rsi_cross: the RSI level to cross (required).'),
        period: z.number().int().positive().optional().describe('rsi_cross: RSI period (default 14). trend_filter: SMA period (default 200).'),
        lookback: z.number().int().positive().optional().describe('breakout/breakdown: bars in the prior range (required).'),
        minRvol: z.number().positive().optional().describe('breakout/breakdown: require RVOL(20) at/above this to count the break.'),
        withinPct: z.number().positive().optional().describe('high_52w_proximity: % band around the 252-bar high (default 5).'),
        interval: z.string().optional().describe('Bar interval (default "1d").'),
        start: z.string().optional().describe('Scan window start (YYYY-MM-DD). Default: 1 year back.'),
        asOf: z.string().optional().describe('Evaluate up to here (YYYY-MM-DD). Default: now.'),
      }).meta({ examples: [{ query: 'AAPL', signal: 'ma_cross', fast: 20, slow: 50 }] }),
      execute: async (params) => {
        const { query, barId, asset, signal, fast, slow, ma, direction, level, period, lookback, minRvol, withinPct } = params
        const interval = params.interval ?? '1d'
        const start = params.start ?? defaultStart()

        const spec = buildSignalSpec({ signal, fast, slow, ma, direction, level, period, lookback, minRvol, withinPct })
        if ('error' in spec) return spec

        const resolved = await resolveBarSource(barService, { query, barId, asset })
        if ('error' in resolved) return resolved

        // Pad the fetch window BEFORE `start` so every rolling series (MA/RSI/
        // ATR/rolling-high) has already warmed up by the requested start date.
        const bufferDays = Math.ceil((warmupBars(spec) + 10) * 1.6)
        const fetchStart = new Date(`${start}T00:00:00Z`)
        fetchStart.setUTCDate(fetchStart.getUTCDate() - bufferDays)
        const fetchStartStr = fetchStart.toISOString().slice(0, 10)

        const { bars, meta } = await barService.getBars(resolved.ref as never, {
          interval,
          start: fetchStartStr,
          ...(params.asOf ? { end: params.asOf } : {}),
        })
        if (bars.length === 0) {
          return { error: `No bars for ${meta.barId ?? meta.symbol} in the fetch window ${fetchStartStr}…${params.asOf ?? 'now'}. Check the symbol/source and dates.` }
        }

        const result = detectSignalEvents(toDetectBars(bars), spec)

        // Trim to the REQUESTED start (the padding above only exists to warm up
        // the rolling series, not to surface pre-window events).
        let events = result.events.filter((e) => e.date.slice(0, 10) >= start)
        const notes: string[] = []
        if (events.length > 50) {
          events = events.slice(-50)
          notes.push(`Truncated to the most recent 50 events (more exist in the scanned window).`)
        }

        return {
          symbol: meta.symbol,
          barId: meta.barId,
          source: meta.source,
          interval,
          spec,
          events,
          state: result.state,
          barsScanned: result.barsScanned,
          ...(notes.length ? { note: notes.join(' ') } : {}),
        }
      },
    }),

    backtestSignal: tool({
      description: `Quantify a signal's HISTORICAL EDGE: replay every past firing of a detectSignals trigger as a one-shot bracket entry (fixed stop + R-multiple target) and report win rate, average R, and expectancy — so a trade recommendation can say "this setup triggered 34× in 3y: 58% win, expectancy +0.21R" instead of asserting edge from vibes.

Trigger grammar = detectSignals exactly (same \`signal\` + params; state-type signals like trend_filter produce no entries). Entry: the CLOSE of each bullish signal bar. Stop: stopType 'atr' (default) → ATR(14) at the entry bar × stopMult (default 2); 'pct' → stopPct% below entry. Target: entry + targetR × stopDistance (default 2R). Exits are INTRABAR with the same conservative tie-break as simulate's bracket rule: if one bar touches both levels, the STOP wins. maxBars (default 60) forces a time exit at close. Trades are NON-OVERLAPPING — triggers that fire while a trade is open are skipped (one slot, like a human runs it). Long-only v1.

Stats are computed over CLOSED trades only (n = closed count; the last trade may end reason 'open'). Returns { stats, trades: last 10, totalTrades }. A closed sample under 10 carries a small-sample note — QUOTE IT: an anecdote is not evidence. Negative expectancyR disqualifies the setup. Source resolution as detectSignals (barId pins, bare symbol picks freshest; default window: 3 years back).`,
      inputSchema: z.object({
        query: z.string().optional().describe('Symbol/keyword — auto-picks the freshest source. Omit if barId given.'),
        barId: z.string().optional().describe('Pin a source, e.g. "alpaca-paper|XLE". Wins over query.'),
        asset: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional().describe('Needed only for a VENDOR barId/symbol.'),
        signal: z.enum(SIGNAL_TYPES).describe('Which trigger to backtest (same grammar as detectSignals).'),
        fast: z.number().int().positive().optional().describe('ma_cross: fast MA period. macd_cross: fast EMA period (default 12).'),
        slow: z.number().int().positive().optional().describe('ma_cross: slow MA period. macd_cross: slow EMA period (default 26).'),
        ma: z.enum(['ema', 'sma']).optional().describe('ma_cross: moving-average type (default ema).'),
        direction: z.string().optional().describe('ma_cross: golden|death|both. rsi_cross: cross_above|cross_below (required). macd_cross: bullish|bearish|both.'),
        level: z.number().optional().describe('rsi_cross: the RSI level to cross (required).'),
        period: z.number().int().positive().optional().describe('rsi_cross: RSI period (default 14). trend_filter: SMA period (default 200).'),
        lookback: z.number().int().positive().optional().describe('breakout/breakdown: bars in the prior range (required).'),
        minRvol: z.number().positive().optional().describe('breakout/breakdown: require RVOL(20) at/above this to count the break.'),
        withinPct: z.number().positive().optional().describe('high_52w_proximity: % band around the 252-bar high (default 5).'),
        stopType: z.enum(['atr', 'pct']).optional().describe('Stop-distance basis (default atr).'),
        stopMult: z.number().positive().optional().describe('atr stop: ATR multiple (default 2).'),
        stopPct: z.number().positive().optional().describe('pct stop: percent below entry (required when stopType is pct).'),
        atrPeriod: z.number().int().positive().optional().describe('atr stop: ATR period (default 14).'),
        targetR: z.number().positive().optional().describe('Target as an R-multiple of the stop distance (default 2).'),
        maxBars: z.number().int().positive().optional().describe('Force a time exit at close after this many bars (default 60).'),
        interval: z.string().optional().describe('Bar interval (default "1d").'),
        start: z.string().optional().describe('Backtest window start (YYYY-MM-DD). Default: 3 years back.'),
        asOf: z.string().optional().describe('Evaluate up to here (YYYY-MM-DD). Default: now.'),
      }).meta({ examples: [{ query: 'AAPL', signal: 'ma_cross', fast: 20, slow: 50, stopType: 'atr', stopMult: 2, targetR: 2 }] }),
      execute: async (params) => {
        const { query, barId, asset, signal, fast, slow, ma, direction, level, period, lookback, minRvol, withinPct } = params
        const interval = params.interval ?? '1d'
        const start = params.start ?? defaultStart(365 * 3)

        const spec = buildSignalSpec({ signal, fast, slow, ma, direction, level, period, lookback, minRvol, withinPct })
        if ('error' in spec) return spec

        const stopType = params.stopType ?? 'atr'
        let stop: BacktestSpec['stop']
        if (stopType === 'pct') {
          if (params.stopPct == null) return { error: 'stopType "pct" needs stopPct (percent below entry).' }
          stop = { type: 'pct', pct: params.stopPct }
        } else {
          stop = { type: 'atr', mult: params.stopMult ?? 2, ...(params.atrPeriod != null ? { period: params.atrPeriod } : {}) }
        }

        const resolved = await resolveBarSource(barService, { query, barId, asset })
        if ('error' in resolved) return resolved

        // Warm-up must cover the trigger's rolling series AND the ATR stop.
        const warmup = Math.max(warmupBars(spec), stopType === 'atr' ? (params.atrPeriod ?? 14) : 0)
        const bufferDays = Math.ceil((warmup + 10) * 1.6)
        const fetchStart = new Date(`${start}T00:00:00Z`)
        fetchStart.setUTCDate(fetchStart.getUTCDate() - bufferDays)
        const fetchStartStr = fetchStart.toISOString().slice(0, 10)

        const { bars, meta } = await barService.getBars(resolved.ref as never, {
          interval,
          start: fetchStartStr,
          ...(params.asOf ? { end: params.asOf } : {}),
        })
        if (bars.length === 0) {
          return { error: `No bars for ${meta.barId ?? meta.symbol} in the fetch window ${fetchStartStr}…${params.asOf ?? 'now'}. Check the symbol/source and dates.` }
        }

        // `start` gates the trade sample inside the domain walk, so stats and
        // the trades list describe the same window (the padded fetch exists
        // only to warm up the rolling series).
        const result = backtestSignal(toDetectBars(bars), {
          signal: spec,
          stop,
          targetR: params.targetR ?? 2,
          start,
          ...(params.maxBars != null ? { maxBars: params.maxBars } : {}),
        })
        const closed = result.trades.filter((t) => t.reason !== 'open')

        return {
          symbol: meta.symbol,
          barId: meta.barId,
          source: meta.source,
          interval,
          window: { start, asOf: params.asOf ?? 'now' },
          spec: { signal: spec, stop, targetR: params.targetR ?? 2, maxBars: params.maxBars ?? 60 },
          stats: result.stats,
          totalTrades: result.trades.length,
          closedTrades: closed.length,
          trades: result.trades.slice(-10),
          ...(result.note ? { note: result.note } : {}),
        }
      },
    }),
  }
}
