export type UiControlCommandType = 'capture-current' | 'navigate' | 'open-event-editor' | 'state';

export interface UiControlCommand {
  type: UiControlCommandType;
  target?: string;
  mapId?: number;
  eventId?: number;
  label?: string;
  capture?: boolean;
  waitMs?: number;
  timeoutMs?: number;
}

export interface UiControlEnvelope {
  id?: string;
  command?: UiControlCommand;
}

export interface EditorUiControlState {
  mounted: boolean;
  mapId: number | null;
  eventId: number | null;
  eventDialogOpen: boolean;
  mode: string;
  statusText: string;
  statusKind: string;
}

export interface EditorUiControlHandler {
  openEventEditor(mapId: number, eventId: number): Promise<EditorUiControlState>;
  getState(): EditorUiControlState;
}

let editorHandler: EditorUiControlHandler | null = null;

export function registerEditorUiControlHandler(handler: EditorUiControlHandler): () => void {
  editorHandler = handler;
  return () => {
    if (editorHandler === handler) editorHandler = null;
  };
}

export async function openEditorEventFromUiControl(mapId: number, eventId: number): Promise<EditorUiControlState> {
  if (!editorHandler) throw new Error('编辑器尚未就绪，无法打开事件编辑界面。');
  return editorHandler.openEventEditor(mapId, eventId);
}

export function getEditorUiControlState(): EditorUiControlState {
  return editorHandler?.getState() || {
    mounted: false,
    mapId: null,
    eventId: null,
    eventDialogOpen: false,
    mode: '',
    statusText: '',
    statusKind: '',
  };
}

