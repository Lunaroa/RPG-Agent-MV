/**
 * Normalize values for Electron IPC structured clone (renderer ↔ main).
 * Strips functions, class instances, cycles, and Vue proxies via JSON round-trip.
 */
export function toIpcPayload<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) => {
      if (entry instanceof Error) {
        return { name: entry.name, message: entry.message };
      }
      if (typeof entry === 'function' || typeof entry === 'symbol') {
        return undefined;
      }
      return entry;
    }),
  ) as T;
}
