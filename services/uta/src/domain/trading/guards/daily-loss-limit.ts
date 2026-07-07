import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import Decimal from 'decimal.js'
import { dataPath } from '@/core/paths.js'
import type { OperationGuard, GuardContext } from './types.js'
import { isRiskReducingOrder } from './reduce-only.js'
import { positiveNumberOption } from './options.js'

const DEFAULT_MAX_DAILY_LOSS_PCT = 3

interface DayAnchorState {
  date: string
  /** Equity the day is measured FROM (yesterday's last-known equity on rollover). */
  equity: string
  /** Most recently observed equity — becomes the next day's anchor, so an
   *  overnight gap between yesterday's last check and today's first check
   *  still counts as today's loss. Absent in pre-existing state files. */
  lastEquity?: string
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export class DailyLossLimitGuard implements OperationGuard {
  readonly name = 'daily-loss-limit'
  private maxDailyLossPct: number
  private baseDir?: string

  constructor(options: Record<string, unknown>) {
    this.maxDailyLossPct = positiveNumberOption(options, 'maxDailyLossPct', DEFAULT_MAX_DAILY_LOSS_PCT, this.name)
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

    if (!state) {
      // First run ever — no history to anchor to; today starts here.
      await this.writeState(ctx.accountId, { date: today, equity: current.toString(), lastEquity: current.toString() })
      return null
    }

    // Anchor for today: on rollover, yesterday's LAST-KNOWN equity (so an
    // overnight gap down is charged to today, and the first order of a bad
    // day does not get a free pass); otherwise the stored anchor.
    let anchor: Decimal
    if (state.date !== today) {
      anchor = new Decimal(state.lastEquity ?? current.toString())
      await this.writeState(ctx.accountId, { date: today, equity: anchor.toString(), lastEquity: current.toString() })
    } else {
      anchor = new Decimal(state.equity)
      if (state.lastEquity !== current.toString()) {
        await this.writeState(ctx.accountId, { ...state, lastEquity: current.toString() })
      }
    }

    if (anchor.isZero()) return null

    const lossPct = anchor.minus(current).div(anchor).mul(100)

    if (lossPct.gt(this.maxDailyLossPct)) {
      // Risk-REDUCING orders (an exit against an existing position, no larger
      // than it) always pass — the guard blocks new risk, never the way out.
      if (isRiskReducingOrder(ctx)) return null
      return `Account is down ${lossPct.toFixed(1)}% today vs a ${this.maxDailyLossPct}% daily loss limit. New entries are blocked until the anchor resets tomorrow (UTC) — this protects you from revenge-trading a bad day. Closing or reducing existing positions is always allowed.`
    }

    return null
  }
}
