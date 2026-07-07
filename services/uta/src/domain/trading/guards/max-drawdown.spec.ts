import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr'
import { MaxDrawdownGuard } from './max-drawdown.js'
import type { GuardContext } from './types.js'
import type { Operation } from '../git/types.js'
import type { AccountInfo, Position } from '../brokers/types.js'
import { makeContract, makePosition } from '../brokers/mock/index.js'
import '../contract-ext.js'

function makePlaceOrderOp(): Operation {
  return { action: 'placeOrder', contract: makeContract({ symbol: 'AAPL' }), order: {} as never }
}

function makeSellOrderOp(symbol: string, qty: number): Operation {
  const order = new Order()
  order.action = 'SELL'
  order.orderType = 'LMT'
  order.totalQuantity = new Decimal(qty)
  return { action: 'placeOrder', contract: makeContract({ symbol }), order }
}

function makeContext(overrides: {
  operation?: Operation
  account?: Partial<AccountInfo>
  positions?: Position[]
} = {}): GuardContext {
  return {
    operation: overrides.operation ?? makePlaceOrderOp(),
    positions: overrides.positions ?? [],
    accountId: 'test-account',
    account: {
      baseCurrency: 'USD',
      netLiquidation: '100000',
      totalCashValue: '100000',
      unrealizedPnL: '0',
      realizedPnL: '0',
      ...overrides.account,
    },
  }
}

describe('MaxDrawdownGuard', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'oa-max-drawdown-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('seeds the HWM on first run and allows', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir })
    const ctx = makeContext({ account: { netLiquidation: '20000' } })

    const result = await guard.check(ctx)
    expect(result).toBeNull()

    const raw = await readFile(join(tmpDir, 'hwm.json'), 'utf-8')
    const state = JSON.parse(raw)
    expect(new Decimal(state.hwm).toString()).toBe('20000')
  })

  it('allows when below the drawdown threshold', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 10 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed HWM

    const result = await guard.check(makeContext({ account: { netLiquidation: '19000' } })) // 5% down
    expect(result).toBeNull()
  })

  it('blocks placeOrder beyond the drawdown threshold, with a percentage in the message', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 10 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed HWM

    const result = await guard.check(makeContext({ account: { netLiquidation: '17000' } })) // 15% down
    expect(result).not.toBeNull()
    expect(result).toContain('15.0%')
    expect(result).toContain('10%')
  })

  it('ratchets the HWM up on a new high', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 10 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed HWM
    await guard.check(makeContext({ account: { netLiquidation: '25000' } })) // new high

    const raw = await readFile(join(tmpDir, 'hwm.json'), 'utf-8')
    const state = JSON.parse(raw)
    expect(new Decimal(state.hwm).toString()).toBe('25000')

    // Now 25000 is the HWM — a drop to 23000 is only 8% down, should still allow
    const result = await guard.check(makeContext({ account: { netLiquidation: '23000' } }))
    expect(result).toBeNull()
  })

  it('always allows closePosition, even while blocked', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 10 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed HWM
    await guard.check(makeContext({ account: { netLiquidation: '17000' } })) // trigger drawdown state

    const closeOp: Operation = { action: 'closePosition', contract: makeContract({ symbol: 'AAPL' }) }
    const result = await guard.check(makeContext({ operation: closeOp, account: { netLiquidation: '17000' } }))
    expect(result).toBeNull()
  })

  it('allows a risk-REDUCING sell (exit against an existing long) while blocked', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 10 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed HWM

    const positions = [makePosition({ contract: makeContract({ symbol: 'AAPL' }), side: 'long', quantity: new Decimal(10) })]
    const result = await guard.check(makeContext({
      operation: makeSellOrderOp('AAPL', 5),
      positions,
      account: { netLiquidation: '17000' }, // 15% down — guard is tripped
    }))
    expect(result).toBeNull()
  })

  it('still blocks a sell LARGER than the position (it flips into new short risk)', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 10 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed HWM

    const positions = [makePosition({ contract: makeContract({ symbol: 'AAPL' }), side: 'long', quantity: new Decimal(10) })]
    const result = await guard.check(makeContext({
      operation: makeSellOrderOp('AAPL', 20),
      positions,
      account: { netLiquidation: '17000' },
    }))
    expect(result).not.toBeNull()
  })

  it('a non-numeric maxDrawdownPct falls back to the default and the guard STAYS ACTIVE', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 'ten' })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed HWM

    const result = await guard.check(makeContext({ account: { netLiquidation: '17000' } })) // 15% down
    expect(result).not.toBeNull() // default 10% limit enforced, not silently disabled
    expect(result).toContain('10%')
  })

  it('self-heals from a corrupt state file by reseeding', async () => {
    const guard = new MaxDrawdownGuard({ baseDir: tmpDir, maxDrawdownPct: 10 })
    await writeFile(join(tmpDir, 'hwm.json'), 'not valid json{{{', 'utf-8')

    const result = await guard.check(makeContext({ account: { netLiquidation: '20000' } }))
    expect(result).toBeNull()

    const raw = await readFile(join(tmpDir, 'hwm.json'), 'utf-8')
    const state = JSON.parse(raw)
    expect(new Decimal(state.hwm).toString()).toBe('20000')
  })
})
