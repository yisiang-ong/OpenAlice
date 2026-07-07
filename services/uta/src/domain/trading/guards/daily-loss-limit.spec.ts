import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { DailyLossLimitGuard } from './daily-loss-limit.js'
import type { GuardContext } from './types.js'
import type { Operation } from '../git/types.js'
import type { AccountInfo, Position } from '../brokers/types.js'
import { makeContract } from '../brokers/mock/index.js'
import '../contract-ext.js'

function makePlaceOrderOp(): Operation {
  return { action: 'placeOrder', contract: makeContract({ symbol: 'AAPL' }), order: {} as never }
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

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

describe('DailyLossLimitGuard', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'oa-daily-loss-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('seeds the anchor on first run and allows', async () => {
    const guard = new DailyLossLimitGuard({ baseDir: tmpDir })
    const result = await guard.check(makeContext({ account: { netLiquidation: '20000' } }))
    expect(result).toBeNull()

    const raw = await readFile(join(tmpDir, 'day-anchor.json'), 'utf-8')
    const state = JSON.parse(raw)
    expect(state.date).toBe(todayUtc())
    expect(new Decimal(state.equity).toString()).toBe('20000')
  })

  it('allows within the daily loss limit', async () => {
    const guard = new DailyLossLimitGuard({ baseDir: tmpDir, maxDailyLossPct: 3 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed anchor

    const result = await guard.check(makeContext({ account: { netLiquidation: '19800' } })) // 1% down
    expect(result).toBeNull()
  })

  it('blocks placeOrder beyond the daily loss limit, with a percentage in the message', async () => {
    const guard = new DailyLossLimitGuard({ baseDir: tmpDir, maxDailyLossPct: 3 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed anchor

    const result = await guard.check(makeContext({ account: { netLiquidation: '19000' } })) // 5% down
    expect(result).not.toBeNull()
    expect(result).toContain('5.0%')
    expect(result).toContain('3%')
  })

  it('resets the anchor on day rollover', async () => {
    const guard = new DailyLossLimitGuard({ baseDir: tmpDir, maxDailyLossPct: 3 })
    // Write a stale anchor from "yesterday" with equity far above current, which
    // would otherwise trigger a block if it weren't rolled over.
    await writeFile(join(tmpDir, 'day-anchor.json'), JSON.stringify({ date: '2000-01-01', equity: '50000' }), 'utf-8')

    const result = await guard.check(makeContext({ account: { netLiquidation: '20000' } }))
    expect(result).toBeNull()

    const raw = await readFile(join(tmpDir, 'day-anchor.json'), 'utf-8')
    const state = JSON.parse(raw)
    expect(state.date).toBe(todayUtc())
    expect(new Decimal(state.equity).toString()).toBe('20000')
  })

  it('always allows closePosition, even while blocked', async () => {
    const guard = new DailyLossLimitGuard({ baseDir: tmpDir, maxDailyLossPct: 3 })
    await guard.check(makeContext({ account: { netLiquidation: '20000' } })) // seed anchor
    await guard.check(makeContext({ account: { netLiquidation: '19000' } })) // trigger blocked state

    const closeOp: Operation = { action: 'closePosition', contract: makeContract({ symbol: 'AAPL' }) }
    const result = await guard.check(makeContext({ operation: closeOp, account: { netLiquidation: '19000' } }))
    expect(result).toBeNull()
  })

  it('self-heals from a corrupt state file by reseeding', async () => {
    const guard = new DailyLossLimitGuard({ baseDir: tmpDir, maxDailyLossPct: 3 })
    await writeFile(join(tmpDir, 'day-anchor.json'), 'not valid json{{{', 'utf-8')

    const result = await guard.check(makeContext({ account: { netLiquidation: '20000' } }))
    expect(result).toBeNull()

    const raw = await readFile(join(tmpDir, 'day-anchor.json'), 'utf-8')
    const state = JSON.parse(raw)
    expect(state.date).toBe(todayUtc())
    expect(new Decimal(state.equity).toString()).toBe('20000')
  })
})
