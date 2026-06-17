<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog route-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="move-route-title">
        <header class="editor-modal-header"><strong id="move-route-title" class="editor-modal-title">移动路线</strong><button type="button" class="editor-modal-close" aria-label="关闭移动路线编辑器" title="关闭" @click="close">×</button></header>
        <div class="route-body">
          <aside>
            <label>新增操作
              <select v-model.number="newCode">
                <option v-for="[code, label] in MOVE_ROUTE_OPERATIONS" :key="code" :value="code">{{ label }}</option>
              </select>
            </label>
            <el-button size="small" type="primary" @click="addStep">添加</el-button>
            <p>选择路线步骤后，在右侧修改需要的参数。未知步骤会保留原值。</p>
          </aside>
          <main>
            <div class="route-list">
              <button v-for="(step, index) in steps" :key="index" :class="{ active: selected === index }" @click="selected = index">{{ moveRouteCommandLabel(step) }}</button>
            </div>
            <div class="route-actions">
              <el-button size="small" :disabled="selected == null || selected <= 0" @click="move(-1)">上移</el-button>
              <el-button size="small" :disabled="selected == null || selected >= steps.length - 1" @click="move(1)">下移</el-button>
              <el-button size="small" type="danger" :disabled="selected == null" @click="remove">删除</el-button>
            </div>
            <div class="route-params">
              <template v-if="selectedStep">
                <template v-if="selectedStep.code === 14">
                  <label>横向距离
                    <input type="number" :value="numberParam(0, 0)" @input="setParam(0, numberValue($event))" />
                  </label>
                  <label>纵向距离
                    <input type="number" :value="numberParam(1, 0)" @input="setParam(1, numberValue($event))" />
                  </label>
                </template>
                <label v-else-if="selectedStep.code === 15">等待帧数
                  <input type="number" min="1" :value="numberParam(0, 1)" @input="setParam(0, numberValue($event))" />
                </label>
                <label v-else-if="[27, 28].includes(selectedStep.code)">开关编号
                  <input type="number" min="1" :value="numberParam(0, 1)" @input="setParam(0, numberValue($event))" />
                </label>
                <label v-else-if="selectedStep.code === 29">速度
                  <select :value="numberParam(0, 4)" @change="setParam(0, numberValue($event))">
                    <option v-for="[value, label] in MOVE_SPEEDS" :key="value" :value="Number(value)">{{ label }}</option>
                  </select>
                </label>
                <label v-else-if="selectedStep.code === 30">频率
                  <select :value="numberParam(0, 3)" @change="setParam(0, numberValue($event))">
                    <option v-for="[value, label] in MOVE_FREQS" :key="value" :value="Number(value)">{{ label }}</option>
                  </select>
                </label>
                <template v-else-if="selectedStep.code === 41">
                  <label>行走图文件
                    <input :value="stringParam(0)" @input="setParam(0, inputValue($event))" />
                  </label>
                  <label>图片索引
                    <input type="number" min="0" :value="numberParam(1, 0)" @input="setParam(1, numberValue($event))" />
                  </label>
                </template>
                <label v-else-if="selectedStep.code === 42">不透明度
                  <input type="number" min="0" max="255" :value="numberParam(0, 255)" @input="setParam(0, numberValue($event))" />
                </label>
                <label v-else-if="selectedStep.code === 43">合成方式
                  <select :value="numberParam(0, 0)" @change="setParam(0, numberValue($event))">
                    <option v-for="[value, label] in BLEND_OPTIONS" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
                <template v-else-if="selectedStep.code === 44">
                  <label>音效名
                    <input :value="seParam().name || ''" @input="setSeParam('name', inputValue($event))" />
                  </label>
                  <label>音量
                    <input type="number" min="0" max="100" :value="seParam().volume ?? 90" @input="setSeParam('volume', numberValue($event))" />
                  </label>
                  <label>音调
                    <input type="number" min="50" max="150" :value="seParam().pitch ?? 100" @input="setSeParam('pitch', numberValue($event))" />
                  </label>
                  <label>声像
                    <input type="number" min="-100" max="100" :value="seParam().pan ?? 0" @input="setSeParam('pan', numberValue($event))" />
                  </label>
                </template>
                <label v-else-if="selectedStep.code === 45">脚本
                  <textarea :value="stringParam(0)" rows="4" @input="setParam(0, inputValue($event))" />
                </label>
                <p v-else-if="!selectedStep.parameters?.length">当前操作不需要参数。</p>
                <p v-else>这个路线步骤的参数暂未图形化，已保留原值。</p>
              </template>
              <p v-else>先选择一个路线步骤。</p>
            </div>
            <div class="route-options">
              <label><input v-model="draft.repeat" type="checkbox" /> 重复执行</label>
              <label><input v-model="draft.skippable" type="checkbox" /> 无法移动时跳过</label>
              <label><input v-model="draft.wait" type="checkbox" /> 等待结束</label>
            </div>
          </main>
        </div>
        <footer class="editor-modal-footer"><button type="button" class="editor-btn" @click="close">取消</button><button type="button" class="editor-btn primary" @click="commit">确定</button></footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { MOVE_FREQS, MOVE_ROUTE_OPERATIONS, MOVE_SPEEDS, clone, defaultMoveRoute, moveRouteCommandLabel, type MvMoveRoute } from '../../composables/useEventEditor';

const emit = defineEmits<{ commit: [route: MvMoveRoute] }>();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const draft = ref<MvMoveRoute>(defaultMoveRoute());
const selected = ref<number | null>(null);
const newCode = ref(1);
const steps = computed(() => draft.value.list.filter((step) => step.code !== 0));
const selectedStep = computed(() => selected.value == null ? null : steps.value[selected.value] || null);
const BLEND_OPTIONS: [number, string][] = [[0, '普通'], [1, '加算'], [2, '正片叠底'], [3, '滤色']];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function open(route: MvMoveRoute) {
  draft.value = clone(route || defaultMoveRoute());
  draft.value.list = draft.value.list.filter((step) => step.code !== 0);
  selected.value = draft.value.list.length ? 0 : null;
  visible.value = true;
}
function close() { visible.value = false; }
function addStep() {
  const parameters = newCode.value === 14 ? [0, 0] : [15, 27, 28, 29, 30, 42, 43].includes(newCode.value) ? [1] : newCode.value === 41 ? ['', 0] : newCode.value === 44 ? [{ name: '', volume: 90, pitch: 100, pan: 0 }] : newCode.value === 45 ? [''] : [];
  draft.value.list.push({ code: newCode.value, parameters });
  selected.value = draft.value.list.length - 1;
}
function move(offset: number) {
  if (selected.value == null) return;
  const next = selected.value + offset;
  if (next < 0 || next >= draft.value.list.length) return;
  const [step] = draft.value.list.splice(selected.value, 1);
  draft.value.list.splice(next, 0, step);
  selected.value = next;
}
function remove() {
  if (selected.value == null) return;
  draft.value.list.splice(selected.value, 1);
  selected.value = draft.value.list.length ? Math.min(selected.value, draft.value.list.length - 1) : null;
}
function setParam(index: number, value: unknown) {
  if (!selectedStep.value) return;
  selectedStep.value.parameters[index] = value;
}
function numberParam(index: number, fallback = 0) {
  return Number(selectedStep.value?.parameters[index] ?? fallback);
}
function stringParam(index: number, fallback = '') {
  return String(selectedStep.value?.parameters[index] ?? fallback);
}
function seParam(): Record<string, unknown> {
  const value = selectedStep.value?.parameters[0];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function setSeParam(key: string, value: unknown) {
  setParam(0, { name: '', volume: 90, pitch: 100, pan: 0, ...seParam(), [key]: value });
}
function inputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}
function numberValue(event: Event) {
  return Number(inputValue(event));
}
function commit() {
  emit('commit', { ...clone(draft.value), list: [...clone(draft.value.list), { code: 0, parameters: [] }] });
  close();
}

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.sub-dialog { width: min(700px, 86vw); }
.route-body { min-height: 340px; display: grid; grid-template-columns: 180px 1fr; }
aside { padding: 12px; border-right: 1px solid var(--app-border); color: var(--app-ink-muted); font-size: 12px; }
aside label { display: grid; gap: 5px; margin-bottom: 8px; }
select, textarea, input { padding: 5px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); }
main { padding: 12px; }
.route-list { height: 180px; overflow: auto; border: 1px solid var(--app-border); }
.route-list button { width: 100%; min-height: 26px; padding: 0 8px; border: 0; background: var(--app-bg); color: var(--app-ink); text-align: left; cursor: pointer; }
.route-list button:nth-child(even) { background: var(--app-bg-soft); }
.route-list button:hover { background: var(--app-bg-sunken); }
.route-list button.active { background: var(--app-accent); color: var(--app-accent-ink); }
.route-actions, .route-options { display: flex; gap: 6px; margin-top: 8px; }
.route-params { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; color: var(--app-ink-muted); font-size: 12px; }
.route-params label, .route-params p { min-width: 0; display: grid; gap: 4px; margin: 0; }
.route-params textarea, .route-params p { grid-column: 1 / -1; }
.route-options { color: var(--app-ink); font-size: 13px; }
@media (max-width: 620px) { .route-body { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid var(--app-border); } }
</style>
