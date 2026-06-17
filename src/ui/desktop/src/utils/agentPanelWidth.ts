export const AGENT_PANEL_DEFAULT_WIDTH = 480
export const AGENT_PANEL_MIN_WIDTH = 300
export const AGENT_PANEL_MAX_WIDTH = 600
// 聊天浮层向左溢出时为 LeftDock（图块面板 + 地图树，固定 214）+ gap 预留的不可遮挡宽度。
export const LEFT_DOCK_RESERVE = 224
export const AGENT_PANEL_WIDTH_STORAGE_KEY = 'rmmv.workbench.agent-panel-width'

// 浮层硬上限：聊天面板始终浮在编辑器之上，最远盖到 LeftDock 右缘（图块面板/地图树那列保持露出）。
export function overlayMaxAgentPanelWidth(availableWidth: number): number {
  return Math.max(
    AGENT_PANEL_MIN_WIDTH,
    Math.floor(availableWidth) - LEFT_DOCK_RESERVE,
  )
}

export function maxAgentPanelWidth(availableWidth: number): number {
  return overlayMaxAgentPanelWidth(availableWidth)
}

export function clampAgentPanelWidth(width: number, availableWidth: number): number {
  return Math.min(
    maxAgentPanelWidth(availableWidth),
    Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)),
  )
}

export function parseAgentPanelWidth(saved: string | null, availableWidth: number): number {
  const width = Number(saved)
  return Number.isFinite(width) && width > 0
    ? clampAgentPanelWidth(width, availableWidth)
    : clampAgentPanelWidth(AGENT_PANEL_DEFAULT_WIDTH, availableWidth)
}
