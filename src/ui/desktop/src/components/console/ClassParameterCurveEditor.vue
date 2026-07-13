<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from '../../i18n';
import {
  applyClassParamLinearCurve,
  normalizeClassParamCurves,
  setClassParamCurveLevel,
} from '../../utils/rmmvDatabaseEditor';
import { PARAM_OPTIONS, localizeDatabaseOptions } from '../../utils/rmmvDatabaseLocalization';
import { classParameterValueRange } from '../../utils/rmmvDatabaseSemantics';

const props = defineProps<{
  modelValue: unknown;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

const { language, t } = useI18n();
const selectedParameter = ref(0);
const selectedLevel = ref(1);
const linearStartLevel = ref(1);
const linearEndLevel = ref(99);
const linearStartValue = ref(1);
const linearEndValue = ref(1);
const chartWidth = 760;
const chartHeight = 250;
const chartPadding = 18;
const gridLevels = [1, 25, 50, 75, 99];

const parameters = computed(() => localizeDatabaseOptions(PARAM_OPTIONS, language.value));
const curves = computed(() => normalizeClassParamCurves(props.modelValue));
const currentCurve = computed(() => curves.value[selectedParameter.value] || []);
const allowedRange = computed(() => classParameterValueRange(selectedParameter.value));
const chartMinimum = computed(() => {
  const values = currentCurve.value.slice(1, 100).filter(Number.isFinite);
  return values.length ? Math.min(...values) : allowedRange.value.minimum;
});
const chartMaximum = computed(() => {
  const values = currentCurve.value.slice(1, 100).filter(Number.isFinite);
  const maximum = values.length ? Math.max(...values) : allowedRange.value.maximum;
  return Math.max(maximum, chartMinimum.value + 1);
});
const chartPoints = computed(() => Array.from({ length: 99 }, (_entry, index) => {
  const level = index + 1;
  return `${xForLevel(level)},${yForValue(currentCurve.value[level] ?? 0)}`;
}).join(' '));
const pluginCurveCount = computed(() => Math.max(0, Array.isArray(props.modelValue) ? props.modelValue.length - 8 : 0));
const hasPluginColumns = computed(() => (
  Array.isArray(props.modelValue)
  && props.modelValue.slice(0, 8).some((row) => Array.isArray(row) && row.length > 100)
));

watch(selectedParameter, resetLinearRange, { immediate: true });

function xForLevel(level: number): number {
  return chartPadding + ((level - 1) / 98) * (chartWidth - chartPadding * 2);
}

function yForValue(value: number): number {
  const span = chartMaximum.value - chartMinimum.value;
  const ratio = span > 0 ? (value - chartMinimum.value) / span : 0;
  return chartHeight - chartPadding - ratio * (chartHeight - chartPadding * 2);
}

function selectParameter(index: number): void {
  selectedParameter.value = Math.min(7, Math.max(0, Math.trunc(index)));
}

function selectLevel(level: number): void {
  selectedLevel.value = Math.min(99, Math.max(1, Math.trunc(level)));
}

function selectLevelFromChart(event: MouseEvent): void {
  const target = event.currentTarget as SVGElement;
  const bounds = target.getBoundingClientRect();
  if (bounds.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
  selectLevel(Math.round(ratio * 98) + 1);
}

function updateSelectedValue(value: unknown): void {
  emit('update:modelValue', setClassParamCurveLevel(
    props.modelValue,
    selectedParameter.value,
    selectedLevel.value,
    Number(value),
  ));
}

function resetLinearRange(): void {
  linearStartLevel.value = 1;
  linearEndLevel.value = 99;
  linearStartValue.value = currentCurve.value[1] ?? allowedRange.value.minimum;
  linearEndValue.value = currentCurve.value[99] ?? allowedRange.value.minimum;
}

function applyLinearCurve(): void {
  emit('update:modelValue', applyClassParamLinearCurve(
    props.modelValue,
    selectedParameter.value,
    linearStartLevel.value,
    linearEndLevel.value,
    linearStartValue.value,
    linearEndValue.value,
  ));
}
</script>

<template>
  <div class="curve-editor">
    <div class="parameter-strip" role="tablist" :aria-label="t('db.parameter')">
      <button
        v-for="(parameter, index) in parameters"
        :key="parameter.value"
        type="button"
        role="tab"
        :aria-selected="selectedParameter === index"
        :class="{ active: selectedParameter === index }"
        @click="selectParameter(index)"
      >
        {{ parameter.label }}
      </button>
    </div>

    <div class="curve-workspace">
      <div class="chart-wrap">
        <div class="chart-scale">
          <span>{{ chartMaximum }}</span>
          <span>{{ chartMinimum }}</span>
        </div>
        <svg
          :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
          role="img"
          :aria-label="t('db.paramCurveAria', { parameter: parameters[selectedParameter]?.label || '' })"
          @click="selectLevelFromChart"
        >
          <line
            v-for="level in gridLevels"
            :key="`grid-${level}`"
            :x1="xForLevel(level)"
            :x2="xForLevel(level)"
            :y1="chartPadding"
            :y2="chartHeight - chartPadding"
            class="grid-line"
          />
          <line :x1="chartPadding" :x2="chartWidth - chartPadding" :y1="chartHeight / 2" :y2="chartHeight / 2" class="grid-line" />
          <polyline :points="chartPoints" class="curve-line" />
          <line
            :x1="xForLevel(selectedLevel)"
            :x2="xForLevel(selectedLevel)"
            :y1="chartPadding"
            :y2="chartHeight - chartPadding"
            class="selected-guide"
          />
          <circle
            :cx="xForLevel(selectedLevel)"
            :cy="yForValue(currentCurve[selectedLevel] ?? 0)"
            r="5"
            class="selected-point"
          />
        </svg>
        <div class="level-scale">
          <span v-for="level in gridLevels" :key="level">Lv{{ level }}</span>
        </div>
      </div>

      <aside class="curve-controls">
        <label>
          <span>{{ t('db.level') }}</span>
          <input type="number" min="1" max="99" :value="selectedLevel" @input="selectLevel(Number(($event.target as HTMLInputElement).value))" />
        </label>
        <label>
          <span>{{ parameters[selectedParameter]?.label }}</span>
          <input
            type="number"
            :min="allowedRange.minimum"
            :max="allowedRange.maximum"
            :value="currentCurve[selectedLevel] ?? allowedRange.minimum"
            @input="updateSelectedValue(($event.target as HTMLInputElement).value)"
          />
        </label>
        <small>{{ t('db.paramAllowedRange', { min: allowedRange.minimum, max: allowedRange.maximum }) }}</small>

        <details>
          <summary>{{ t('db.linearCurve') }}</summary>
          <div class="linear-grid">
            <label><span>{{ t('db.startLevel') }}</span><input v-model.number="linearStartLevel" type="number" min="1" max="99" /></label>
            <label><span>{{ t('db.startValue') }}</span><input v-model.number="linearStartValue" type="number" :min="allowedRange.minimum" :max="allowedRange.maximum" /></label>
            <label><span>{{ t('db.endLevel') }}</span><input v-model.number="linearEndLevel" type="number" min="1" max="99" /></label>
            <label><span>{{ t('db.endValue') }}</span><input v-model.number="linearEndValue" type="number" :min="allowedRange.minimum" :max="allowedRange.maximum" /></label>
          </div>
          <button type="button" class="apply-linear" @click="applyLinearCurve">{{ t('db.applyLinearCurve') }}</button>
        </details>
      </aside>
    </div>

    <small v-if="pluginCurveCount || hasPluginColumns" class="plugin-note">
      {{ t('db.pluginCurveReadonly') }}
    </small>
  </div>
</template>

<style scoped>
.curve-editor { display: grid; gap: 8px; min-width: 0; }
.parameter-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--console-border, #3c424a); border-radius: 5px; overflow: hidden; }
.parameter-strip button { min-width: 0; padding: 6px 4px; border: 0; border-right: 1px solid var(--console-border, #3c424a); border-radius: 0; color: var(--el-text-color-secondary); background: transparent; font-size: 11px; }
.parameter-strip button:last-child { border-right: 0; }
.parameter-strip button.active { color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 14%, transparent); }
.curve-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.chart-wrap { display: grid; grid-template-columns: 48px minmax(0, 1fr); grid-template-rows: minmax(180px, 250px) auto; min-width: 0; }
.chart-wrap svg { width: 100%; height: 100%; min-height: 180px; border: 1px solid var(--console-border, #3c424a); border-radius: 5px; background: color-mix(in srgb, var(--console-panel, #20242a) 92%, black); cursor: crosshair; }
.chart-scale { display: flex; flex-direction: column; justify-content: space-between; align-items: end; padding: 5px 7px 5px 0; color: var(--el-text-color-secondary); font-size: 10px; }
.level-scale { grid-column: 2; display: flex; justify-content: space-between; padding-top: 3px; color: var(--el-text-color-secondary); font-size: 10px; }
.grid-line { stroke: color-mix(in srgb, var(--console-border, #3c424a) 70%, transparent); stroke-width: 1; }
.curve-line { fill: none; stroke: var(--el-color-primary); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.selected-guide { stroke: color-mix(in srgb, var(--el-color-warning) 65%, transparent); stroke-width: 1; stroke-dasharray: 4 4; }
.selected-point { fill: var(--el-color-warning); stroke: var(--console-panel, #20242a); stroke-width: 2; }
.curve-controls { display: grid; grid-template-columns: 1fr 1fr; align-content: start; gap: 8px; }
.curve-controls label { display: grid; gap: 3px; }
.curve-controls label > span { color: var(--el-text-color-secondary); font-size: 11px; }
.curve-controls input { width: 100%; min-width: 0; }
.curve-controls small, .plugin-note { color: var(--el-text-color-secondary); font-size: 10px; }
.curve-controls details { grid-column: 1 / -1; border-top: 1px solid var(--console-border, #3c424a); padding-top: 7px; }
.curve-controls summary { color: var(--el-text-color-secondary); cursor: pointer; font-size: 11px; }
.linear-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 7px; }
.apply-linear { width: 100%; margin-top: 6px; }
.plugin-note { padding: 5px 7px; border: 1px dashed var(--console-border, #3c424a); border-radius: 4px; }
</style>
