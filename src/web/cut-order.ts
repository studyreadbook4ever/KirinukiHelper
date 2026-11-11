export interface CutMovePlan<T> {
  readonly order: readonly T[];
  readonly item: T;
  readonly fromIndex: number;
  readonly toIndex: number;
}

/** Record exactly which neighboring positions the confirmation will change. */
export function planCutMove<T>(
  order: readonly T[], item: T, direction: -1 | 1
): CutMovePlan<T> | null {
  const fromIndex = order.indexOf(item);
  const toIndex = fromIndex + direction;
  if ((direction !== -1 && direction !== 1) || fromIndex < 0
    || toIndex < 0 || toIndex >= order.length
    || new Set(order).size !== order.length) return null;
  return { order: [...order], item, fromIndex, toIndex };
}

/** A confirmation belongs to one exact order and never mutates its items. */
export function confirmedCutOrder<T>(
  plan: CutMovePlan<T>, currentOrder: readonly T[], confirmed: boolean
): T[] | null {
  if (!confirmed || currentOrder.length !== plan.order.length
    || currentOrder.some((item, index) => item !== plan.order[index])) return null;
  const next = [...currentOrder];
  next.splice(plan.fromIndex, 1);
  next.splice(plan.toIndex, 0, plan.item);
  return next;
}
