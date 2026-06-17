export const CONTROLLED_EDITING_DISABLED_CODE = 'CONTROLLED_EDITING_DISABLED' as const;

export const STORY_PROJECT_NOT_INITIALIZED_MESSAGE =
  '项目尚未启用受控事件编辑，不能修改事件内容';

export type DesktopErrorCode = typeof CONTROLLED_EDITING_DISABLED_CODE;