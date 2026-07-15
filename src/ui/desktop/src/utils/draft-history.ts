interface DraftHistoryEntry<T> {
  before: T;
  after: T;
  mergeKey: string | null;
}

export interface DraftHistory<T> {
  readonly undoCount: number;
  readonly redoCount: number;
  readonly dirty: boolean;
  current(): T;
  reset(value: T): T;
  record(value: T, mergeKey?: string | null): T;
  undo(): T | null;
  redo(): T | null;
}

export function createDraftHistory<T>(initialValue: T, limit = 100): DraftHistory<T> {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('Draft history limit must be a positive integer.');

  let value = cloneSnapshot(initialValue);
  let savedBaseline = cloneSnapshot(initialValue);
  let undoStack: DraftHistoryEntry<T>[] = [];
  let redoStack: DraftHistoryEntry<T>[] = [];

  return {
    get undoCount() {
      return undoStack.length;
    },
    get redoCount() {
      return redoStack.length;
    },
    get dirty() {
      return !snapshotEquals(value, savedBaseline);
    },
    current() {
      return cloneSnapshot(value);
    },
    reset(nextValue) {
      value = cloneSnapshot(nextValue);
      savedBaseline = cloneSnapshot(nextValue);
      undoStack = [];
      redoStack = [];
      return cloneSnapshot(value);
    },
    record(nextValue, mergeKey = null) {
      const next = cloneSnapshot(nextValue);
      if (snapshotEquals(value, next)) return cloneSnapshot(value);

      const normalizedMergeKey = typeof mergeKey === 'string' && mergeKey.trim() ? mergeKey : null;
      const latest = undoStack[undoStack.length - 1];
      if (normalizedMergeKey && latest?.mergeKey === normalizedMergeKey) {
        latest.after = cloneSnapshot(next);
        if (snapshotEquals(latest.before, latest.after)) undoStack.pop();
      } else {
        undoStack.push({
          before: cloneSnapshot(value),
          after: cloneSnapshot(next),
          mergeKey: normalizedMergeKey,
        });
        if (undoStack.length > limit) undoStack.shift();
      }
      value = next;
      redoStack = [];
      return cloneSnapshot(value);
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      redoStack.push(entry);
      value = cloneSnapshot(entry.before);
      return cloneSnapshot(value);
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return null;
      undoStack.push(entry);
      value = cloneSnapshot(entry.after);
      return cloneSnapshot(value);
    },
  };
}

function cloneSnapshot<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotEquals<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => snapshotEquals(entry, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => (
    key === rightKeys[index] && snapshotEquals(leftRecord[key], rightRecord[key])
  ));
}
