import { ref } from 'vue'

export type UiEditorPreviewResolution = '816x624' | '1280x720' | '1920x1080'
export type UiEditorPreviewConditionMode = 'all-on' | 'all-off'

/** View-only editor preview controls; these values never enter the document/history. */
export function createUiDesignerEditorPreviewState() {
  const resolution = ref<UiEditorPreviewResolution>('816x624')
  const conditionMode = ref<UiEditorPreviewConditionMode>('all-on')
  const setResolution = (value: UiEditorPreviewResolution) => { resolution.value = value }
  const setConditionMode = (value: UiEditorPreviewConditionMode) => { conditionMode.value = value }
  return { resolution, conditionMode, setResolution, setConditionMode }
}
