/**
 * Position sizing — GBP-aware fixed-fractional risk engine.
 *
 * Model: the trader risks a fixed percent of equity per trade (default 1%,
 * clamped to [0.1, 2]), converted through `fxRateToUsd` so a non-USD
 * account (e.g. GBP) sizes USD instruments correctly. Three independent
 * caps are evaluated and the tightest wins:
 *   1. risk cap        — budget / stopDistance (the fixed-fractional qty)
 *   2. position cap     — maxPositionPct of equity / entry (concentration guard)
 *   3. Kelly cap        — optional; a fractional-Kelly (default quarter-Kelly)
 *      edge-derived risk% translated to qty the same way as (1). A
 *      non-positive Kelly edge forces size to zero with a warning.
 * After sizing, a portfolio-heat check compares total open risk (existing +
 * new) against `maxPortfolioHeatPct` of equity and can block the trade
 * outright (qty '0', binding 'heat-blocked'). All money math is Decimal
 * internally; inputs/outputs are strings to avoid float drift.
 */

import Decimal from 'decimal.js'

export interface PositionSizeInput {
  equity: string
  accountCurrency: string
  /** 1 unit of accountCurrency in USD; '1' for USD. */
  fxRateToUsd: string
  entryPrice: string
  stopPrice: string
  side: 'long' | 'short'
  /** Default 1. Clamped up to 0.1 if below. Values > 2 throw. */
  riskPerTradePct?: number
  maxPositionPct?: number
  maxPortfolioHeatPct?: number
  currentOpenRiskUsd?: string
  kelly?: { winRatePct: number; avgWinR: number; avgLossR: number; fraction?: number }
  targetRs?: number[]
  /** Default false — floor qty to whole shares. True keeps 4dp. */
  fractional?: boolean
}

export interface PositionSizeResult {
  qty: string
  notionalUsd: string
  notionalPctOfEquity: string
  stopPrice: string
  stopDistance: string
  stopDistancePct: string
  riskUsd: string
  riskAccountCcy: string
  riskPctOfEquity: string
  targets: Array<{ r: number; price: string; gainAccountCcy: string }>
  rrAtFirstTarget: string
  caps: { riskQty: string; positionCapQty: string; kellyCapQty?: string }
  binding: 'risk' | 'position-cap' | 'kelly' | 'heat-blocked' | 'zero'
  warnings: string[]
}

const HALF_UP = Decimal.ROUND_HALF_UP
const DOWN = Decimal.ROUND_DOWN

/** Round to 2dp (money/pct display) — no forced trailing zeros. */
function r2(d: Decimal): string {
  return d.toDecimalPlaces(2, HALF_UP).toString()
}

/** Floor qty per the fractional rule: whole shares, or 4dp if fractional allowed. */
function floorQty(d: Decimal, fractional: boolean): Decimal {
  if (d.lte(0)) return new Decimal(0)
  return fractional ? d.toDecimalPlaces(4, DOWN) : d.toDecimalPlaces(0, DOWN)
}

export function computePositionSize(input: PositionSizeInput): PositionSizeResult {
  const entry = new Decimal(input.entryPrice)
  const stop = new Decimal(input.stopPrice)

  if (!entry.isFinite() || entry.lte(0)) {
    throw new RangeError(`entryPrice must be a positive number, got "${input.entryPrice}"`)
  }
  if (!stop.isFinite() || stop.lte(0)) {
    throw new RangeError(`stopPrice must be a positive number, got "${input.stopPrice}"`)
  }
  if (stop.eq(entry)) {
    throw new RangeError('stopPrice must not equal entryPrice (zero stop distance)')
  }
  if (input.side === 'long' && stop.gte(entry)) {
    throw new RangeError(`long trade requires stopPrice (${input.stopPrice}) below entryPrice (${input.entryPrice})`)
  }
  if (input.side === 'short' && stop.lte(entry)) {
    throw new RangeError(`short trade requires stopPrice (${input.stopPrice}) above entryPrice (${input.entryPrice})`)
  }

  // ---- riskPerTradePct: default 1, clamp low end to 0.1, error above 2 ----
  const riskPctRaw = input.riskPerTradePct ?? 1
  if (riskPctRaw > 2) {
    throw new RangeError(`riskPerTradePct must be <= 2, got ${riskPctRaw}`)
  }
  const riskPct = Math.max(riskPctRaw, 0.1)

  const maxPositionPct = input.maxPositionPct ?? 25
  const maxPortfolioHeatPct = input.maxPortfolioHeatPct ?? 5
  const fractional = input.fractional ?? false

  const fx = new Decimal(input.fxRateToUsd)
  const equity = new Decimal(input.equity)
  const equityUsd = equity.mul(fx)
  const stopDistance = entry.minus(stop).abs()

  const budgetUsd = equityUsd.mul(riskPct).div(100)
  const riskQty = budgetUsd.div(stopDistance)
  const positionCapQty = equityUsd.mul(maxPositionPct).div(100).div(entry)

  const warnings: string[] = []

  // ---- targetRs: default [1,2,3]; drop non-positive/non-finite entries ----
  const targetRsInput = (input.targetRs ?? []).filter((r) => Number.isFinite(r) && r > 0)
  if (input.targetRs != null && targetRsInput.length === 0) {
    warnings.push('targetRs had no positive finite entries — using default [1, 2, 3]')
  }
  const targetRs = targetRsInput.length > 0 ? targetRsInput : [1, 2, 3]

  // ---- Kelly (optional) ----
  let kellyCapQty: Decimal | undefined
  if (input.kelly) {
    const { winRatePct, avgWinR, avgLossR } = input.kelly
    const fraction = input.kelly.fraction ?? 0.25
    // An n=0 backtest reports all-zero stats; 0/0 → NaN would make the Kelly
    // cap silently inert AND skip the negative-edge warning. Degenerate or
    // out-of-range inputs skip the cap loudly instead.
    const degenerate =
      !Number.isFinite(winRatePct) || !Number.isFinite(avgWinR) || !Number.isFinite(avgLossR) ||
      winRatePct < 0 || winRatePct > 100 || avgWinR < 0 || avgLossR < 0 ||
      (avgWinR === 0 && avgLossR === 0)
    if (degenerate) {
      warnings.push('Kelly inputs are degenerate (e.g. an empty backtest\'s all-zero stats) — Kelly cap skipped; do not size off this backtest')
    } else {
      const p = winRatePct / 100
      const b = avgWinR / avgLossR // avgLossR 0 with wins > 0 → b = Infinity → k = p (no-loss sample)
      const k = p - (1 - p) / b
      // k = -Infinity (never wins money) is a legitimate "size 0"; k = NaN
      // (p=1 with b=0 → 0/0) is not a number at all — skip loudly, because a
      // NaN silently fails every comparison below and would emit a "NaN" cap.
      if (Number.isNaN(k)) {
        warnings.push('Kelly inputs are degenerate (100% wins that won nothing) — Kelly cap skipped; do not size off this backtest')
      } else {
        const kellyRiskPct = Math.max(0, k) * fraction * 100
        kellyCapQty = equityUsd.mul(kellyRiskPct).div(100).div(stopDistance)
        if (k <= 0) {
          warnings.push('backtest stats imply negative edge — Kelly says size 0')
        }
      }
    }
  }

  // ---- pick the tightest cap ----
  const candidates: Array<{ name: 'risk' | 'position-cap' | 'kelly'; value: Decimal }> = [
    { name: 'risk', value: riskQty },
    { name: 'position-cap', value: positionCapQty },
  ]
  if (kellyCapQty) candidates.push({ name: 'kelly', value: kellyCapQty })

  let minCandidate = candidates[0]!
  for (const c of candidates.slice(1)) {
    if (c.value.lt(minCandidate.value)) minCandidate = c
  }

  let qty = floorQty(minCandidate.value, fractional)
  let binding: PositionSizeResult['binding']
  if (qty.lte(0)) {
    binding = minCandidate.name === 'kelly' ? 'kelly' : 'zero'
  } else {
    binding = minCandidate.name
  }

  // ---- actual risk after flooring ----
  let riskUsd = qty.mul(stopDistance)
  let riskAccountCcy = riskUsd.div(fx)

  // ---- portfolio heat check ----
  const currentOpenRiskUsd = new Decimal(input.currentOpenRiskUsd ?? '0')
  const heatLimitUsd = equityUsd.mul(maxPortfolioHeatPct).div(100)
  const totalRiskUsd = currentOpenRiskUsd.plus(riskUsd)
  if (qty.gt(0) && totalRiskUsd.gt(heatLimitUsd)) {
    const newRiskUsd = riskUsd
    qty = new Decimal(0)
    riskUsd = new Decimal(0)
    riskAccountCcy = new Decimal(0)
    binding = 'heat-blocked'
    warnings.push(
      `open risk $${r2(currentOpenRiskUsd)} + new risk $${r2(newRiskUsd)} = $${r2(totalRiskUsd)} exceeds ${maxPortfolioHeatPct}% heat limit of $${r2(heatLimitUsd)}`,
    )
  }

  const notionalUsd = qty.mul(entry)
  const notionalPctOfEquity = equityUsd.isZero() ? new Decimal(0) : notionalUsd.div(equityUsd).mul(100)
  const riskPctOfEquity = equityUsd.isZero() ? new Decimal(0) : riskUsd.div(equityUsd).mul(100)
  const stopDistancePct = stopDistance.div(entry).mul(100)

  if (notionalPctOfEquity.gt(20)) {
    warnings.push('concentrated position')
  }

  const targets = targetRs.map((r) => {
    const price = input.side === 'long' ? entry.plus(stopDistance.mul(r)) : entry.minus(stopDistance.mul(r))
    const gainAccountCcy = qty.mul(r).mul(stopDistance).div(fx)
    return { r, price: r2(price), gainAccountCcy: r2(gainAccountCcy) }
  })

  return {
    qty: fractional ? qty.toDecimalPlaces(4).toString() : qty.toDecimalPlaces(0).toString(),
    notionalUsd: r2(notionalUsd),
    notionalPctOfEquity: r2(notionalPctOfEquity),
    stopPrice: input.stopPrice,
    stopDistance: r2(stopDistance),
    stopDistancePct: r2(stopDistancePct),
    riskUsd: r2(riskUsd),
    riskAccountCcy: r2(riskAccountCcy),
    riskPctOfEquity: r2(riskPctOfEquity),
    targets,
    rrAtFirstTarget: String(targetRs[0]),
    caps: {
      riskQty: riskQty.toDecimalPlaces(4).toString(),
      positionCapQty: positionCapQty.toDecimalPlaces(4).toString(),
      ...(kellyCapQty ? { kellyCapQty: kellyCapQty.toDecimalPlaces(4).toString() } : {}),
    },
    binding,
    warnings,
  }
}
