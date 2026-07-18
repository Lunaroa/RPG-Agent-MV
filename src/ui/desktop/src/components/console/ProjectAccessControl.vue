<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FolderOpened } from '@element-plus/icons-vue';
import { useProjectStore, type ProjectInfo } from '../../stores/project';
import { useI18n } from '../../i18n';
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error';

const props = withDefaults(defineProps<{
  compact?: boolean;
  showLabel?: boolean;
}>(), {
  compact: false,
  showLabel: true,
});

const emit = defineEmits<{ changed: [] }>();
const projectStore = useProjectStore();
const { language, t } = useI18n();
const pickerRef = ref<HTMLElement | null>(null);
const dropdownOpen = ref(false);
const localError = ref('');
const projectContext = ref<{
  open: boolean;
  x: number;
  y: number;
  project: ProjectInfo | null;
}>({
  open: false,
  x: 0,
  y: 0,
  project: null,
});

const busy = computed(() =>
  projectStore.loading || projectStore.switching || projectStore.registering || projectStore.removing,
);
const statusText = computed(() => {
  if (projectStore.removing) return t('projectAccess.removing');
  if (projectStore.registering) return t('projectAccess.registering');
  if (projectStore.switching) return t('projectAccess.switching');
  if (projectStore.loading) return t('projectAccess.loading');
  return '';
});
const errorText = computed(() =>
  formatProjectError(
    localError.value
    || projectStore.removeError
    || projectStore.registerError
    || projectStore.switchError
    || projectStore.loadError
    || '',
  ),
);
const selectedProjectLabel = computed(() => projectStore.currentProjectInfo?.name || t('projectAccess.selectProject'));
const selectedEngineLabel = computed(() => {
  const engine = projectStore.currentProjectInfo?.engine;
  return engine === 'rpg-maker-mz' ? 'MZ' : engine === 'rpg-maker-mv' ? 'MV' : '';
});
const contextMenuStyle = computed(() => ({
  left: `${projectContext.value.x}px`,
  top: `${projectContext.value.y}px`,
}));

async function onSwitch(projectPath: string) {
  if (busy.value) return;
  localError.value = '';
  closeProjectContext();
  dropdownOpen.value = false;
  try {
    await projectStore.switchProject(projectPath);
    emit('changed');
  } catch (error) {
    localError.value = formatProjectError(error instanceof Error ? error.message : t('projectAccess.switchFailed'));
  }
}

function toggleDropdown() {
  if (busy.value || !projectStore.projects.length) return;
  closeProjectContext();
  dropdownOpen.value = !dropdownOpen.value;
}

function openProjectContext(event: MouseEvent, project: ProjectInfo) {
  if (busy.value) return;
  localError.value = '';
  dropdownOpen.value = true;
  const width = 152;
  const height = 42;
  projectContext.value = {
    open: true,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    project,
  };
}

async function onRemoveContextProject() {
  const project = projectContext.value.project;
  if (busy.value || !project) return;
  localError.value = '';
  closeProjectContext();
  dropdownOpen.value = false;
  try {
    await projectStore.removeProject(project.path);
    emit('changed');
  } catch (error) {
    localError.value = formatProjectError(error instanceof Error ? error.message : t('projectAccess.removeFailed'));
  }
}

function closeProjectContext() {
  projectContext.value = {
    open: false,
    x: 0,
    y: 0,
    project: null,
  };
}

function closeDropdown() {
  dropdownOpen.value = false;
  closeProjectContext();
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (target && pickerRef.value?.contains(target)) return;
  closeDropdown();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDropdown();
}

async function onBrowse() {
  localError.value = '';
  try {
    const changed = await projectStore.browseAndAddProject();
    if (changed) emit('changed');
  } catch (error) {
    localError.value = formatProjectError(error instanceof Error ? error.message : t('projectAccess.addFailed'));
  }
}

function formatProjectError(value: unknown): string {
  if (!value) return '';
  return formatUserFacingErrorMessage(value, 'general', language.value);
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div class="project-access" data-ui-id="project-access" :class="{ compact: props.compact }">
    <div class="project-access-main">
      <label v-if="props.showLabel" for="project-access-select">{{ t('projectAccess.projectLabel') }}</label>
      <div v-if="projectStore.projects.length" ref="pickerRef" class="project-picker">
        <button
          id="project-access-select"
          type="button"
          class="project-trigger"
          data-ui-id="project-access-select"
          :class="{ open: dropdownOpen, empty: !projectStore.currentProject }"
          :disabled="busy"
          :aria-label="t('projectAccess.currentProject')"
          aria-haspopup="listbox"
          :aria-expanded="dropdownOpen"
          @click="toggleDropdown"
        >
          <span class="project-trigger-name">
            <span class="project-icon" aria-hidden="true">
              <img v-if="projectStore.currentProjectInfo?.iconUrl" :src="projectStore.currentProjectInfo.iconUrl" alt="" />
              <span v-else class="project-icon-placeholder"></span>
            </span>
            <span class="project-trigger-label">{{ selectedProjectLabel }}</span>
            <span v-if="selectedEngineLabel" class="engine-badge">{{ selectedEngineLabel }}</span>
          </span>
          <i class="project-trigger-arrow" aria-hidden="true"></i>
        </button>

        <div v-if="dropdownOpen" class="project-menu" role="listbox">
          <button
            v-for="project in projectStore.projects"
            :key="project.path"
            type="button"
            class="project-option"
            :data-ui-id="`project-access-option-${project.path}`"
            :class="{ active: project.path === projectStore.currentProject }"
            role="option"
            :aria-selected="project.path === projectStore.currentProject"
            :title="project.path"
            @click="onSwitch(project.path)"
            @contextmenu.prevent.stop="openProjectContext($event, project)"
          >
            <span class="project-icon" aria-hidden="true">
              <img v-if="project.iconUrl" :src="project.iconUrl" alt="" />
              <span v-else class="project-icon-placeholder"></span>
            </span>
            <span class="project-option-label">{{ project.name }}</span>
          </button>
        </div>

        <div
          v-if="projectContext.open"
          class="project-context-menu"
          :style="contextMenuStyle"
          @pointerdown.stop
          @click.stop
        >
          <button type="button" data-ui-id="project-access-remove" :disabled="busy" @click="onRemoveContextProject">{{ t('projectAccess.removeProject') }}</button>
        </div>
      </div>
      <strong v-else>{{ t('projectAccess.noProject') }}</strong>
      <button type="button" class="icon-button" data-ui-id="project-access-browse" :disabled="busy" :title="t('projectAccess.chooseDirectory')" @click="onBrowse">
        <FolderOpened />
        <span>{{ t('projectAccess.chooseDirectoryShort') }}</span>
      </button>
    </div>

    <div v-if="statusText || errorText" class="project-access-state" :class="{ error: errorText }">
      {{ errorText || statusText }}
    </div>
  </div>
</template>

<style scoped>
.project-access {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.project-access-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

label {
  color: var(--console-text-faint, #b3a795);
  font-family: var(--app-font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.project-picker {
  position: relative;
  min-width: 190px;
  width: min(360px, 42vw);
}

.project-trigger {
  min-width: 190px;
  height: 34px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 9px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-soft, #5a5247);
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
}

.project-trigger {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
}

.project-trigger-name {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.project-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: inline-grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 5px;
  background: #eeeae3;
}

.project-icon img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.project-icon-placeholder {
  width: 8px;
  height: 8px;
  border: 1px solid #aaa39a;
  border-radius: 2px;
  background: #d7d2ca;
  transform: rotate(45deg);
}

.engine-badge {
  flex: 0 0 auto;
  padding: 1px 4px;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  border-radius: 4px;
  color: var(--console-text-faint, #8b8173);
  font-family: var(--app-font-mono);
  font-size: 9px;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: .04em;
}

.project-trigger.empty {
  color: var(--console-text-muted, #9a8e7e);
}

.project-trigger-arrow {
  width: 0;
  height: 0;
  flex: 0 0 auto;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  opacity: .78;
  transition: transform .14s ease;
}

.project-trigger.open .project-trigger-arrow {
  transform: rotate(180deg);
}

.project-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 260px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 9px;
  background: var(--console-paper, #fffdfa);
  box-shadow: 0 14px 36px rgba(48, 37, 25, .14);
}

.project-option {
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--console-text-soft, #5a5247);
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.project-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-option:hover,
.project-option.active {
  background: color-mix(in srgb, var(--console-accent, #be5630) 12%, transparent);
  color: var(--console-accent, #be5630);
}

.project-context-menu {
  position: fixed;
  z-index: 60;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 8px;
  background: var(--console-paper, #fffdfa);
  box-shadow: 0 14px 32px rgba(48, 37, 25, .18);
}

.project-context-menu button {
  width: 100%;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--app-danger, #b84034);
  padding: 0 10px;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.project-context-menu button:hover {
  background: color-mix(in srgb, var(--app-danger, #b84034) 10%, transparent);
}

strong {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  color: var(--console-text-soft, #5a5247);
  font-size: 13px;
  font-weight: 650;
}

.icon-button {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 9px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-soft, #5a5247);
  padding: 0 11px;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.icon-button:hover {
  border-color: var(--console-accent, #be5630);
  color: var(--console-accent, #be5630);
}

.icon-button:disabled,
.project-trigger:disabled,
.project-context-menu button:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.icon-button :deep(svg) {
  width: 15px;
}

.project-access-state {
  color: var(--console-text-muted, #9a8e7e);
  font-size: 12px;
}

.project-access-state.error {
  color: var(--app-danger);
}

.compact .icon-button span {
  display: none;
}

@media (max-width: 760px) {
  .project-access-main {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .project-picker,
  .project-trigger,
  .icon-button {
    width: 100%;
  }
}
</style>
