import { describe, it, expect } from 'vitest'
import { computePositionSize } from './position-size.js'

describe('computePositionSize', () => {
  it('case 1 — GBP account, USD instrument, risk cap binds', () => {
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
      entryPrice: '100', stopPrice: '95', side: 'long',
    })
    // equityUsd 25400, budget 254, riskQty 50.8, positionCap 63.5 -> qty 50
    expect(r.caps.riskQty).toBe('50.8')
    expect(r.caps.positionCapQty).toBe('63.5')
    expect(r.qty).toBe('50')
    expect(r.binding).toBe('risk')
    expect(r.riskUsd).toBe('250')
    expect(r.riskAccountCcy).toBe('196.85')
    expect(r.notionalUsd).toBe('5000')
    expect(r.notionalPctOfEquity).toBe('19.69')
    expect(r.warnings).toEqual([])
    expect(r.targets).toEqual([
      { r: 1, price: '105', gainAccountCcy: '196.85' },
      { r: 2, price: '110', gainAccountCcy: '393.7' },
      { r: 3, price: '115', gainAccountCcy: '590.55' },
    ])
    expect(r.rrAtFirstTarget).toBe('1')
  })

  it('case 2 — tight stop makes the position cap the binding constraint', () => {
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
      entryPrice: '100', stopPrice: '99.5', side: 'long',
    })
    // riskQty 508 vs positionCap 63.5 -> qty floors to 63
    expect(r.caps.riskQty).toBe('508')
    expect(r.caps.positionCapQty).toBe('63.5')
    expect(r.qty).toBe('63')
    expect(r.binding).toBe('position-cap')
    expect(r.riskUsd).toBe('31.5')
    expect(r.riskAccountCcy).toBe('24.8')
    // 63 * 100 / 25400 * 100 = 24.80...% > 20% -> concentrated warning
    expect(r.notionalPctOfEquity).toBe('24.8')
    expect(r.warnings).toContain('concentrated position')
  })

  it('case 3a — Kelly given but its risk% (6.25%) exceeds the max allowed riskPerTradePct (2%), so risk still binds', () => {
    // With winRate 55 / avgWinR 1.5 / avgLossR 1 / fraction 0.25, quarter-Kelly
    // works out to 6.25% risk — above the 2% ceiling riskPerTradePct is
    // clamped to. Since risk% is always <= kellyRiskPct in that situation,
    // Kelly can never be the tightest cap here; it only ever loosens things.
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
      entryPrice: '100', stopPrice: '95', side: 'long',
      kelly: { winRatePct: 55, avgWinR: 1.5, avgLossR: 1, fraction: 0.25 },
    })
    expect(r.caps.kellyCapQty).toBe('317.5')
    expect(r.caps.riskQty).toBe('50.8')
    expect(r.binding).toBe('risk')
  })

  it('case 3b — Kelly cap genuinely binds when its risk% is below riskPerTradePct', () => {
    // winRate 52%, 1:1 payoff -> k = 0.52 - 0.48/1 = 0.04 -> quarter-Kelly = 1%.
    // riskPerTradePct 1.5% and a loose position cap leave Kelly as the tightest.
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'USD', fxRateToUsd: '1',
      entryPrice: '100', stopPrice: '90', side: 'long',
      riskPerTradePct: 1.5, maxPositionPct: 25,
      kelly: { winRatePct: 52, avgWinR: 1, avgLossR: 1, fraction: 0.25 },
    })
    expect(r.caps.riskQty).toBe('30')
    expect(r.caps.positionCapQty).toBe('50')
    expect(r.caps.kellyCapQty).toBe('20')
    expect(r.qty).toBe('20')
    expect(r.binding).toBe('kelly')
  })

  it('case 4 — negative-edge Kelly forces qty to zero with a warning', () => {
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
      entryPrice: '100', stopPrice: '95', side: 'long',
      kelly: { winRatePct: 30, avgWinR: 1, avgLossR: 1 },
    })
    expect(r.caps.kellyCapQty).toBe('0')
    expect(r.qty).toBe('0')
    expect(r.binding).toBe('kelly')
    expect(r.warnings).toContain('backtest stats imply negative edge — Kelly says size 0')
  })

  it('case 5 — portfolio heat block', () => {
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
      entryPrice: '100', stopPrice: '95', side: 'long',
      currentOpenRiskUsd: '1200',
    })
    // open 1200 + new 250 = 1450 > 5% of 25400 = 1270
    expect(r.qty).toBe('0')
    expect(r.binding).toBe('heat-blocked')
    expect(r.riskUsd).toBe('0')
    expect(r.warnings.some((w) => w.includes('1200') && w.includes('250') && w.includes('1450') && w.includes('1270'))).toBe(true)
  })

  it('case 6 — short side targets sit below entry', () => {
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
      entryPrice: '100', stopPrice: '105', side: 'short',
    })
    expect(r.qty).toBe('50')
    expect(r.targets).toEqual([
      { r: 1, price: '95', gainAccountCcy: '196.85' },
      { r: 2, price: '90', gainAccountCcy: '393.7' },
      { r: 3, price: '85', gainAccountCcy: '590.55' },
    ])
  })

  it('case 7a — riskPerTradePct above 2 throws RangeError', () => {
    expect(() =>
      computePositionSize({
        equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
        entryPrice: '100', stopPrice: '95', side: 'long', riskPerTradePct: 3,
      }),
    ).toThrow(RangeError)
  })

  it('case 7b — stop on the wrong side of entry throws RangeError', () => {
    expect(() =>
      computePositionSize({
        equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
        entryPrice: '100', stopPrice: '105', side: 'long',
      }),
    ).toThrow(RangeError)
    expect(() =>
      computePositionSize({
        equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
        entryPrice: '100', stopPrice: '95', side: 'short',
      }),
    ).toThrow(RangeError)
  })

  it('case 7c — fractional keeps 4dp qty instead of flooring to whole shares', () => {
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'GBP', fxRateToUsd: '1.27',
      entryPrice: '100', stopPrice: '95', side: 'long',
      fractional: true,
    })
    expect(r.qty).toBe('50.8')
    expect(r.binding).toBe('risk')
  })

  it('riskPerTradePct below 0.1 is clamped up rather than erroring', () => {
    const r = computePositionSize({
      equity: '20000', accountCurrency: 'USD', fxRateToUsd: '1',
      entryPrice: '100', stopPrice: '95', side: 'long',
      riskPerTradePct: 0.01,
    })
    // clamped to 0.1% -> budget = 20000*0.001 = 20 -> riskQty = 20/5 = 4
    expect(r.caps.riskQty).toBe('4')
  })

  it('entry/stop equal or non-positive throws RangeError', () => {
    expect(() =>
      computePositionSize({
        equity: '20000', accountCurrency: 'USD', fxRateToUsd: '1',
        entryPrice: '100', stopPrice: '100', side: 'long',
      }),
    ).toThrow(RangeError)
    expect(() =>
      computePositionSize({
        equity: '20000', accountCurrency: 'USD', fxRateToUsd: '1',
        entryPrice: '0', stopPrice: '95', side: 'long',
      }),
    ).toThrow(RangeError)
  })
})
