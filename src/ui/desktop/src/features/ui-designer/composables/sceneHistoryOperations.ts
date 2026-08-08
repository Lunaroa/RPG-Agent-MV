export interface UiDesignerHistorySceneLike {
  id: string
}

type ValueRef<T> = { value: T }

export interface UiDesignerSceneHistoryOperationContext<TScene extends UiDesignerHistorySceneLike> {
  scenes: ValueRef<TScene[]>
  activeSceneId: ValueRef<string>
  isDirty: (scene: TScene) => boolean
  saveScene: (sceneId: string) => Promise<boolean>
}

/** Cross-tab save/discard orchestration; document mutation stays in the controller. */
export function createUiDesignerSceneHistoryOperations<TScene extends UiDesignerHistorySceneLike>(context: UiDesignerSceneHistoryOperationContext<TScene>) {
  const saveAllDirtyScenes = async () => {
    const previousActiveId = context.activeSceneId.value
    try {
      for (const scene of [...context.scenes.value]) {
        if (!context.isDirty(scene)) continue
        context.activeSceneId.value = scene.id
        if (!(await context.saveScene(scene.id))) return false
      }
      return true
    } finally {
      if (context.scenes.value.some((scene) => scene.id === previousActiveId)) context.activeSceneId.value = previousActiveId
    }
  }
  return { saveAllDirtyScenes }
}
