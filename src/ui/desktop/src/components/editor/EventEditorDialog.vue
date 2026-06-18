<template>
  <teleport to="body">
    <div v-if="visible" class="ev-modal-overlay editor-modal-overlay" data-ui-id="event-editor-overlay" :data-editor-dialog-layer="LAYER_Z.eventEditor" @mousedown.self="requestClose">
      <section ref="modalRef" class="ev-modal editor-modal-shell" data-ui-id="event-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="event-editor-title">
        <header class="ev-title-bar editor-modal-header">
          <h3 id="event-editor-title" class="editor-modal-title">{{ draft?.id ? `ID:${String(draft.id).padStart(3, '0')} - 事件编辑器` : '新建事件' }}</h3>
          <button type="button" class="editor-modal-close" data-ui-id="event-editor-close" aria-label="关闭事件编辑器" title="关闭" @click="requestClose">×</button>
        </header>
        <template v-if="draft">
          <div class="ev-meta-bar">
            <label class="ev-inline-field name"><span>名称</span><input v-model="draft.name" data-ui-id="event-editor-name" :disabled="shellLocked" @input="markDirty" /></label>
            <label class="ev-inline-field note"><span>备注</span><input v-model="draft.note" data-ui-id="event-editor-note" :disabled="shellLocked" @input="markDirty" /></label>
            <label class="ev-inline-field coord"><span>X</span><input v-model.number="draft.x" data-ui-id="event-editor-x" :disabled="shellLocked" type="number" min="0" @input="markDirty" /></label>
            <label class="ev-inline-field coord"><span>Y</span><input v-model.number="draft.y" data-ui-id="event-editor-y" :disabled="shellLocked" type="number" min="0" @input="markDirty" /></label>
            <div class="ev-toolbar-group page-tools" aria-label="事件页操作">
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-add" @click="addPage">新页</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-copy" @click="copyPage">复制页</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-paste" :disabled="!pageClipboard" @click="pastePage">粘贴页</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-clear" :disabled="currentPageLocked" @click="clearPage">清空页</button>
              <button type="button" class="ev-tool-btn danger" data-ui-id="event-editor-page-delete" :disabled="currentPageLocked || draft.pages.length <= 1" @click="deletePage">删页</button>
            </div>
          </div>
          <div v-if="shellLocked || currentPageLocked" class="ev-lock-banner">
            {{ currentPageLocked ? '当前页是历史受保护页，只读。你仍可点击“新页”追加可编辑页面。' : '受保护事件的名称、备注和坐标只读。' }}
          </div>
          <nav class="ev-page-tabs" aria-label="事件页">
            <button
              v-for="(_, index) in draft.pages"
              :key="index"
              type="button"
              :class="{ active: pageIndex === index }"
              @click="pageIndex = index"
            >{{ index + 1 }}{{ pageIdentities[index]?.origin === 'baseline' ? ' · 锁' : '' }}</button>
          </nav>
          <div v-if="currentPage" class="ev-main-grid">
            <aside class="ev-settings">
              <fieldset class="ev-group conditions-group" :disabled="currentPageLocked">
                <legend>出现条件</legend>
                <ConditionSelect v-model:valid="currentPage.conditions.switch1Valid" v-model:value="currentPage.conditions.switch1Id" label="开关" :options="catalog?.switches || []" @change="markDirty" />
                <ConditionSelect v-model:valid="currentPage.conditions.switch2Valid" v-model:value="currentPage.conditions.switch2Id" label="开关" :options="catalog?.switches || []" @change="markDirty" />
                <ConditionSelect v-model:valid="currentPage.conditions.variableValid" v-model:value="currentPage.conditions.variableId" label="变量" :options="catalog?.variables || []" @change="markDirty"><input :value="currentPage.conditions.variableValid ? currentPage.conditions.variableValue : ''" class="mini-input" type="number" :disabled="!currentPage.conditions.variableValid" @input="setVariableConditionValue" /></ConditionSelect>
                <label class="ev-cond-row"><input v-model="currentPage.conditions.selfSwitchValid" type="checkbox" @change="markDirty" /><span>独立开关</span><select :value="currentPage.conditions.selfSwitchValid ? currentPage.conditions.selfSwitchCh : ''" :disabled="!currentPage.conditions.selfSwitchValid" @change="setSelfSwitchCondition"><option value="" disabled>...</option><option v-for="ch in SELF_SWITCH_CHANNELS" :key="ch">{{ ch }}</option></select></label>
                <ConditionSelect v-model:valid="currentPage.conditions.actorValid" v-model:value="currentPage.conditions.actorId" label="角色" :options="catalog?.actors || []" @change="markDirty" />
                <ConditionSelect v-model:valid="currentPage.conditions.itemValid" v-model:value="currentPage.conditions.itemId" label="物品" :options="catalog?.items || []" @change="markDirty" />
              </fieldset>
              <fieldset class="ev-group image-group" :disabled="currentPageLocked">
                <legend>图像</legend>
                <div class="image-preview"><canvas ref="previewCanvas" width="78" height="108" /></div>
                <button type="button" class="ev-tool-btn block" @click="imagePicker?.open(currentPage.image)">图像...</button>
                <span class="image-caption">{{ imageSummary(currentPage.image) }}</span>
              </fieldset>
              <fieldset class="ev-group move-group" :disabled="currentPageLocked">
                <legend>自主移动</legend>
                <label class="ev-select-row"><span>类型</span><select v-model.number="currentPage.moveType" @change="markDirty"><option v-for="[value, label] in MOVE_TYPES" :key="value" :value="Number(value)">{{ label }}</option></select></label>
                <button type="button" class="ev-tool-btn block" :disabled="currentPage.moveType !== 3" @click="routeDialog?.open(currentPage.moveRoute)">路线...</button>
                <div class="mini-grid">
                  <label class="ev-select-row"><span>速度</span><select v-model.number="currentPage.moveSpeed" @change="markDirty"><option v-for="[value, label] in MOVE_SPEEDS" :key="value" :value="Number(value)">{{ label }}</option></select></label>
                  <label class="ev-select-row"><span>频率</span><select v-model.number="currentPage.moveFrequency" @change="markDirty"><option v-for="[value, label] in MOVE_FREQS" :key="value" :value="Number(value)">{{ label }}</option></select></label>
                </div>
              </fieldset>
              <fieldset class="ev-group options-group" :disabled="currentPageLocked">
                <legend>选项</legend>
                <label v-for="[key, label] in pageOptions" :key="key" class="ev-check"><input v-model="currentPage[key]" type="checkbox" @change="markDirty" />{{ label }}</label>
              </fieldset>
              <fieldset class="ev-group priority-group" :disabled="currentPageLocked">
                <legend>优先级</legend>
                <select v-model.number="currentPage.priorityType" @change="markDirty"><option v-for="[value, label] in PRIORITIES" :key="value" :value="Number(value)">{{ label }}</option></select>
              </fieldset>
              <fieldset class="ev-group trigger-group" :disabled="currentPageLocked">
                <legend>触发条件</legend>
                <select v-model.number="currentPage.trigger" @change="markDirty"><option v-for="[value, label] in TRIGGERS" :key="value" :value="Number(value)">{{ label }}</option></select>
              </fieldset>
            </aside>
            <section class="ev-commands" :class="{ locked: currentPageLocked }">
              <strong class="ev-cmd-title">执行内容</strong>
              <div class="command-list" @contextmenu.prevent="openCommandContext($event, null)">
                <div v-if="!spans.length" class="command-empty">
                  暂无指令。双击列表末尾的 ◆ 添加。
                </div>
                <button
                  v-for="(view, index) in spanViews"
                  :key="view.key"
                  type="button"
                  :disabled="currentPageLocked"
                  class="cmd-row"
                  :class="{ selected: selectedSpanSet.has(index), even: index % 2 === 0, [`tone-${view.tone}`]: true }"
                  :style="{ '--cmd-indent': `${Math.min(view.indent, 8) * 18}px` }"
                  :aria-pressed="selectedSpanSet.has(index)"
                  @click="selectCommand(index, $event)"
                  @dblclick="openCommand(index)"
                  @contextmenu.stop.prevent="openCommandContext($event, index)"
                ><span class="cmd-line cmd-head">{{ view.head }}</span><span v-for="(line, lineIndex) in view.lines" :key="lineIndex" class="cmd-line cmd-sub">{{ line }}</span></button>
                <button type="button" class="cmd-row terminator" :disabled="currentPageLocked" :class="{ even: spans.length % 2 === 0 }" @click="clearCommandSelection" @dblclick="openCommandPicker" @contextmenu.stop.prevent="openCommandContext($event, null)"><span class="cmd-line">◆</span></button>
              </div>
            </section>
          </div>
          <footer class="ev-footer">
            <span class="ev-save-status">{{ dirty ? '有未保存修改' : '已保存到暂存' }}</span>
            <div class="ev-footer-actions">
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-cancel" @click="requestClose">取消</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-apply" :disabled="!dirty || saving" @click="$emit('save', false)">{{ saving ? '保存中…' : '应用' }}</button>
              <button type="button" class="ev-tool-btn primary" data-ui-id="event-editor-ok" :disabled="!dirty || saving" @click="$emit('save', true)">{{ saving ? '保存中…' : '确定' }}</button>
            </div>
          </footer>
        </template>
      </section>
      <div v-if="cmdContext.visible" class="cmd-context-mask" @mousedown.self="closeCommandContext" @contextmenu.self.prevent="closeCommandContext">
        <ul class="cmd-context-menu" :style="{ left: `${cmdContext.x}px`, top: `${cmdContext.y}px` }" role="menu" aria-label="指令操作">
          <li><button type="button" @click="runCommandMenu(openCommandPicker)">新建...<span>Return</span></button></li>
          <li><button type="button" :disabled="selectedIndices.length !== 1" @click="runCommandMenu(openSelectedCommand)">编辑...<span>Enter</span></button></li>
          <li class="separator" />
          <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(cutSelectedCommands)">剪切<span>Ctrl+X</span></button></li>
          <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(() => copySelectedCommands())">复制<span>Ctrl+C</span></button></li>
          <li><button type="button" :disabled="!commandClipboard" @click="runCommandMenu(pasteSelectedCommand)">粘贴<span>Ctrl+V</span></button></li>
          <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(deleteSelectedCommands)">删除<span>Del</span></button></li>
          <li class="separator" />
          <li><button type="button" :disabled="!spans.length" @click="runCommandMenu(selectAllCommands)">全选<span>Ctrl+A</span></button></li>
        </ul>
      </div>
    </div>
  </teleport>
  <EventImagePickerDialog ref="imagePicker" :catalog="catalog" :tileset-images="tilesetImages" :load-image="loadImage" @commit="setImage" />
  <MoveRouteDialog ref="routeDialog" @commit="setPageRoute" />
  <EventCommandDialog ref="commandDialog" :map-id="mapId" :catalog="catalog" :load-image="loadImage" @commit="commitCommand" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { LAYER_Z } from '../../constants/layerZIndex';
import { confirmAboveModal } from '../../utils/confirmAboveModal';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type { EditorProjectCatalog, StoryEventOverview, StoryEventPageOverview } from '../../api/client';
import ConditionSelect from './EventConditionSelect.vue';
import EventCommandDialog from './EventCommandDialog.vue';
import EventImagePickerDialog from './EventImagePickerDialog.vue';
import MoveRouteDialog from './MoveRouteDialog.vue';
import { MOVE_FREQS, MOVE_SPEEDS, MOVE_TYPES, PRIORITIES, SELF_SWITCH_CHANNELS, TRIGGERS, clone, commandBlockSpanIndices, commandDisplay, commandInsertIndent, commandTone, defaultPage, editableCommandSpans, ensureTerminator, imageSummary, type MvCommand, type MvEditorEvent, type MvEventImage, type MvEventPage, type MvMoveRoute } from '../../composables/useEventEditor';
import { drawTile, eventCharacterFrame } from '../../composables/useMapRenderer';

const props = defineProps<{ visible: boolean; draft: MvEditorEvent | null; saving: boolean; mapId: number | null; systemData: { switches: string[]; variables: string[] } | null; catalog: EditorProjectCatalog | null; tilesetImages: (HTMLImageElement | null)[]; loadImage: (url: string) => Promise<HTMLImageElement | null>; overview?: StoryEventOverview | null }>();
const emit = defineEmits<{ close: []; save: [closeAfterSave: boolean] }>();
const eventEditorZ = String(LAYER_Z.eventEditor);
const dirty = ref(false), closing = ref(false), pageIndex = ref(0), selectedSpans = ref<number[]>([]), selectionAnchor = ref<number | null>(null), pageClipboard = ref<MvEventPage | null>(null), commandClipboard = ref<MvCommand[] | null>(null);
const pageIdentities = ref<Array<StoryEventPageOverview | undefined>>([]);
const modalRef = ref<HTMLElement>(), previewCanvas = ref<HTMLCanvasElement>(), imagePicker = ref<InstanceType<typeof EventImagePickerDialog>>(), routeDialog = ref<InstanceType<typeof MoveRouteDialog>>(), commandDialog = ref<InstanceType<typeof EventCommandDialog>>();
const currentPage = computed(() => props.draft?.pages[pageIndex.value] || null), spans = computed(() => currentPage.value ? editableCommandSpans(currentPage.value) : []);
// 每个 span 预渲染成「命令头 + 续行（台词/移动步骤等）」结构：头行按语义着色，续行另起一行缩进显示。
const spanViews = computed(() => spans.value.map((span) => {
  const head = commandDisplay(span.commands[0], props.systemData);
  return {
    key: span.index,
    tone: commandTone(span.commands[0].code),
    indent: head.indent,
    head: head.label,
    lines: span.commands.slice(1).map((cmd) => commandDisplay(cmd, props.systemData).label),
  };
}));
const currentPageLocked = computed(() => pageIdentities.value[pageIndex.value]?.origin === 'baseline');
const shellLocked = computed(() => Boolean(props.overview && !props.overview.shellEditable));
const selectedIndices = computed(() => selectedSpans.value.filter((index) => index >= 0 && index < spans.value.length).sort((a, b) => a - b));
const selectedSpanSet = computed(() => new Set(selectedIndices.value));
const cmdContext = reactive({ visible: false, x: 0, y: 0 });
const pageOptions: [keyof MvEventPage, string][] = [['walkAnime','步行动画'], ['stepAnime','踏步动画'], ['directionFix','固定朝向'], ['through','穿透']];
function setVariableConditionValue(event: Event) {
  if (!currentPage.value) return;
  currentPage.value.conditions.variableValue = Number((event.target as HTMLInputElement).value);
  markDirty();
}
function setSelfSwitchCondition(event: Event) {
  if (!currentPage.value) return;
  currentPage.value.conditions.selfSwitchCh = (event.target as HTMLSelectElement).value;
  markDirty();
}
function onKeyDown(event: KeyboardEvent) {
  if (!props.visible || !isTopmostEditorDialog(LAYER_Z.eventEditor)) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (cmdContext.visible) closeCommandContext();
    else void requestClose();
    return;
  }
  if (currentPageLocked.value) return;
  if (!isCommandShortcutTarget(event.target)) return;
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === 'Enter' && selectedIndices.value.length === 1) {
    event.preventDefault();
    openSelectedCommand();
  } else if (event.key === 'Delete' && selectedIndices.value.length) {
    event.preventDefault();
    deleteSelectedCommands();
  } else if (ctrl && event.key.toLowerCase() === 'x' && selectedIndices.value.length) {
    event.preventDefault();
    cutSelectedCommands();
  } else if (ctrl && event.key.toLowerCase() === 'c' && selectedIndices.value.length) {
    event.preventDefault();
    copySelectedCommands();
  } else if (ctrl && event.key.toLowerCase() === 'v' && commandClipboard.value) {
    event.preventDefault();
    pasteSelectedCommand();
  } else if (ctrl && event.key.toLowerCase() === 'a' && spans.value.length) {
    event.preventDefault();
    selectAllCommands();
  }
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
watch(() => props.visible, (value) => {
  if (value) {
    dirty.value = props.draft?.id === 0;
    pageIndex.value = 0;
    pageIdentities.value = (props.draft?.pages || []).map((_, index) =>
      props.overview?.pages.find((page) => page.pageIndex === index));
    clearCommandSelection();
    void nextTick(paintPreview);
  }
});
watch(currentPage, () => { clearCommandSelection(); void nextTick(paintPreview); });
function markDirty() { dirty.value = true; void nextTick(paintPreview); }
async function requestClose() {
  if (closing.value) return;
  if (dirty.value) {
    closing.value = true;
    try {
      await confirmAboveModal('存在未保存修改，确定关闭事件编辑器？', '放弃修改');
    } catch {
      return;
    } finally {
      closing.value = false;
    }
  }
  emit('close');
}
function markSaved() { dirty.value = false; }
function addPage() { if (!props.draft) return; props.draft.pages.push(defaultPage()); pageIdentities.value.push(undefined); pageIndex.value = props.draft.pages.length - 1; markDirty(); }
function copyPage() { if (currentPage.value) { pageClipboard.value = clone(currentPage.value); ElMessage.success('已复制事件页'); } }
function pastePage() { if (!props.draft || !pageClipboard.value) return; props.draft.pages.push(clone(pageClipboard.value)); pageIdentities.value.push(undefined); pageIndex.value = props.draft.pages.length - 1; markDirty(); }
async function clearPage() { if (!currentPage.value || currentPageLocked.value) return; try { await confirmAboveModal('清空当前事件页？', '清空事件页'); } catch { return; } props.draft!.pages[pageIndex.value] = defaultPage(); markDirty(); }
async function deletePage() { if (!props.draft || currentPageLocked.value || props.draft.pages.length <= 1) return; try { await confirmAboveModal('删除当前事件页？', '删除事件页'); } catch { return; } props.draft.pages.splice(pageIndex.value, 1); pageIdentities.value.splice(pageIndex.value, 1); pageIndex.value = Math.max(0, pageIndex.value - 1); markDirty(); }function openCommandPicker() { if (currentPageLocked.value) return; const selected = selectedIndices.value, next = selected.length ? selected[selected.length - 1] + 1 : spans.value.length; commandDialog.value?.openPicker(next, currentPage.value ? commandInsertIndent(currentPage.value.list, rawIndexForSpan(next)) : 0); }
function openCommand(index: number) { if (currentPageLocked.value) return; const span = spans.value[index]; if (span) commandDialog.value?.openEditor(span.commands, index); }
function openSelectedCommand() { if (selectedIndices.value.length === 1) openCommand(selectedIndices.value[0]); }
function rawIndexForSpan(index: number) { return index >= spans.value.length ? Math.max(0, (currentPage.value?.list.length || 1) - 1) : spans.value[index]?.index || 0; }
function commitCommand(payload: { commands: MvCommand[]; editSpan: number | null; insertSpan: number | null }) { if (!currentPage.value || currentPageLocked.value) return; const list = currentPage.value.list; if (payload.editSpan == null) { const at = payload.insertSpan == null || payload.insertSpan >= spans.value.length ? list.length - 1 : spans.value[payload.insertSpan].index; list.splice(at, 0, ...payload.commands); } else { const span = spans.value[payload.editSpan]; if (span) list.splice(span.index, span.commands.length, ...payload.commands); } ensureTerminator(list); clearCommandSelection(); markDirty(); }
function selectCommand(index: number, event: MouseEvent) {
  if (event.shiftKey && selectionAnchor.value != null) {
    const start = Math.min(selectionAnchor.value, index), end = Math.max(selectionAnchor.value, index);
    selectedSpans.value = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  } else if (event.ctrlKey || event.metaKey) {
    selectedSpans.value = selectedSpanSet.value.has(index) ? selectedIndices.value.filter((item) => item !== index) : [...selectedIndices.value, index];
    selectionAnchor.value = index;
  } else {
    selectedSpans.value = [index];
    selectionAnchor.value = index;
  }
}
function clearCommandSelection() { selectedSpans.value = []; selectionAnchor.value = null; closeCommandContext(); }
function selectAllCommands() { selectedSpans.value = spans.value.map((_, index) => index); selectionAnchor.value = selectedSpans.value[0] ?? null; }
function deleteSelectedCommands() {
  if (!currentPage.value || currentPageLocked.value || !selectedIndices.value.length) return;
  const list = currentPage.value.list;
  for (const index of commandBlockSpanIndices(spans.value, selectedIndices.value).reverse()) {
    const span = spans.value[index];
    if (span) list.splice(span.index, span.commands.length);
  }
  ensureTerminator(list);
  clearCommandSelection();
  markDirty();
}
function copySelectedCommands(showMessage = true) {
  if (currentPageLocked.value || !selectedIndices.value.length) return;
  commandClipboard.value = clone(commandBlockSpanIndices(spans.value, selectedIndices.value).flatMap((index) => spans.value[index]?.commands || []));
  if (showMessage) ElMessage.success('已复制指令');
}
function cutSelectedCommands() {
  if (!selectedIndices.value.length) return;
  copySelectedCommands(false);
  deleteSelectedCommands();
  ElMessage.success('已剪切指令');
}
function pasteSelectedCommand() {
  if (!commandClipboard.value || !currentPage.value || currentPageLocked.value) return;
  const selected = selectedIndices.value, next = selected.length ? selected[selected.length - 1] + 1 : spans.value.length;
  const at = next >= spans.value.length ? currentPage.value.list.length - 1 : spans.value[next].index;
  currentPage.value.list.splice(at, 0, ...clone(commandClipboard.value));
  ensureTerminator(currentPage.value.list);
  clearCommandSelection();
  markDirty();
}
function openCommandContext(event: MouseEvent, index: number | null) {
  if (currentPageLocked.value) return;
  if (index == null) clearCommandSelection();
  else if (!selectedSpanSet.value.has(index)) { selectedSpans.value = [index]; selectionAnchor.value = index; }
  const rect = modalRef.value?.getBoundingClientRect();
  const width = 214, height = 266, margin = 8;
  cmdContext.x = rect ? Math.max(rect.left + margin, Math.min(event.clientX, rect.right - width - margin)) : event.clientX;
  cmdContext.y = rect ? Math.max(rect.top + margin, Math.min(event.clientY, rect.bottom - height - margin)) : event.clientY;
  cmdContext.visible = true;
}
function closeCommandContext() { cmdContext.visible = false; }
function runCommandMenu(action: () => void) { closeCommandContext(); action(); }
function isCommandShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return true;
  if (element.closest('.cmd-row')) return true;
  return !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName);
}
function setImage(image: MvEventImage) { if (currentPage.value && !currentPageLocked.value) { currentPage.value.image = image; markDirty(); } }
function setPageRoute(route: MvMoveRoute) { if (currentPage.value && !currentPageLocked.value) { currentPage.value.moveRoute = route; markDirty(); } }
async function paintPreview() { const canvas = previewCanvas.value, image = currentPage.value?.image; if (!canvas || !image) return; const context = canvas.getContext('2d')!; context.clearRect(0,0,canvas.width,canvas.height); if (image.tileId) return drawTile(context, props.tilesetImages, image.tileId, 14, 10); const asset = props.catalog?.assets.characters.find((item) => item.name === image.characterName); if (!asset) return; const bitmap = await props.loadImage(asset.url); const frame = bitmap && eventCharacterFrame(bitmap, image); if (!bitmap || !frame) return; const scale = Math.min(1, 64 / frame.sw, 88 / frame.sh); context.imageSmoothingEnabled = false; context.drawImage(bitmap, frame.sx, frame.sy, frame.sw, frame.sh, Math.round((canvas.width-frame.sw*scale)/2), Math.round((canvas.height-frame.sh*scale)/2), frame.sw*scale, frame.sh*scale); }
defineExpose({ markSaved });
</script>

<style scoped>
.ev-modal-overlay {
  z-index: v-bind(eventEditorZ);
}

.ev-modal {
  width: min(1040px, calc(100vw - 32px));
  height: min(720px, calc(100vh - 32px));
}

.ev-title-bar {
  flex: 0 0 auto;
}

.ev-meta-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  padding: 5px 8px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg);
}

.ev-lock-banner {
  padding: 7px 12px;
  color: var(--app-warn);
  background: color-mix(in srgb, var(--app-warn) 9%, transparent);
  border-bottom: 1px solid var(--app-border);
  font-size: var(--text-sm);
}

.ev-commands.locked {
  opacity: 0.68;
}

.ev-inline-field {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--app-ink-soft);
  font-size: var(--text-xs);
}

.ev-inline-field.name {
  flex: 0 1 190px;
}

.ev-inline-field.note {
  flex: 1 1 210px;
}

.ev-inline-field.coord {
  flex: 0 0 62px;
}

.ev-inline-field input {
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: var(--text-sm);
}

.page-tools {
  margin-left: auto;
}

.ev-page-tabs {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  margin: 0 8px;
  padding: 0;
  background: var(--app-bg-soft);
}

.ev-page-tabs button {
  min-width: 36px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--app-border);
  border-bottom: 0;
  border-radius: var(--app-radius-sm) var(--app-radius-sm) 0 0;
  background: var(--app-bg-sunken);
  color: var(--app-ink-soft);
  font-size: var(--text-sm);
  cursor: pointer;
}

.ev-page-tabs button.active {
  background: var(--app-bg);
  color: var(--app-accent);
  font-weight: 600;
  border-color: var(--app-border-strong);
  position: relative;
  z-index: 1;
}

.ev-toolbar-group {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  overflow: hidden;
  background: var(--app-bg);
}

.ev-tool-btn {
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid var(--app-border);
  background: var(--app-bg-soft);
  color: var(--app-ink);
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
}

.ev-tool-btn:last-child {
  border-right: 0;
}

.ev-tool-btn:hover:not(:disabled) {
  background: var(--app-accent-soft);
}

.ev-tool-btn:disabled {
  color: var(--app-ink-muted);
  cursor: not-allowed;
  opacity: .65;
}

.ev-tool-btn.danger:not(:disabled) {
  color: var(--app-danger);
}

.ev-tool-btn.primary {
  background: var(--app-accent);
  color: var(--app-accent-ink);
  font-weight: 600;
}

.ev-tool-btn.primary:hover:not(:disabled) {
  background: var(--app-accent-hover);
}

.ev-tool-btn.block {
  width: 100%;
  border-right: 0;
  border-top: 1px solid var(--app-border);
}

.ev-main-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  flex: 1;
  margin: 0 8px 6px;
  border: 1px solid var(--app-border-strong);
  border-radius: 0 var(--app-radius-sm) var(--app-radius-sm);
  overflow: hidden;
}

.ev-settings {
  min-height: 0;
  padding: 5px;
  border-right: 1px solid var(--app-border);
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: 4px 6px;
  align-content: start;
  overflow: hidden;
  background: var(--app-bg-soft);
}

.ev-group {
  margin: 0;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
}

.ev-group legend {
  padding: 0 4px;
  color: var(--app-ink);
  font-size: 10px;
  font-weight: 600;
}

.conditions-group {
  grid-column: 1 / -1;
}

.image-group {
  grid-column: 1;
  display: grid;
  gap: 4px;
}

.move-group {
  grid-column: 2;
}

.options-group {
  grid-column: 1;
}

.priority-group,
.trigger-group {
  grid-column: 2;
}

.ev-group select,
.ev-select-row select,
.mini-input {
  width: 100%;
  min-width: 0;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: var(--text-xs);
}

.ev-cond-row,
.ev-check,
.ev-select-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
  color: var(--app-ink);
  font-size: var(--text-xs);
}

.ev-select-row {
  justify-content: space-between;
}

.ev-select-row span {
  flex: 0 0 auto;
}

.ev-select-row select {
  flex: 1;
}

.mini-input {
  width: 42px;
  flex: 0 0 42px;
}

.mini-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}

.image-preview {
  width: 82px;
  height: 112px;
  display: grid;
  place-items: center;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background:
    linear-gradient(45deg, #e9e9e6 25%, transparent 25%),
    linear-gradient(-45deg, #e9e9e6 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e9e9e6 75%),
    linear-gradient(-45deg, transparent 75%, #e9e9e6 75%);
  background-color: var(--app-bg);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.image-preview canvas {
  display: block;
  image-rendering: pixelated;
}

.image-caption {
  display: block;
  color: var(--app-ink-muted);
  font-size: 10px;
  line-height: 1.2;
  word-break: break-all;
}

.ev-commands {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 6px;
  overflow: hidden;
  background: var(--app-bg);
  --app-border: #cac4b6;
  --app-border-strong: #b3ab9c;
  --app-bg-soft: #e6e2d9;
  --app-bg-sunken: #d9d3c7;
  --app-ink-soft: #5c5649;
  --app-ink-muted: #7d776b;
  --app-accent-soft: #f5e6da;
  --app-tone-flow: #8b5d23;
  --app-tone-stage: #3d6d90;
  --app-tone-move: #277772;
}

.ev-cmd-title {
  margin-bottom: 4px;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--app-ink);
}

.command-list {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
}

.command-empty {
  padding: 7px 10px;
  color: var(--app-ink-muted);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg-soft);
}

.cmd-row {
  width: 100%;
  min-height: 22px;
  height: auto;
  flex: 0 0 auto;
  display: block;
  padding: 1px 8px 1px calc(14px + var(--cmd-indent, 0px));
  border: 1px solid transparent;
  background: var(--app-bg);
  color: var(--app-ink);
  text-align: left;
  cursor: pointer;
  appearance: none;
  border-radius: 0;
}

.cmd-row.even {
  background: var(--app-bg);
}

.cmd-row:not(.even):not(.selected) {
  background: var(--app-bg-soft);
}

.cmd-row:hover:not(.selected) {
  background: var(--app-accent-soft);
}

.cmd-row.selected {
  background: var(--app-accent);
  color: var(--app-accent-ink);
}

.cmd-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  font-family: var(--app-font-sans);
  font-size: var(--text-sm);
  line-height: 20px;
  min-height: 20px;
}

/* 续行（台词、移动步骤等）：正文色、缩进一级，与命令头拉开层次 */
.cmd-sub {
  padding-left: 18px;
  color: var(--app-ink);
}

.cmd-row.selected .cmd-line {
  color: var(--app-accent-ink);
}

.cmd-row.tone-text:not(.selected) .cmd-head { color: var(--app-tone-text-strong); }
.cmd-row.tone-flow:not(.selected) .cmd-head { color: var(--app-tone-flow); }
.cmd-row.tone-data:not(.selected) .cmd-head { color: var(--app-tone-data); }
.cmd-row.tone-stage:not(.selected) .cmd-head { color: var(--app-tone-stage); }
.cmd-row.tone-move:not(.selected) .cmd-head { color: var(--app-tone-move); }
.cmd-row.tone-control:not(.selected) .cmd-head { color: var(--app-tone-control-strong); }
.cmd-row.tone-raw:not(.selected) .cmd-head { color: var(--app-danger); }

.cmd-row.terminator:not(.selected) .cmd-line {
  color: var(--app-ink-soft);
}

.ev-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--app-border);
  background: var(--app-bg-soft);
}

.ev-save-status {
  color: var(--app-ink-muted);
  font-size: var(--text-sm);
}

.ev-footer-actions {
  display: flex;
  gap: 0;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  overflow: hidden;
}

.ev-footer-actions .ev-tool-btn {
  min-width: 72px;
}

.cmd-context-mask {
  position: fixed;
  inset: 0;
  z-index: 3;
}

.cmd-context-menu {
  position: fixed;
  min-width: 214px;
  margin: 0;
  padding: 4px 0;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  box-shadow: var(--app-shadow-3);
  list-style: none;
}

.cmd-context-menu li {
  margin: 0;
  padding: 0;
}

.cmd-context-menu li.separator {
  height: 0;
  margin: 4px 0;
  border-top: 1px solid var(--app-border);
}

.cmd-context-menu button {
  width: 100%;
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--app-ink);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  font-size: var(--text-sm);
  text-align: left;
}

.cmd-context-menu button:hover:not(:disabled) {
  background: var(--app-accent-soft);
}

.cmd-context-menu button:disabled {
  color: var(--app-ink-muted);
  cursor: not-allowed;
  opacity: .55;
}

.cmd-context-menu span {
  color: var(--app-ink-muted);
  font-size: var(--text-xs);
}

@media (max-width: 780px) {
  .ev-meta-bar {
    align-items: stretch;
  }

  .page-tools {
    flex-basis: 100%;
    margin-left: 0;
  }
}

@media (max-height: 680px) {
  .ev-settings {
    overflow: auto;
  }
}
</style>
