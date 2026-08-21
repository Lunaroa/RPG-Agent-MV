<script setup lang="ts">
import { computed, isRef, ref, type Ref } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiEventAction, UiEventName, UiNode, UiValidationIssue, UiValidationReport } from '@contract/ui-designer'
import { UI_DESIGNER_BUILTIN_SCENE_NAMES } from '@contract/ui-designer'
import { UI_DESIGNER_NODE_SCRIPT_COMPLETIONS } from '@contract/ui-designer-script'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'
import UiNamedEntryField from './UiNamedEntryField.vue'
import UiScriptContextHint from './UiScriptContextHint.vue'
import UiResourceReferenceControl from './UiResourceReferenceControl.vue'
import { reorderEventActions } from '../models/actions'
import { uiDesignerSeNameFromResourcePath } from '../models/audioResource'

const props = defineProps<{
  designer: UiDesignerController
  node: UiNode
  pickAudioResource?: () => Promise<string | null>
  resourcePickerDisabled?: boolean
}>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const eventNames: UiEventName[] = ['onClick', 'onHoverEnter', 'onHoverLeave', 'onShow', 'onHide', 'onUpdate', 'onFocus', 'onBlur']
const activeEvent = ref<UiEventName>('onClick')
const liveNode = computed(() => designer.document.nodes.find((node) => node.id === props.node.id) ?? props.node)
const eventMap = computed(() => liveNode.value.events)
const actions = computed(() => eventMap.value[activeEvent.value]?.actions ?? [])
const draggingAction = ref<number>()
const resourceError = ref('')
const actionTypes: UiEventAction['type'][] = ['none', 'newGame', 'continue', 'options', 'exit', 'gotoScene', 'toggleNode', 'playSe', 'url', 'script', 'setVariable', 'setSwitch', 'showMessage', 'tweenProp', 'wait']
const eventLabels: Record<UiEventName, UiDesignerMessageKey> = { onClick: 'eventOnClick', onHoverEnter: 'eventOnHoverEnter', onHoverLeave: 'eventOnHoverLeave', onShow: 'eventOnShow', onHide: 'eventOnHide', onUpdate: 'eventOnUpdate', onFocus: 'eventOnFocus', onBlur: 'eventOnBlur' }
const actionLabels: Record<UiEventAction['type'], UiDesignerMessageKey> = { none: 'actionNone', newGame: 'actionNewGame', continue: 'actionContinue', options: 'actionOptions', exit: 'actionExit', gotoScene: 'actionGotoScene', toggleNode: 'actionToggleNode', playSe: 'actionPlaySe', url: 'actionUrl', script: 'actionScript', setVariable: 'actionSetVariable', setSwitch: 'actionSetSwitch', showMessage: 'actionShowMessage', tweenProp: 'actionTweenProp', wait: 'actionWait' }
const builtinScenePurpose: Record<string, UiDesignerMessageKey> = {
  Scene_Title: 'scenePurposeTitle', Scene_Map: 'scenePurposeMap', Scene_Menu: 'scenePurposeMenu', Scene_Item: 'scenePurposeItem',
  Scene_Skill: 'scenePurposeSkill', Scene_Equip: 'scenePurposeEquip', Scene_Status: 'scenePurposeStatus', Scene_Options: 'scenePurposeOptions',
  Scene_Load: 'scenePurposeLoad', Scene_Save: 'scenePurposeSave', Scene_Battle: 'scenePurposeBattle', Scene_Shop: 'scenePurposeShop',
  Scene_Name: 'scenePurposeName', Scene_Gameover: 'scenePurposeGameover', Scene_End: 'scenePurposeEnd', Scene_GameEnd: 'scenePurposeEnd',
  Scene_Debug: 'scenePurposeDebug',
}
const openedScenes = computed(() => designer.scenes.map((scene) => ({ value: scene.document.meta.sceneName, label: `${scene.document.meta.sceneName}${scene.sourcePath ? ` · ${scene.sourcePath.split(/[\\/]/).pop()}` : ''}` })))
const projectScenes = computed(() => {
  const openedValues = new Set(openedScenes.value.map((scene) => scene.value))
  return designer.sceneFiles
    .filter((file) => !openedValues.has(file.sceneName))
    .map((file) => ({ value: file.sceneName, label: `${file.sceneName} · ${file.path}` }))
})
const builtinScenes = computed(() => UI_DESIGNER_BUILTIN_SCENE_NAMES.map((name) => ({ value: name, label: `${name} · ${t(builtinScenePurpose[name])}` })))
const knownSceneTargets = computed(() => new Set([...openedScenes.value, ...projectScenes.value, ...builtinScenes.value].map((option) => option.value)))
const conditionLabels: Record<'switch' | 'variable' | 'code', UiDesignerMessageKey> = { switch: 'conditionSwitchOn', variable: 'conditionVariable', code: 'conditionCode' }
const easingLabels: Record<'Linear' | 'EaseIn' | 'EaseOut' | 'EaseInOut' | 'Bounce', UiDesignerMessageKey> = { Linear: 'easingLinear', EaseIn: 'easingEaseIn', EaseOut: 'easingEaseOut', EaseInOut: 'easingEaseInOut', Bounce: 'easingBounce' }
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const validation = computed<UiValidationReport>(() => unwrap(designer.validation))
const scriptCompletionItems = computed(() => [...UI_DESIGNER_NODE_SCRIPT_COMPLETIONS, ...designer.document.nodes.flatMap((node) => [node.id, node.name])])
const actionPath = (index: number) => `events.${activeEvent.value}.${index}`
const codeIssuesFor = (index: number, condition = false): UiValidationIssue[] => {
  const path = `${actionPath(index)}${condition ? '.condition' : ''}`
  return validation.value.issues.filter((issue) => issue.nodeId === props.node.id && issue.code === 'invalid-code' && issue.path === path)
}

const updateActions = (next: UiEventAction[]) => designer.setNodeEvents(props.node.id, { ...eventMap.value, [activeEvent.value]: { actions: next } })
const flushDraftContext = () => designer.flushDrafts(designer.activeSceneId)
const selectEvent = (eventName: UiEventName) => {
  if (eventName === activeEvent.value) return
  flushDraftContext()
  activeEvent.value = eventName
}
const addAction = () => { flushDraftContext(); updateActions([...actions.value, { type: 'none' } as UiEventAction]) }
const removeAction = (index: number) => { flushDraftContext(); updateActions(actions.value.filter((_, actionIndex) => actionIndex !== index)) }
const moveAction = (index: number, delta: -1 | 1) => {
  flushDraftContext()
  const target = index + delta
  if (target < 0 || target >= actions.value.length) return
  updateActions(reorderEventActions(actions.value, index, target))
}
const beginActionDrag = (index: number, event: DragEvent) => {
  draggingAction.value = index
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/ui-action-index', String(index)) }
}
const dropAction = (targetIndex: number, event: DragEvent) => {
  event.preventDefault()
  const sourceIndex = draggingAction.value ?? Number(event.dataTransfer?.getData('text/ui-action-index'))
  draggingAction.value = undefined
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= actions.value.length || sourceIndex === targetIndex) return
  flushDraftContext()
  updateActions(reorderEventActions(actions.value, sourceIndex, targetIndex))
}
const updateAction = (index: number, patch: Partial<UiEventAction>) => updateActions(actions.value.map((action, actionIndex) => actionIndex === index ? { ...action, ...patch } as UiEventAction : action))
const choosePlaySe = async (index: number) => {
  resourceError.value = ''
  const selected = await props.pickAudioResource?.()
  if (!selected) return
  try {
    updateAction(index, { seName: uiDesignerSeNameFromResourcePath(selected) })
  } catch {
    resourceError.value = t('resourceDropCategory')
  }
}
const addCondition = (index: number) => { flushDraftContext(); updateAction(index, { condition: { type: 'switch', switchId: 1 } }) }
const removeCondition = (index: number) => { flushDraftContext(); updateAction(index, { condition: undefined }) }
const updateCondition = (index: number, patch: Partial<NonNullable<UiEventAction['condition']>>) => {
  const condition = actions.value[index]?.condition
  if (condition) updateAction(index, { condition: { ...condition, ...patch } })
}
const updateSwitchValue = (index: number, value: unknown) => {
  if (value === 'on' || value === 'off') updateAction(index, { switchVal: value })
}
const setConditionType = (index: number, type: NonNullable<UiEventAction['condition']>['type']) => {
  flushDraftContext()
  const condition: NonNullable<UiEventAction['condition']> = type === 'switch' ? { type, switchId: 1 } : type === 'variable' ? { type, variableId: 1, operator: '>=', value: 0 } : { type, code: 'true' }
  updateAction(index, { condition })
}
const actionField = (action: UiEventAction, key: string): string | number => {
  const value = (action as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' || typeof value === 'string' ? value : ''
}
const setActionType = (index: number, type: UiEventAction['type']) => {
  flushDraftContext()
  const base = { type } as UiEventAction
  if (type === 'gotoScene') Object.assign(base, { sceneName: openedScenes.value[0]?.value ?? projectScenes.value[0]?.value ?? '' })
  if (type === 'toggleNode') Object.assign(base, { targetNodeId: props.node.id })
  if (type === 'playSe') Object.assign(base, { seName: '' })
  if (type === 'url') Object.assign(base, { url: '' })
  if (type === 'script') Object.assign(base, { code: '' })
  if (type === 'showMessage') Object.assign(base, { message: '' })
  if (type === 'wait') Object.assign(base, { waitFrames: 30 })
  if (type === 'setVariable') Object.assign(base, { variableId: 1, variableOp: '=', variableVal: 0 })
  if (type === 'setSwitch') Object.assign(base, { switchId: 1, switchVal: 'on' })
  if (type === 'tweenProp') Object.assign(base, { tweenNodeId: props.node.id, tweenProp: 'opacity', tweenTarget: 255, tweenDuration: 300, tweenEasing: 'EaseOut' })
  updateActions(actions.value.map((action, actionIndex) => actionIndex === index ? base : action))
}
const sceneOptionsFor = (action: UiEventAction) => {
  const value = action.type === 'gotoScene' ? action.sceneName : ''
  const missing = value && !knownSceneTargets.value.has(value) ? [{ value, label: `${value} · ${t('sceneTargetMissing')}`, unavailable: true }] : []
  return missing
}
const sceneTargetKnown = (action: UiEventAction) => {
  const value = action.type === 'gotoScene' ? action.sceneName : ''
  return !value || knownSceneTargets.value.has(value)
}
</script>

<template>
  <section class="events-panel" data-ui-id="ui-designer-events-panel" data-testid="ui-designer-events-panel">
    <div class="subhead">{{ t('events') }}</div>
    <el-select data-ui-id="ui-designer-event-select" :model-value="activeEvent" size="small" @update:model-value="selectEvent">
      <el-option v-for="eventName in eventNames" :key="eventName" :label="t(eventLabels[eventName])" :value="eventName" />
    </el-select>
    <div class="action-list">
      <div v-for="(action, index) in actions" :key="`${activeEvent}-${index}`" class="action-card" draggable="true" :aria-grabbed="draggingAction === index" @dragstart="beginActionDrag(index, $event)" @dragover.prevent @drop="dropAction(index, $event)" @dragend="draggingAction = undefined">
        <div class="action-head">
          <span>{{ index + 1 }}</span>
          <el-select :data-ui-id="`ui-designer-event-${activeEvent}-${index}-type`" :model-value="action.type" size="small" @update:model-value="setActionType(index, $event)">
            <el-option v-for="type in actionTypes" :key="type" :label="t(actionLabels[type])" :value="type" />
          </el-select>
          <el-button-group><el-button :data-ui-id="`ui-designer-event-${activeEvent}-${index}-move-up`" size="small" text :aria-label="t('actionMoveUp')" :disabled="index === 0" @click="moveAction(index, -1)">↑</el-button><el-button :data-ui-id="`ui-designer-event-${activeEvent}-${index}-move-down`" size="small" text :aria-label="t('actionMoveDown')" :disabled="index === actions.length - 1" @click="moveAction(index, 1)">↓</el-button><el-button size="small" text type="danger" :aria-label="t('deleteNode')" @click="removeAction(index)">×</el-button></el-button-group>
        </div>
        <template v-if="action.type === 'gotoScene'">
          <el-select :model-value="actionField(action, 'sceneName')" size="small" filterable allow-create default-first-option :placeholder="t('sceneTargetChoose')" @update:model-value="updateAction(index, { sceneName: $event })">
            <el-option-group v-if="openedScenes.length" :label="t('sceneTargetGroupOpen')"><el-option v-for="option in openedScenes" :key="`open-${option.value}`" :label="option.label" :value="option.value" /></el-option-group>
            <el-option-group v-if="projectScenes.length" :label="t('sceneTargetGroupProject')"><el-option v-for="option in projectScenes" :key="`project-${option.value}`" :label="option.label" :value="option.value" /></el-option-group>
            <el-option-group :label="t('sceneTargetGroupBuiltin')"><el-option v-for="option in builtinScenes" :key="`builtin-${option.value}`" :label="option.label" :value="option.value" /></el-option-group>
            <el-option v-for="option in sceneOptionsFor(action)" :key="`missing-${option.value}`" :label="option.label" :value="option.value" :disabled="option.unavailable" />
          </el-select>
          <p v-if="!sceneTargetKnown(action)" class="action-warning">{{ t('sceneTargetMissing') }}</p>
        </template>
        <el-input v-else-if="action.type === 'toggleNode'" :model-value="actionField(action, 'targetNodeId')" size="small" :placeholder="t('targetNodePlaceholder')" @update:model-value="updateAction(index, { targetNodeId: $event })" />
        <div v-else-if="action.type === 'playSe'" class="action-resource-control">
          <UiResourceReferenceControl
            :model-value="String(actionField(action, 'seName'))"
            :placeholder="props.resourcePickerDisabled ? t('noProject') : t('chooseAudioResource')"
            :select-label="t('chooseAudioResource')"
            :clear-label="t('clearResource')"
            :select-disabled="!props.pickAudioResource || props.resourcePickerDisabled"
            :select-ui-id="`ui-designer-event-${activeEvent}-${index}-select-se`"
            :clear-ui-id="`ui-designer-event-${activeEvent}-${index}-clear-se`"
            @select="void choosePlaySe(index)"
            @clear="updateAction(index, { seName: '' })"
          />
        </div>
        <el-input v-else-if="action.type === 'url'" :model-value="actionField(action, 'url')" size="small" :placeholder="t('urlPlaceholder')" @update:model-value="updateAction(index, { url: $event })" />
        <template v-else-if="action.type === 'script'">
          <UiCodeMirrorEditor :data-ui-id="`ui-designer-event-${activeEvent}-${index}-script`" :adapter="designer.adapters.code" :model-value="String(actionField(action, 'code'))" :rows="4" :debounce-ms="1000" :format-on-blur="Boolean(designer.preferences.autoFormat)" :font-family="designer.preferences.codeFontFamily" :font-size="designer.preferences.codeFontSize" :completion-items="scriptCompletionItems" :scene-id="designer.activeSceneId" :draft-coordinator="designer.draftCoordinator" @update:model-value="updateAction(index, { code: $event })" />
          <UiScriptContextHint kind="action" :issues="codeIssuesFor(index)" />
        </template>
        <el-input v-else-if="action.type === 'showMessage'" :model-value="actionField(action, 'message')" size="small" @update:model-value="updateAction(index, { message: $event })" />
        <div v-else-if="action.type === 'setVariable'" class="action-params">
          <UiNamedEntryField kind="variable" :model-value="Number(actionField(action, 'variableId'))" :ui-id="`ui-designer-event-${activeEvent}-${index}-variable`" @update:model-value="updateAction(index, { variableId: $event })" />
          <el-select :model-value="actionField(action, 'variableOp')" size="small" @update:model-value="updateAction(index, { variableOp: $event })"><el-option v-for="operator in ['=', '+', '-', '*', '/']" :key="operator" :label="operator" :value="operator" /></el-select>
          <el-input-number :model-value="Number(actionField(action, 'variableVal'))" :min="0" size="small" @update:model-value="updateAction(index, { variableVal: $event ?? 0 })" />
        </div>
        <div v-else-if="action.type === 'setSwitch'" class="set-switch-params">
          <UiNamedEntryField kind="switch" :model-value="Number(actionField(action, 'switchId'))" :ui-id="`ui-designer-event-${activeEvent}-${index}-switch`" @update:model-value="updateAction(index, { switchId: $event })" />
          <el-switch
            v-if="actionField(action, 'switchVal') !== 'toggle'"
            :model-value="actionField(action, 'switchVal')"
            active-value="on"
            inactive-value="off"
            inline-prompt
            :active-text="t('switchOn')"
            :inactive-text="t('switchOff')"
            @update:model-value="updateSwitchValue(index, $event)"
          />
          <el-dropdown v-else trigger="click" @command="updateSwitchValue(index, $event)">
            <el-button size="small" plain>{{ t('switchToggle') }}</el-button>
            <template #dropdown><el-dropdown-menu><el-dropdown-item command="on">{{ t('switchOn') }}</el-dropdown-item><el-dropdown-item command="off">{{ t('switchOff') }}</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown>
        </div>
        <div v-else-if="action.type === 'tweenProp'" class="action-params">
          <el-input :model-value="actionField(action, 'tweenNodeId')" size="small" :placeholder="t('nodeIdPlaceholder')" @update:model-value="updateAction(index, { tweenNodeId: $event })" />
          <el-input :model-value="actionField(action, 'tweenProp')" size="small" :placeholder="t('propertyPlaceholder')" @update:model-value="updateAction(index, { tweenProp: $event })" />
          <el-input-number :model-value="Number(actionField(action, 'tweenTarget'))" size="small" @update:model-value="updateAction(index, { tweenTarget: $event ?? 0 })" />
          <el-input-number :model-value="Number(actionField(action, 'tweenDuration'))" :min="0" size="small" @update:model-value="updateAction(index, { tweenDuration: $event ?? 0 })" />
          <el-select :model-value="actionField(action, 'tweenEasing')" size="small" @update:model-value="updateAction(index, { tweenEasing: $event })"><el-option v-for="easing in ['Linear', 'EaseIn', 'EaseOut', 'EaseInOut', 'Bounce']" :key="easing" :label="t(easingLabels[easing as keyof typeof easingLabels])" :value="easing" /></el-select>
        </div>
        <el-input-number v-else-if="action.type === 'wait'" :model-value="Number(actionField(action, 'waitFrames'))" :min="0" size="small" controls-position="right" @update:model-value="updateAction(index, { waitFrames: $event ?? 0 })" />
        <div v-if="action.condition" class="action-condition">
          <div class="condition-head"><span>{{ t('condition') }}</span><el-button size="small" text type="danger" @click="removeCondition(index)">×</el-button></div>
          <el-select :model-value="action.condition.type" size="small" @update:model-value="setConditionType(index, $event)"><el-option v-for="type in ['switch', 'variable', 'code']" :key="type" :label="t(conditionLabels[type as keyof typeof conditionLabels])" :value="type" /></el-select>
          <UiNamedEntryField v-if="action.condition.type === 'switch'" kind="switch" :model-value="action.condition.switchId ?? 1" :ui-id="`ui-designer-event-${activeEvent}-${index}-condition-switch`" @update:model-value="updateCondition(index, { switchId: $event })" />
          <div v-else-if="action.condition.type === 'variable'" class="action-params">
            <UiNamedEntryField kind="variable" :model-value="action.condition.variableId ?? 1" :ui-id="`ui-designer-event-${activeEvent}-${index}-condition-variable`" @update:model-value="updateCondition(index, { variableId: $event })" />
            <el-select :model-value="action.condition.operator ?? '>='" size="small" @update:model-value="updateCondition(index, { operator: $event })"><el-option v-for="operator in ['==', '>=', '<=', '>', '<', '!=']" :key="operator" :label="operator" :value="operator" /></el-select>
            <el-input-number :model-value="action.condition.value ?? 0" size="small" @update:model-value="updateCondition(index, { value: $event ?? 0 })" />
          </div>
          <template v-else>
            <UiCodeMirrorEditor :data-ui-id="`ui-designer-event-${activeEvent}-${index}-condition-script`" :adapter="designer.adapters.code" :model-value="action.condition.code ?? ''" :rows="3" :debounce-ms="1000" :format-on-blur="Boolean(designer.preferences.autoFormat)" :font-family="designer.preferences.codeFontFamily" :font-size="designer.preferences.codeFontSize" :completion-items="scriptCompletionItems" :scene-id="designer.activeSceneId" :draft-coordinator="designer.draftCoordinator" @update:model-value="updateCondition(index, { code: $event })" />
            <UiScriptContextHint kind="condition" :issues="codeIssuesFor(index, true)" />
          </template>
        </div>
        <el-button v-else size="small" text @click="addCondition(index)">＋ {{ t('condition') }}</el-button>
      </div>
    </div>
    <el-button data-ui-id="ui-designer-event-action-add" data-testid="ui-designer-event-action-add" size="small" plain @click="addAction">＋ {{ t('actionAdd') }}</el-button>
    <el-alert v-if="resourceError" type="error" :closable="false" :title="resourceError" />
    <p class="hint">{{ t('actionHint') }}</p>
  </section>
</template>

<style scoped>
.events-panel { display: flex; flex-direction: column; gap: 9px; min-height: 0; overflow: auto; }
.subhead { color: var(--app-ink-soft); font-size: 11px; font-weight: 650; text-transform: uppercase; }
.action-list { display: flex; flex-direction: column; gap: 7px; }
.action-card { display: flex; flex-direction: column; gap: 6px; padding: 7px; border: 1px solid var(--app-border); border-radius: 5px; background: color-mix(in srgb, var(--app-bg) 88%, var(--app-accent) 12%); }
.action-head { display: flex; align-items: center; gap: 5px; color: var(--app-ink-soft); font-size: 10px; }
.action-head .el-select { flex: 1; }
.set-switch-params { display: flex; align-items: center; gap: 7px; min-width: 0; }
.set-switch-params > :first-child { flex: 1; min-width: 0; }
.set-switch-params > .el-switch, .set-switch-params > .el-dropdown { flex: none; }
.hint { margin: 2px 0 0; color: var(--app-ink-soft); font-size: 10px; line-height: 1.4; }
.action-warning { margin: 0; color: var(--el-color-warning); font-size: 10px; }
.action-resource-control { min-width: 0; }.action-resource-control > * { width: 100%; min-width: 0; }
</style>
