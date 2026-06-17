/** IPC / 响应式对象 → 可编辑草稿（避免 structuredClone 在 Proxy 上失败）。 */
export function cloneDraft<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
