interface CommonEventSlot {
  id?: number;
  name?: string;
  trigger?: number;
  list?: unknown[];
  [key: string]: unknown;
}

export function isEmptyCommonEventSlot(slot: unknown, id: number): boolean {
  if (!slot) return true;
  if (typeof slot !== "object") return false;
  const s = slot as CommonEventSlot;
  if (s.id !== undefined && s.id !== id) return false;
  const trigger: number = s.trigger || 0;
  const list: unknown[] = s.list === undefined || s.list === null ? [] : s.list;
  return !s.name && trigger === 0 && isNoopCommandList(list);
}

interface NoopCommand {
  code: number;
  [key: string]: unknown;
}

export function isNoopCommandList(list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  if (list.length === 0) return true;
  return list.length === 1 && list[0] && (list[0] as NoopCommand).code === 0;
}
