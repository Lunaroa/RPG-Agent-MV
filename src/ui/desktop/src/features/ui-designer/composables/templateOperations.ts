import type { Ref } from 'vue'
import type {
  UiDesignerDocument,
  UiDesignerPersistenceAdapter,
  UiNodeGroup,
  UiPoint,
} from '@contract/ui-designer'
import { createNodeGroup, insertNodeGroup, validateNodeGroup } from '../models/nodeGroups'

type ValueRef<T> = Pick<Ref<T>, 'value'>

export interface UiDesignerTemplateOperationContext {
  getFile: () => UiDesignerPersistenceAdapter
  canSave: ValueRef<boolean>
  document: ValueRef<UiDesignerDocument>
  selectedIds: ValueRef<string[]>
  nodeTemplates: ValueRef<UiNodeGroup[]>
  getDefaultParentId: () => string | null
  replaceDocument: (document: UiDesignerDocument, description: string) => void
  setSelectedIds: (ids: string[]) => void
  setActionError: (message: string) => void
  flushDrafts: () => void
}

/** NodeGroup .mztemplate operations. Scene factories intentionally stay in the controller. */
export function createUiDesignerTemplateOperations(context: UiDesignerTemplateOperationContext) {
  const fail = (message: string) => {
    context.setActionError(message)
    return false
  }

  const saveNodeTemplate = async (name: string) => {
    if (!context.canSave.value) return false
    try {
      context.flushDrafts()
      const group = createNodeGroup(context.document.value, context.selectedIds.value, name)
      const result = await context.getFile().writeNodeTemplate(group.name, group)
      if (result.status !== 'success') return fail(result.message)
      context.nodeTemplates.value = [
        ...context.nodeTemplates.value.filter((item) => item.name !== group.name),
        group,
      ]
      return true
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  const insertNodeTemplate = async (name: string, parentId?: string | null, point?: UiPoint) => {
    let group = context.nodeTemplates.value.find((item) => item.name === name)
    if (!group && context.canSave.value) {
      try {
        const result = await context.getFile().readNodeTemplate(name)
        if (result.status === 'success' && result.value && validateNodeGroup(result.value)) {
          group = result.value
          context.nodeTemplates.value = [...context.nodeTemplates.value, group]
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    }
    if (!group) return false
    try {
      context.flushDrafts()
      const destination = parentId === undefined ? context.getDefaultParentId() : parentId
      const result = insertNodeGroup(context.document.value, group, destination, point)
      context.replaceDocument(result.document, 'Insert node template')
      context.setSelectedIds(result.ids)
      return true
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  const removeNodeTemplate = async (name: string) => {
    if (name.startsWith('builtin:') || !context.canSave.value) return false
    try {
      const result = await context.getFile().removeNodeTemplate(name)
      if (result.status !== 'success') return fail(result.message)
      context.nodeTemplates.value = context.nodeTemplates.value.filter((item) => item.name !== name)
      return true
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  const importNodeTemplate = async () => {
    if (!context.canSave.value) return false
    try {
      const result = await context.getFile().importNodeTemplate()
      if (!result || result.status !== 'success' || !result.value || !validateNodeGroup(result.value)) {
        return fail(result?.message ?? 'Invalid node template')
      }
      context.nodeTemplates.value = [
        ...context.nodeTemplates.value.filter((item) => item.name !== result.value!.name),
        result.value,
      ]
      return true
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  const exportNodeTemplate = async (name: string, path?: string) => {
    if (!context.canSave.value) return false
    const group = context.nodeTemplates.value.find((item) => item.name === name)
    if (!group) return false
    try {
      const result = await context.getFile().exportNodeTemplate(group, path ? { path } : undefined)
      if (result.status !== 'success') return fail(result.message)
      return true
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  return { saveNodeTemplate, insertNodeTemplate, removeNodeTemplate, importNodeTemplate, exportNodeTemplate }
}
