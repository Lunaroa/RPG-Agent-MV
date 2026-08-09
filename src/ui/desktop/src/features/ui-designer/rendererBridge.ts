import type { UiRuntimeSceneExport } from '@contract/ui-designer'
import { UI_DESIGNER_RENDERER_BRIDGE_MAX_BYTES, UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES, type UiDesignerRendererJsonValue, type UiDesignerRendererNodePatch } from '@contract/ui-designer-renderer-bridge'

export type UiDesignerRendererUpdate =
  | { kind: 'mount'; revision: number; scene: UiRuntimeSceneExport }
  | { kind: 'patch'; revision: number; nodes: UiDesignerRendererNodePatch[] }

export const UI_DESIGNER_RENDERER_HANDSHAKE_TIMEOUT_MS = 10_000
export const UI_DESIGNER_RENDERER_DISPOSE_ACK_TIMEOUT_MS = 1_000

export interface UiDesignerRendererDisposeAck {
  promise: Promise<void>
  acknowledge(): void
}

export function createUiDesignerRendererDisposeAck(
  schedule: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
): UiDesignerRendererDisposeAck {
  let settled = false
  let resolvePromise: () => void = () => undefined
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve })
  const acknowledge = () => {
    if (settled) return
    settled = true
    cancel(timer)
    resolvePromise()
  }
  const timer = schedule(acknowledge, UI_DESIGNER_RENDERER_DISPOSE_ACK_TIMEOUT_MS)
  return { promise, acknowledge }
}

export function scheduleUiDesignerRendererHandshakeTimeout(
  onTimeout: () => void,
  schedule: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
): () => void {
  const timer = schedule(onTimeout, UI_DESIGNER_RENDERER_HANDSHAKE_TIMEOUT_MS)
  let active = true
  return () => {
    if (!active) return
    active = false
    cancel(timer)
  }
}

const REMOUNT_PROP_KEYS = new Set([
  'path', 'frames', 'imageStates', 'backgroundPath', 'imagePath', 'trackImage', 'fillImage', 'posterPath', 'fontFile',
  'fillMode', 'repeatMode', 'richText',
])

const encoded = (value: unknown) => JSON.stringify(value)

/**
 * Plans the only two renderer synchronization transactions.  Pure properties
 * that MZUIRuntime can apply in place use patch; topology, code, resources and
 * display-class changes remount the canonical Runtime scene.
 */
export function planUiDesignerRendererUpdate(
  previous: UiRuntimeSceneExport | null,
  next: UiRuntimeSceneExport,
  revision: number,
): UiDesignerRendererUpdate | null {
  if (!previous) return { kind: 'mount', revision, scene: next }
  const previousShell = { ...previous, nodes: undefined }
  const nextShell = { ...next, nodes: undefined }
  if (encoded(previousShell) !== encoded(nextShell) || previous.nodes.length !== next.nodes.length) {
    return { kind: 'mount', revision, scene: next }
  }
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]))
  const patches: UiDesignerRendererNodePatch[] = []
  let patchBytes = 2
  for (const node of next.nodes) {
    const before = previousById.get(node.id)
    if (!before) return { kind: 'mount', revision, scene: next }
    const beforeShape = { ...before, props: undefined }
    const nextShape = { ...node, props: undefined }
    if (encoded(beforeShape) !== encoded(nextShape)) return { kind: 'mount', revision, scene: next }
    if (encoded(before.props) === encoded(node.props)) continue
    const changedKeys = new Set([...Object.keys(before.props), ...Object.keys(node.props)].filter((key) => encoded((before.props as unknown as Record<string, unknown>)[key]) !== encoded((node.props as unknown as Record<string, unknown>)[key])))
    if ([...changedKeys].some((key) => REMOUNT_PROP_KEYS.has(key))) return { kind: 'mount', revision, scene: next }
    const patch = { nodeId: node.id, props: JSON.parse(encoded(node.props)) as Record<string, UiDesignerRendererJsonValue> }
    patches.push(patch)
    patchBytes += new TextEncoder().encode(encoded(patch)).byteLength + 1
    if (patches.length > UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES) return { kind: 'mount', revision, scene: next }
    if (patchBytes > UI_DESIGNER_RENDERER_BRIDGE_MAX_BYTES - 1_024) return { kind: 'mount', revision, scene: next }
  }
  return patches.length ? { kind: 'patch', revision, nodes: patches } : null
}
