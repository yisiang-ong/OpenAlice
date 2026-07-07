import { UNSET_DECIMAL } from '@traderalice/ibkr'
import type { GuardContext } from './types.js'

/** The contract fields that establish instrument identity for guard purposes. */
interface ContractIdentity {
  symbol?: string
  secType?: string
  currency?: string
  aliceId?: string
}

/**
 * Same INSTRUMENT, not just the same ticker. A tripped guard must not let a
 * SELL of AAPL calls (secType OPT, 100× multiplier — brand-new risk) pass as
 * a "reduction" of an AAPL stock position. aliceId is the canonical identity
 * when both sides carry one; otherwise symbol AND secType (and currency,
 * when both known) must all match. Ambiguity fails CLOSED — an order we
 * can't prove is the same instrument is treated as new risk and blocked,
 * which is exactly the pre-reduce-only behavior.
 */
function sameInstrument(a: ContractIdentity, b: ContractIdentity): boolean {
  if (a.aliceId && b.aliceId) return a.aliceId === b.aliceId
  if (!a.symbol || a.symbol !== b.symbol) return false
  if ((a.secType || null) !== (b.secType || null)) return false
  if (a.currency && b.currency && a.currency !== b.currency) return false
  return true
}

/**
 * Is this placeOrder purely risk-REDUCING — an order against an existing
 * position in the SAME instrument, in the opposite direction, no larger than
 * the position itself?
 *
 * Account-state guards (max-drawdown, daily-loss-limit) exist to stop NEW
 * risk while the account is in a hole; a limit-sell that exits a long (or a
 * buy that covers a short) removes risk and must never be trapped behind
 * them — "you can always get out" has to hold for staged limit exits, not
 * just the closePosition action.
 *
 * Deliberately strict on the ambiguous cases: no matching position, same
 * direction as the position, or a quantity that exceeds it (which would flip
 * into a NEW position on the other side) all return false. An order with an
 * unset quantity (cash-quantity orders) is treated as NOT reduce-only —
 * we can't prove it doesn't flip, so it counts as new risk.
 */
export function isRiskReducingOrder(ctx: GuardContext): boolean {
  const op = ctx.operation
  if (op.action !== 'placeOrder') return false

  const existing = ctx.positions.find((p) => sameInstrument(p.contract, op.contract))
  if (!existing) return false

  const orderAction = op.order.action?.toUpperCase()
  const opposes =
    (existing.side === 'long' && orderAction === 'SELL') ||
    (existing.side === 'short' && orderAction === 'BUY')
  if (!opposes) return false

  const qty = op.order.totalQuantity
  if (qty == null || qty.equals(UNSET_DECIMAL)) return false
  return qty.lte(existing.quantity.abs())
}
