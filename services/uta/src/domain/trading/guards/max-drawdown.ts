import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import Decimal from 'decimal.js'
import { dataPath } from '@/core/paths.js'
import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_DRAWDOWN_PCT = 10

interface HwmState {
  hwm: string
  updatedAt: string
}

export class MaxDrawdownGuard implements OperationGuard {
  readonly name = 'max-drawdown'
  private maxDrawdownPct: number
  private baseDir?: string

  constructor(options: Record<string, unknown>) {
    this.maxDrawdownPct = Number(options.maxDrawdownPct ?? DEFAULT_MAX_DRAWDOWN_PCT)
    this.baseDir = options.baseDir as string | undefined
  }

  private statePath(accountId: string): string {
    return this.baseDir
      ? resolve(this.baseDir, 'hwm.json')
      : dataPath('trading', accountId, 'hwm.json')
  }

  private async readState(accountId: string): Promise<HwmState | null> {
    try {
      const raw = await readFile(this.statePath(accountId), 'utf-8')
      const parsed = JSON.parse(raw) as HwmState
      if (typeof parsed.hwm !== 'string') return null
      return parsed
    } catch {
      return null
    }
  }

  private async writeState(accountId: string, state: HwmState): Promise<void> {
    const filePath = this.statePath(accountId)
    await mkdir(resolve(filePath, '..'), { recursive: true })
    const tmp = `${filePath}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
    await rename(tmp, filePath)
  }

  async check(ctx: GuardContext): Promise<string | null> {
    if (ctx.operation.action !== 'placeOrder') return null

    const current = new Decimal(ctx.account.netLiquidation)
    const state = await this.readState(ctx.accountId)

    if (!state) {
      await this.writeState(ctx.accountId, { hwm: current.toString(), updatedAt: new Date().toISOString() })
      return null
    }

    const hwm = new Decimal(state.hwm)

    if (current.gt(hwm)) {
      await this.writeState(ctx.accountId, { hwm: current.toString(), updatedAt: new Date().toISOString() })
      return null
    }

    if (hwm.isZero()) return null

    const drawdownPct = hwm.minus(current).div(hwm).mul(100)

    if (drawdownPct.gt(this.maxDrawdownPct)) {
      return `Account is down ${drawdownPct.toFixed(1)}% from its high-water mark of $${hwm.toFixed(2)} (limit ${this.maxDrawdownPct}%). New entries are blocked until equity recovers — this protects you from digging deeper while in a hole. Closing positions is always allowed.`
    }

    return null
  }
}
