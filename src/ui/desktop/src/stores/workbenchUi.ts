import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type ConsolePage = 'home' | 'assets' | 'story' | 'plugins' | 'logs' | 'settings';

/** 聊天面板菜单按钮打开的右侧侧边栏类型；null = 不显示侧边栏。 */
export type SidePanelKind = 'task' | 'plan' | 'placement' | 'subagent' | null;

export const useWorkbenchUiStore = defineStore('workbenchUi', () => {
  const appRailOpen = ref(true);
  const agentPanelOpen = ref(true);
  // 聊天浮层的实时宽度（由 AgentPanel 同步），编辑器据此把地图区右移让出可见空间。
  const agentPanelWidth = ref(480);
  const sidePanel = ref<SidePanelKind>(null);
  const bottomPanelOpen = ref(false);
  const leftDockTilesOpen = ref(true);
  const leftDockPaletteHeight = ref(214);
  const editorZoom = ref(1);
  const editorZoomIn = ref<(() => void) | null>(null);
  const editorZoomOut = ref<(() => void) | null>(null);
  const editorZoomReset = ref<(() => void) | null>(null);

  /* Status bar data (synced from EditorView) */
  const sbMapLabel = ref('');
  const sbMode = ref<'map' | 'event' | ''>('');
  const sbCursor = ref('');
  const sbZoom = ref(100);
  const sbStagingDirty = ref(false);
  const sbPlacementActive = ref(false);
  const sbPlacementHint = ref('');
  const sbStatusText = ref('');
  const sbStatusKind = ref('');

  const zoomPercent = computed(() => Math.round(editorZoom.value * 100));

  function toggleAppRail() {
    appRailOpen.value = !appRailOpen.value;
  }

  function toggleAgentPanel() {
    agentPanelOpen.value = !agentPanelOpen.value;
  }

  function setAgentPanelOpen(open: boolean) {
    agentPanelOpen.value = open;
  }

  function setAgentPanelWidth(width: number) {
    agentPanelWidth.value = Math.max(0, Math.round(width));
  }

  function openSidePanel(kind: Exclude<SidePanelKind, null>) {
    sidePanel.value = kind;
  }

  function closeSidePanel() {
    sidePanel.value = null;
  }

  function toggleSidePanel(kind: Exclude<SidePanelKind, null>) {
    sidePanel.value = sidePanel.value === kind ? null : kind;
  }

  function toggleBottomPanel() {
    bottomPanelOpen.value = !bottomPanelOpen.value;
  }

  function setBottomPanelOpen(open: boolean) {
    bottomPanelOpen.value = open;
  }

  function setLeftDockTilesOpen(open: boolean) {
    leftDockTilesOpen.value = open;
  }

  function setLeftDockPaletteHeight(height: number) {
    leftDockPaletteHeight.value = Math.max(110, Math.min(520, Math.round(height)));
  }

  function setEditorZoom(value: number) {
    editorZoom.value = value;
  }

  function bindEditorZoomControls(controls: {
    zoomIn: () => void;
    zoomOut: () => void;
    resetZoom: () => void;
  }) {
    editorZoomIn.value = controls.zoomIn;
    editorZoomOut.value = controls.zoomOut;
    editorZoomReset.value = controls.resetZoom;
  }

  function clearEditorZoomControls(controls?: {
    zoomIn: () => void;
    zoomOut: () => void;
    resetZoom: () => void;
  }) {
    if (!controls || editorZoomIn.value === controls.zoomIn) editorZoomIn.value = null;
    if (!controls || editorZoomOut.value === controls.zoomOut) editorZoomOut.value = null;
    if (!controls || editorZoomReset.value === controls.resetZoom) editorZoomReset.value = null;
  }

  function requestZoomIn() {
    editorZoomIn.value?.();
  }

  function requestZoomOut() {
    editorZoomOut.value?.();
  }

  function requestZoomReset() {
    editorZoomReset.value?.();
  }

  function clearStatusBar() {
    sbMapLabel.value = '';
    sbMode.value = '';
    sbCursor.value = '';
    sbZoom.value = 100;
    sbStagingDirty.value = false;
    sbPlacementActive.value = false;
    sbPlacementHint.value = '';
    sbStatusText.value = '';
    sbStatusKind.value = '';
  }

  return {
    appRailOpen,
    agentPanelOpen,
    agentPanelWidth,
    setAgentPanelWidth,
    sidePanel,
    openSidePanel,
    closeSidePanel,
    toggleSidePanel,
    bottomPanelOpen,
    leftDockTilesOpen,
    leftDockPaletteHeight,
    editorZoom,
    zoomPercent,
    toggleAppRail,
    toggleAgentPanel,
    setAgentPanelOpen,
    toggleBottomPanel,
    setBottomPanelOpen,
    setLeftDockTilesOpen,
    setLeftDockPaletteHeight,
    setEditorZoom,
    bindEditorZoomControls,
    clearEditorZoomControls,
    requestZoomIn,
    requestZoomOut,
    requestZoomReset,
    sbMapLabel,
    sbMode,
    sbCursor,
    sbZoom,
    sbStagingDirty,
    sbPlacementActive,
    sbPlacementHint,
    sbStatusText,
    sbStatusKind,
    clearStatusBar,
  };
});
