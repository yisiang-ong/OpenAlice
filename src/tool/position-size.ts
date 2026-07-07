/**
 * Position sizing — MCP tool.
 *
 * Thin wrapper around `computePositionSize` (domain/trading-plan): resolves
 * equity + currency (either an explicit accountId via the UTA manager, or
 * an explicit equity/currency pair), resolves an FX rate to USD (explicit
 * override > live currency-client lookup > error), resolves the stop
 * (explicit stopPrice or ATR-derived), then calls the pure sizing math.
 *
 * Advisory only — this tool does not place or modify orders. The
 * account's own guards (max position, buying power, etc.) still enforce
 * at push time; this is a sizing calculator to consult beforehand.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { UTAManagerSDK } from '@/services/uta-client/index.js'
import type { CurrencyClientLike } from '@/domain/market-data/client/types.js'
import { computePositionSize } from '@/domain/trading-plan/position-size.js'

export interface PositionSizeToolDeps {
  /** Optional — enables the `accountId` path (fetches equity + baseCurrency from a live UTA). */
  manager?: UTAManagerSDK
  /** Optional — enables live FX lookup when `fxRate` isn't given and `currency` isn't USD. */
  currencyClient?: CurrencyClientLike
}

export function createPositionSizeTools(deps: PositionSizeToolDeps) {
  return {
    positionSize: tool({
      description: `Advisory position-size calculator — fixed-fractional risk sizing with a position-concentration cap, an optional fractional-Kelly cap, and a portfolio-heat check. Does NOT place orders; the account's own guards still enforce at push time.

Defaults: 1% risk per trade (clamp [0.1, 2], values above 2 are rejected), 25% max position of equity, 5% max portfolio heat, quarter-Kelly (fraction 0.25) when Kelly stats are given.

For a GBP (or other non-USD) account trading USD instruments, pass equity + currency: 'GBP' — the tool converts through the live (or overridden) FX rate so risk is sized correctly in USD terms. Reuse the returned stopPrice as the tpsl stop when placing the order, so the actual stop matches what was sized.`,
      inputSchema: z.object({
        accountId: z.string().optional().describe('UTA account id to pull equity + currency from. Omit and pass equity+currency explicitly if unavailable.'),
        equity: z.number().positive().optional().describe('Account equity, in `currency`. Required if accountId is omitted.'),
        currency: z.string().optional().describe('Account currency, e.g. "GBP". Default "USD".'),
        fxRate: z.number().positive().optional().describe('Override: 1 unit of `currency` in USD. Use when live FX is unavailable or you want to pin a rate.'),
        entryPrice: z.number().positive().describe('Planned entry price, in the instrument currency (USD).'),
        stopPrice: z.number().positive().optional().describe('Planned stop price (USD). Omit to derive from atr + atrMult.'),
        atr: z.number().positive().optional().describe('ATR (USD) — used to derive stopPrice if stopPrice is omitted.'),
        atrMult: z.number().positive().optional().describe('ATR multiple for the derived stop. Default 2.'),
        side: z.enum(['long', 'short']).optional().describe('Trade direction. Default "long".'),
        riskPerTradePct: z.number().optional().describe('Percent of equity risked on this trade. Default 1, clamped to >= 0.1, rejected above 2.'),
        maxPositionPct: z.number().optional().describe('Max position size as percent of equity. Default 25.'),
        maxPortfolioHeatPct: z.number().optional().describe('Max total open risk as percent of equity. Default 5.'),
        currentOpenRiskUsd: z.number().optional().describe('Existing open risk across other positions, in USD. Default 0.'),
        kellyWinRatePct: z.number().optional().describe('Backtested win rate (0-100). Provide with avgWinR/avgLossR to enable the Kelly cap.'),
        kellyAvgWinR: z.number().optional().describe('Average winning trade, in R multiples.'),
        kellyAvgLossR: z.number().optional().describe('Average losing trade, in R multiples (positive number).'),
        kellyFraction: z.number().optional().describe('Fraction of full-Kelly to use. Default 0.25 (quarter-Kelly).'),
        targetRs: z.array(z.number()).optional().describe('R multiples for target prices. Default [1, 2, 3].'),
        fractional: z.boolean().optional().describe('Allow fractional shares (4dp). Default false — floors to whole shares.'),
      }).meta({ examples: [{ equity: 20000, currency: 'GBP', entryPrice: 100, stopPrice: 95 }] }),
      execute: async (params) => {
        const {
          accountId, equity, currency, fxRate, entryPrice, stopPrice, atr, atrMult,
          side, riskPerTradePct, maxPositionPct, maxPortfolioHeatPct, currentOpenRiskUsd,
          kellyWinRatePct, kellyAvgWinR, kellyAvgLossR, kellyFraction, targetRs, fractional,
        } = params

        // ---- resolve equity + account currency ----
        let resolvedEquity: number
        let resolvedCurrency: string
        if (accountId != null) {
          if (!deps.manager) {
            return { error: 'accountId was given but no account manager is configured for this tool — pass equity and currency explicitly instead.' }
          }
          try {
            const uta = await deps.manager.resolveOne(accountId)
            const info = await uta.getAccount()
            resolvedEquity = Number(info.netLiquidation)
            resolvedCurrency = info.baseCurrency
          } catch (err) {
            return { error: `Could not fetch account "${accountId}": ${err instanceof Error ? err.message : String(err)}` }
          }
        } else if (equity != null) {
          resolvedEquity = equity
          resolvedCurrency = currency ?? 'USD'
        } else {
          return { error: 'Provide either accountId or an explicit equity (with currency).' }
        }

        // ---- resolve FX rate to USD ----
        let fxRateToUsd: string
        let fxSource: 'override' | 'live' | 'none'
        if (resolvedCurrency.toUpperCase() === 'USD') {
          fxRateToUsd = '1'
          fxSource = 'none'
        } else if (fxRate != null) {
          fxRateToUsd = String(fxRate)
          fxSource = 'override'
        } else if (deps.currencyClient) {
          try {
            const snapshots = await deps.currencyClient.getSnapshots({
              base: resolvedCurrency,
              counter_currencies: 'USD',
              provider: 'yfinance',
            })
            const snap = snapshots.find((s) => s.counter_currency?.toUpperCase() === 'USD')
            if (!snap || !(snap.last_rate > 0)) {
              return { error: `FX rate for ${resolvedCurrency} unavailable — pass fxRate explicitly` }
            }
            fxRateToUsd = String(snap.last_rate)
            fxSource = 'live'
          } catch {
            return { error: `FX rate for ${resolvedCurrency} unavailable — pass fxRate explicitly` }
          }
        } else {
          return { error: `FX rate for ${resolvedCurrency} unavailable — pass fxRate explicitly` }
        }

        // ---- resolve stop ----
        let resolvedStop: number
        if (stopPrice != null) {
          resolvedStop = stopPrice
        } else if (atr != null) {
          const mult = atrMult ?? 2
          const s = side ?? 'long'
          resolvedStop = s === 'short' ? entryPrice + atr * mult : entryPrice - atr * mult
        } else {
          return { error: 'Provide either stopPrice or atr (+ optional atrMult) to derive a stop.' }
        }

        const kelly = kellyWinRatePct != null && kellyAvgWinR != null && kellyAvgLossR != null
          ? { winRatePct: kellyWinRatePct, avgWinR: kellyAvgWinR, avgLossR: kellyAvgLossR, ...(kellyFraction != null ? { fraction: kellyFraction } : {}) }
          : undefined

        try {
          const result = computePositionSize({
            equity: String(resolvedEquity),
            accountCurrency: resolvedCurrency,
            fxRateToUsd,
            entryPrice: String(entryPrice),
            stopPrice: String(resolvedStop),
            side: side ?? 'long',
            ...(riskPerTradePct != null ? { riskPerTradePct } : {}),
            ...(maxPositionPct != null ? { maxPositionPct } : {}),
            ...(maxPortfolioHeatPct != null ? { maxPortfolioHeatPct } : {}),
            ...(currentOpenRiskUsd != null ? { currentOpenRiskUsd: String(currentOpenRiskUsd) } : {}),
            ...(kelly ? { kelly } : {}),
            ...(targetRs != null ? { targetRs } : {}),
            ...(fractional != null ? { fractional } : {}),
          })
          return { ...result, fx: { rate: fxRateToUsd, source: fxSource } }
        } catch (err) {
          if (err instanceof RangeError) return { error: err.message }
          throw err
        }
      },
    }),
  }
}
