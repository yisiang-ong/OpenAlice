import { describe, it, expect } from 'vitest'
import { createPositionSizeTools } from './position-size.js'
import type { UTAManagerSDK } from '@/services/uta-client/index.js'
import type { CurrencyClientLike } from '@/domain/market-data/client/types.js'

const ctx = { toolCallId: 't', messages: [] as never, abortSignal: undefined as never }

describe('positionSize tool', () => {
  it('explicit equity happy path — risk cap binds, qty 50', async () => {
    const { positionSize } = createPositionSizeTools({})
    const r = (await positionSize.execute!(
      { equity: 20000, currency: 'GBP', fxRate: 1.27, entryPrice: 100, stopPrice: 95 },
      ctx,
    )) as { qty: string; binding: string; fx: { rate: string; source: string } }
    expect(r.qty).toBe('50')
    expect(r.binding).toBe('risk')
    expect(r.fx).toEqual({ rate: '1.27', source: 'override' })
  })

  it('derives the stop from atr * atrMult when stopPrice is omitted', async () => {
    const { positionSize } = createPositionSizeTools({})
    const r = (await positionSize.execute!(
      { equity: 20000, currency: 'USD', entryPrice: 100, atr: 2.5, atrMult: 2 },
      ctx,
    )) as { stopPrice: string }
    // long, no side given -> stop = 100 - 2.5*2 = 95
    expect(r.stopPrice).toBe('95')
  })

  it('errors when neither accountId nor equity is given', async () => {
    const { positionSize } = createPositionSizeTools({})
    const r = (await positionSize.execute!({ entryPrice: 100, stopPrice: 95 }, ctx)) as { error: string }
    expect(r.error).toMatch(/accountId or an explicit equity/)
  })

  it('errors when accountId is given but no manager dependency is configured', async () => {
    const { positionSize } = createPositionSizeTools({})
    const r = (await positionSize.execute!({ accountId: 'alpaca-paper', entryPrice: 100, stopPrice: 95 }, ctx)) as { error: string }
    expect(r.error).toMatch(/no account manager is configured/)
  })

  it('fetches equity + currency from the account manager via accountId', async () => {
    const manager = {
      resolveOne: async (source: string) => {
        expect(source).toBe('alpaca-paper')
        return { getAccount: async () => ({ baseCurrency: 'USD', netLiquidation: '10000', totalCashValue: '10000', unrealizedPnL: '0' }) }
      },
    } as unknown as UTAManagerSDK
    const { positionSize } = createPositionSizeTools({ manager })
    const r = (await positionSize.execute!({ accountId: 'alpaca-paper', entryPrice: 100, stopPrice: 90 }, ctx)) as { qty: string }
    // equityUsd 10000, budget 1% = 100, riskQty = 100/10 = 10, positionCap = 2500/100=25 -> qty 10
    expect(r.qty).toBe('10')
  })

  it('FX-unavailable path returns {error} when the currency client throws and no fxRate override is given', async () => {
    const currencyClient = {
      getSnapshots: async () => { throw new Error('vendor down') },
    } as unknown as CurrencyClientLike
    const { positionSize } = createPositionSizeTools({ currencyClient })
    const r = (await positionSize.execute!(
      { equity: 20000, currency: 'GBP', entryPrice: 100, stopPrice: 95 },
      ctx,
    )) as { error: string }
    expect(r.error).toMatch(/FX rate for GBP unavailable/)
  })

  it('resolves live FX via the currency client when no override is given', async () => {
    const currencyClient = {
      getSnapshots: async (params: Record<string, unknown>) => {
        expect(params['base']).toBe('GBP')
        expect(params['counter_currencies']).toBe('USD')
        return [{ base_currency: 'GBP', counter_currency: 'USD', last_rate: 1.3 }]
      },
    } as unknown as CurrencyClientLike
    const { positionSize } = createPositionSizeTools({ currencyClient })
    const r = (await positionSize.execute!(
      { equity: 20000, currency: 'GBP', entryPrice: 100, stopPrice: 95 },
      ctx,
    )) as { fx: { rate: string; source: string } }
    expect(r.fx).toEqual({ rate: '1.3', source: 'live' })
  })

  it('riskPerTradePct > 2 surfaces the domain RangeError as {error}', async () => {
    const { positionSize } = createPositionSizeTools({})
    const r = (await positionSize.execute!(
      { equity: 20000, currency: 'USD', entryPrice: 100, stopPrice: 95, riskPerTradePct: 3 },
      ctx,
    )) as { error: string }
    expect(r.error).toMatch(/riskPerTradePct/)
  })

  it('errors when neither stopPrice nor atr is given', async () => {
    const { positionSize } = createPositionSizeTools({})
    const r = (await positionSize.execute!({ equity: 20000, currency: 'USD', entryPrice: 100 }, ctx)) as { error: string }
    expect(r.error).toMatch(/stopPrice or atr/)
  })
})
