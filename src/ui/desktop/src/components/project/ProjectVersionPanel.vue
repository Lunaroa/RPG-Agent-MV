<template>
  <div class="pv-page">
    <header class="pv-header">
      <div class="pv-header-left">
        <span class="pv-title">{{ t('projectGit.title') }}</span>
        <el-tag v-if="status?.branch" size="small" effect="plain">{{ status.branch }}</el-tag>
        <el-tag v-if="status && status.ahead > 0" size="small" type="success" effect="plain">
          {{ t('projectGit.remote.ahead', { count: status.ahead }) }}
        </el-tag>
        <el-tag v-if="status && status.behind > 0" size="small" type="warning" effect="plain">
          {{ t('projectGit.remote.behind', { count: status.behind }) }}
        </el-tag>
      </div>
      <div class="pv-header-right">
        <el-button size="small" :loading="loading" :disabled="!projectRoot" @click="loadStatus">
          {{ t('projectGit.refresh') }}
        </el-button>
        <el-button
          v-if="status?.enabled"
          size="small"
          :loading="backupRunning"
          @click="runBackup"
        >
          {{ t('projectGit.backup') }}
        </el-button>
      </div>
    </header>

    <div v-if="!projectRoot" class="pv-empty-state">
      <p>{{ t('projectGit.noProject') }}</p>
    </div>

    <div v-else-if="loading && !status" class="pv-empty-state">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
    </div>

    <div v-else-if="status && !status.available" class="pv-empty-state">
      <p class="pv-empty-title">{{ t('projectGit.gitMissing.title') }}</p>
      <p>{{ t('projectGit.gitMissing.body') }}</p>
      <el-button type="primary" :loading="gitDownloadRunning" @click="downloadGit">
        {{ gitDownloadRunning ? t('projectGit.gitMissing.downloading') : t('projectGit.gitMissing.download') }}
      </el-button>
    </div>

    <div v-else-if="status && !status.enabled" class="pv-empty-state">
      <p class="pv-empty-desc">{{ t('projectGit.enable.intro') }}</p>
      <p v-if="!status.lfsReady" class="pv-lfs-note">{{ t('projectGit.enable.lfsNote') }}</p>
      <el-button type="primary" :loading="actionRunning" @click="enableGit">
        {{ t('projectGit.enable.action') }}
      </el-button>
    </div>

    <template v-else-if="status">
      <section v-if="status.merging" class="pv-conflicts">
        <div class="pv-section-head">
          <span class="pv-section-title">{{ t('projectGit.conflict.title') }}</span>
          <div class="pv-conflict-actions">
            <el-button size="small" @click="abortMerge">{{ t('projectGit.conflict.abort') }}</el-button>
            <el-button
              type="primary"
              size="small"
              :loading="actionRunning"
              :disabled="conflicts.some((entry) => !conflictChoices[entry])"
              @click="applyConflictChoices"
            >
              {{ t('projectGit.conflict.apply') }}
            </el-button>
          </div>
        </div>
        <p class="pv-conflict-body">{{ t('projectGit.conflict.body') }}</p>
        <div class="pv-conflict-list">
          <div v-for="entry in conflicts" :key="entry" class="pv-conflict-item">
            <span class="pv-conflict-path">{{ entry }}</span>
            <el-radio-group v-model="conflictChoices[entry]" size="small">
              <el-radio-button value="local">{{ t('projectGit.conflict.keepLocal') }}</el-radio-button>
              <el-radio-button value="remote">{{ t('projectGit.conflict.useRemote') }}</el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </section>

      <section class="pv-changes">
        <div class="pv-section-head">
          <span class="pv-section-title">{{ t('projectGit.changes.title') }}</span>
          <span class="pv-section-meta">{{ t('projectGit.changes.count', { count: status.changes.length }) }}</span>
        </div>
        <div class="pv-changes-body">
          <div class="pv-change-list">
            <el-empty
              v-if="status.changes.length === 0"
              :description="t('projectGit.changes.empty')"
            />
            <el-table v-else :data="status.changes" size="small" @row-click="openDiff">
              <el-table-column prop="path" :label="t('projectGit.changes.path')" min-width="220" />
              <el-table-column :label="t('projectGit.changes.kind')" width="90">
                <template #default="{ row }">
                  <el-tag size="small" :type="changeTagType(row.kind)">
                    {{ changeKindLabel(row.kind) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="t('projectGit.changes.size')" width="90" align="right">
                <template #default="{ row }">
                  <span class="pv-size">{{ formatSize(row.size) }}</span>
                </template>
              </el-table-column>
              <el-table-column width="80" align="right">
                <template #default="{ row }">
                  <el-button
                    link
                    type="danger"
                    size="small"
                    @click.stop="discardChange(row.path)"
                  >
                    {{ t('projectGit.changes.discard') }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div v-if="diffVisible" class="pv-diff-pane">
            <div class="pv-diff-head">
              <span class="pv-diff-path">{{ diff?.path }}</span>
              <el-button link size="small" @click="diffVisible = false">×</el-button>
            </div>
            <div v-if="diffLoading" class="pv-diff-loading">
              <el-icon class="is-loading"><Loading /></el-icon>
            </div>
            <template v-else-if="diff">
              <div v-if="diff.binary" class="pv-diff-note">{{ t('projectGit.diff.binary') }}</div>
              <div v-else-if="diff.tooLarge" class="pv-diff-note">{{ t('projectGit.diff.tooLarge') }}</div>
              <div v-else-if="diff.lines.length === 0" class="pv-diff-note">{{ t('projectGit.diff.empty') }}</div>
              <pre v-else class="pv-diff-body"><div
                v-for="(line, index) in diff.lines"
                :key="index"
                class="pv-diff-line"
                :class="`is-${line.type}`"
              ><span class="pv-diff-sign">{{ lineSign(line.type) }}</span><span class="pv-diff-text">{{ line.text }}</span></div></pre>
            </template>
          </div>
        </div>
        <div class="pv-commit-bar">
          <el-input
            v-model="commitMessage"
            size="small"
            :placeholder="t('projectGit.commit.placeholder')"
            @keyup.enter="submitCommit"
          />
          <el-button
            type="primary"
            size="small"
            :loading="actionRunning"
            :disabled="!commitMessage.trim()"
            @click="submitCommit"
          >
            {{ t('projectGit.commit.action') }}
          </el-button>
        </div>
      </section>

      <div class="pv-dock">
        <section class="pv-dock-timeline">
          <div class="pv-section-head">
            <span class="pv-section-title">{{ t('projectGit.timeline.title') }}</span>
          </div>
          <div class="pv-dock-scroll">
            <el-empty v-if="commits.length === 0" :description="t('projectGit.timeline.empty')" :image-size="60" />
            <el-timeline v-else class="pv-timeline">
              <el-timeline-item
                v-for="commit in commits"
                :key="commit.hash"
                :timestamp="formatCommitTime(commit.time)"
                placement="top"
              >
                <div class="pv-commit-item">
                  <code>{{ commit.hash.slice(0, 7) }}</code>
                  <span>{{ commit.message }}</span>
                </div>
              </el-timeline-item>
            </el-timeline>
          </div>
        </section>

        <section class="pv-dock-remote">
          <div class="pv-section-head">
            <span class="pv-section-title">{{ t('projectGit.remote.title') }}</span>
          </div>
          <div class="pv-remote-body">
            <div class="pv-remote-row">
              <el-input
                v-model="remoteUrl"
                size="small"
                :placeholder="t('projectGit.remote.urlPlaceholder')"
              />
              <el-button size="small" @click="saveRemote">{{ t('projectGit.remote.save') }}</el-button>
            </div>
            <el-input
              v-model="remoteToken"
              size="small"
              type="password"
              show-password
              :placeholder="t('projectGit.remote.tokenPlaceholder')"
            />
            <div class="pv-remote-row">
              <el-button
                type="primary"
                size="small"
                :loading="actionRunning"
                :disabled="!status.remoteUrl"
                @click="pushRemote"
              >
                {{ t('projectGit.remote.push') }}
              </el-button>
              <el-button
                size="small"
                :loading="actionRunning"
                :disabled="!status.remoteUrl"
                @click="pullRemote"
              >
                {{ t('projectGit.remote.pull') }}
              </el-button>
            </div>
            <p class="pv-remote-note">{{ t('projectGit.remote.tokenNote') }}</p>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import type {
  ProjectGitChange,
  ProjectGitCommit,
  ProjectGitConflictChoice,
  ProjectGitDiffLineType,
  ProjectGitFileDiff,
  ProjectGitFileResult,
  ProjectGitStatus,
} from '@contract/project-git';
import { projectGit } from '../../api/client';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/project';

const emit = defineEmits<{
  status: [status: ProjectGitStatus];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();

const status = ref<ProjectGitStatus | null>(null);
const commits = ref<ProjectGitCommit[]>([]);
const conflicts = ref<string[]>([]);
const conflictChoices = reactive<Record<string, ProjectGitConflictChoice>>({});
const loading = ref(false);
const actionRunning = ref(false);
const backupRunning = ref(false);
const commitMessage = ref('');
const remoteUrl = ref('');
const remoteToken = ref('');
const gitDownloadRunning = ref(false);
const diffVisible = ref(false);
const diffLoading = ref(false);
const diff = ref<ProjectGitFileDiff | null>(null);

const projectRoot = computed(() => projectStore.currentProject?.trim() || '');

onMounted(() => {
  void loadStatus();
});

watch(projectRoot, () => {
  diffVisible.value = false;
  void loadStatus();
});

function reportError<T>(result: ProjectGitFileResult<T>): boolean {
  if (result.status === 'error') {
    ElMessage.error(result.message || t('projectGit.error.generic'));
    return true;
  }
  return false;
}

async function loadStatus(): Promise<void> {
  if (!projectRoot.value) {
    status.value = null;
    return;
  }
  loading.value = true;
  try {
    const result = await projectGit.status({ project: projectRoot.value });
    if (reportError(result) || !result.value) return;
    const next = result.value;
    status.value = next;
    emit('status', next);
    remoteUrl.value = next.remoteUrl || '';
    if (next.enabled) {
      const logResult = await projectGit.log({ project: projectRoot.value });
      commits.value = logResult.status === 'success' ? (logResult.value ?? []) : [];
      if (next.merging) {
        const conflictResult = await projectGit.conflicts({ project: projectRoot.value });
        conflicts.value = conflictResult.status === 'success' ? (conflictResult.value ?? []) : [];
      } else {
        conflicts.value = [];
      }
      for (const key of Object.keys(conflictChoices)) {
        if (!conflicts.value.includes(key)) delete conflictChoices[key];
      }
    }
  } catch {
    ElMessage.error(t('projectGit.error.generic'));
  } finally {
    loading.value = false;
  }
}

async function enableGit(): Promise<void> {
  if (!projectRoot.value) return;
  actionRunning.value = true;
  try {
    const result = await projectGit.enable({ project: projectRoot.value });
    if (reportError(result) || !result.value) return;
    const next = result.value;
    status.value = next;
    emit('status', next);
    const logResult = await projectGit.log({ project: projectRoot.value });
    commits.value = logResult.status === 'success' ? (logResult.value ?? []) : [];
    ElMessage.success(t('projectGit.enable.done'));
  } finally {
    actionRunning.value = false;
  }
}

async function submitCommit(): Promise<void> {
  if (!projectRoot.value || !commitMessage.value.trim()) return;
  actionRunning.value = true;
  try {
    const result = await projectGit.commit({ project: projectRoot.value, message: commitMessage.value.trim() });
    if (reportError(result)) return;
    commitMessage.value = '';
    ElMessage.success(t('projectGit.commit.done'));
    await loadStatus();
  } finally {
    actionRunning.value = false;
  }
}

async function discardChange(changePath: string): Promise<void> {
  if (!projectRoot.value) return;
  await ElMessageBox.confirm(
    t('projectGit.changes.discardConfirm', { path: changePath }),
    t('projectGit.changes.discard'),
    { type: 'warning' },
  );
  const result = await projectGit.discard({ project: projectRoot.value, path: changePath });
  if (reportError(result)) return;
  await loadStatus();
}

async function openDiff(change: ProjectGitChange): Promise<void> {
  if (!projectRoot.value) return;
  diffVisible.value = true;
  diffLoading.value = true;
  try {
    const result = await projectGit.diff({ project: projectRoot.value, path: change.path });
    diff.value = result.status === 'success' ? (result.value ?? null) : null;
  } finally {
    diffLoading.value = false;
  }
}

async function saveRemote(): Promise<void> {
  if (!projectRoot.value || !remoteUrl.value.trim()) return;
  const result = await projectGit.setRemote({ project: projectRoot.value, url: remoteUrl.value.trim() });
  if (reportError(result)) return;
  ElMessage.success(t('projectGit.remote.saved'));
  await loadStatus();
}

async function pushRemote(): Promise<void> {
  if (!projectRoot.value) return;
  actionRunning.value = true;
  try {
    const result = await projectGit.push({ project: projectRoot.value, token: remoteToken.value || undefined });
    if (reportError(result)) return;
    ElMessage.success(t('projectGit.remote.pushDone'));
    await loadStatus();
  } finally {
    actionRunning.value = false;
  }
}

async function pullRemote(): Promise<void> {
  if (!projectRoot.value) return;
  actionRunning.value = true;
  try {
    const result = await projectGit.pull({ project: projectRoot.value, token: remoteToken.value || undefined });
    if (!reportError(result)) {
      ElMessage.success(t('projectGit.remote.pullDone'));
    }
    await loadStatus();
  } finally {
    actionRunning.value = false;
  }
}

async function applyConflictChoices(): Promise<void> {
  if (!projectRoot.value) return;
  actionRunning.value = true;
  try {
    let merged = false;
    for (const entry of [...conflicts.value]) {
      const choice = conflictChoices[entry];
      if (!choice) continue;
      const result = await projectGit.resolve({ project: projectRoot.value, path: entry, choice });
      if (reportError(result)) return;
      if (result.value?.merged) merged = true;
    }
    if (merged) {
      ElMessage.success(t('projectGit.conflict.resolved'));
    }
    await loadStatus();
  } finally {
    actionRunning.value = false;
  }
}

async function abortMerge(): Promise<void> {
  if (!projectRoot.value) return;
  const result = await projectGit.abortMerge({ project: projectRoot.value });
  if (reportError(result)) return;
  await loadStatus();
}

async function runBackup(): Promise<void> {
  if (!projectRoot.value) return;
  backupRunning.value = true;
  try {
    const result = await projectGit.backup({ project: projectRoot.value });
    if (reportError(result)) return;
    ElMessage.success(t('projectGit.backup.done'));
  } finally {
    backupRunning.value = false;
  }
}

async function downloadGit(): Promise<void> {
  gitDownloadRunning.value = true;
  try {
    const result = await projectGit.downloadGit();
    if (!reportError(result)) {
      ElMessage.success(t('projectGit.gitMissing.downloaded'));
    }
  } finally {
    gitDownloadRunning.value = false;
  }
}

function changeTagType(kind: ProjectGitChange['kind']): 'success' | 'warning' | 'danger' | 'info' {
  switch (kind) {
    case 'added':
      return 'success';
    case 'deleted':
      return 'danger';
    case 'renamed':
      return 'warning';
    default:
      return 'info';
  }
}

function changeKindLabel(kind: ProjectGitChange['kind']): string {
  switch (kind) {
    case 'added':
      return t('projectGit.change.added');
    case 'deleted':
      return t('projectGit.change.deleted');
    case 'renamed':
      return t('projectGit.change.renamed');
    default:
      return t('projectGit.change.modified');
  }
}

function lineSign(type: ProjectGitDiffLineType): string {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

function formatSize(size: number | null): string {
  if (size === null || Number.isNaN(size)) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatCommitTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<style scoped>
.pv-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg-elevated);
}

.pv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-soft);
}

.pv-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pv-title {
  font-size: 15px;
  font-weight: 600;
}

.pv-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pv-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
  padding: 24px;
  text-align: center;
}

.pv-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.pv-empty-desc {
  max-width: 520px;
  line-height: 1.7;
}

.pv-lfs-note {
  max-width: 520px;
  font-size: 12px;
  color: var(--el-color-warning);
}

.pv-conflicts {
  flex: none;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-soft);
  background: var(--el-color-warning-light-9);
}

.pv-conflict-body {
  margin: 0;
  padding: 8px 16px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.pv-conflict-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 16px 12px;
  max-height: 180px;
  overflow: auto;
}

.pv-conflict-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pv-conflict-path {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv-conflict-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pv-changes {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-soft);
}

.pv-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  height: 36px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-soft);
}

.pv-section-title {
  font-size: 13px;
  font-weight: 600;
}

.pv-section-meta {
  font-size: 12px;
  color: var(--text-secondary);
}

.pv-changes-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.pv-change-list {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.pv-change-list :deep(.el-table__row) {
  cursor: pointer;
}

.pv-size {
  font-size: 12px;
  color: var(--text-secondary);
}

.pv-diff-pane {
  flex: none;
  width: 45%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-soft);
  min-height: 0;
}

.pv-diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 4px 12px;
  border-bottom: 1px solid var(--border-soft);
}

.pv-diff-path {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.pv-diff-loading {
  padding: 24px;
  text-align: center;
}

.pv-diff-note {
  padding: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.pv-diff-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.pv-diff-line {
  display: flex;
  white-space: pre-wrap;
  word-break: break-all;
}

.pv-diff-line.is-add {
  background: var(--el-color-success-light-9);
}

.pv-diff-line.is-del {
  background: var(--el-color-danger-light-9);
}

.pv-diff-line.is-hunk {
  color: var(--text-secondary);
  background: var(--bg-muted);
}

.pv-diff-sign {
  flex: none;
  width: 20px;
  text-align: center;
  color: var(--text-secondary);
  user-select: none;
}

.pv-diff-text {
  flex: 1;
  padding: 0 8px;
}

.pv-commit-bar {
  display: flex;
  gap: 8px;
  flex: none;
  padding: 8px 16px;
  border-top: 1px solid var(--border-soft);
}

.pv-dock {
  flex: none;
  height: 240px;
  display: flex;
}

.pv-dock-timeline {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-soft);
}

.pv-dock-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 16px;
}

.pv-timeline {
  padding-left: 4px;
}

.pv-commit-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.pv-commit-item code {
  font-size: 12px;
  color: var(--text-secondary);
}

.pv-dock-remote {
  flex: none;
  width: 380px;
  display: flex;
  flex-direction: column;
}

.pv-remote-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  overflow: auto;
}

.pv-remote-row {
  display: flex;
  gap: 8px;
}

.pv-remote-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
