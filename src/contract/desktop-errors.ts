export const CONTROLLED_EDITING_DISABLED_CODE = 'CONTROLLED_EDITING_DISABLED' as const;

export const STORY_PROJECT_NOT_INITIALIZED_MESSAGE =
  'Story project is not initialized; controlled event editing is unavailable';

export type DesktopErrorCode = typeof CONTROLLED_EDITING_DISABLED_CODE;