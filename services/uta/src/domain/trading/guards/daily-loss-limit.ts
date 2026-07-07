import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import Decimal from 'decimal.js'
import { dataPath } from '@/core/paths.js'
import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_DAILY_LOSS_PCT = 3

interface DayAnchorState {
  date: string
  equity: string
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export class DailyLossLimitGuard implements OperationGuard {
  readonly name = 'daily-loss-limit'
  private maxDailyLossPct: number
  private baseDir?: string

  constructor(options: Record<string, unknown>) {
    this.maxDailyLossPct = Number(options.maxDailyLossPct ?? DEFAULT_MAX_DAILY_LOSS_PCT)
    this.baseDir = options.baseDir as string | undefined
  }

  private statePath(accountId: string): string {
    return this.baseDir
      ? resolve(this.baseDir, 'day-anchor.json')
      : dataPath('trading', accountId, 'day-anchor.json')
  }

  private async readState(accountId: string): Promise<DayAnchorState | null> {
    try {
      const raw = await readFile(this.statePath(accountId), 'utf-8')
      const parsed = JSON.parse(raw) as DayAnchorState
      if (typeof parsed.date !== 'string' || typeof parsed.equity !== 'string') return null
      return parsed
    } catch {
      return null
    }
  }

  private async writeState(accountId: string, state: DayAnchorState): Promise<void> {
    const filePath = this.statePath(accountId)
    await mkdir(resolve(filePath, '..'), { recursive: true })
    const tmp = `${filePath}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
    await rename(tmp, filePath)
  }

  async check(ctx: GuardContext): Promise<string | null> {
    if (ctx.operation.action !== 'placeOrder') return null

    const current = new Decimal(ctx.account.netLiquidation)
    const today = todayUtc()
    const state = await this.readState(ctx.accountId)

    if (!state || state.date !== today) {
      await this.writeState(ctx.accountId, { date: today, equity: current.toString() })
      return null
    }

    const anchor = new Decimal(state.equity)
    if (anchor.isZero()) return null

    const lossPct = anchor.minus(current).div(anchor).mul(100)

    if (lossPct.gt(this.maxDailyLossPct)) {
      return `Account is down ${lossPct.toFixed(1)}% today vs a ${this.maxDailyLossPct}% daily loss limit. New entries are blocked until the anchor resets tomorrow (UTC) — this protects you from revenge-trading a bad day. Closing positions is always allowed.`
    }

    return null
  }
}
