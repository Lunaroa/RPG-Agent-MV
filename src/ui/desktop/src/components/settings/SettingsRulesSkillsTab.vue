<template>
  <div class="capabilities-tab">
    <h3>规则与技能</h3>
    <p class="desc">运行策略、技能与 Agent 规则一览。</p>

    <div v-if="store.lastError" class="alert alert-error">
      <span class="alert-icon">!</span> {{ store.lastError }}
    </div>

    <div class="meta-bar">
      <button class="workbench-button" :disabled="loading" @click="reload">
        {{ loading ? '加载中…' : '刷新' }}
      </button>
    </div>

    <section class="cap-section">
      <div class="section-head">
        <h4>运行策略</h4>
        <span class="section-hint">工具白名单与禁止项（deny 只读）</span>
      </div>
      <div v-if="policyNote" class="policy-note">{{ policyNote }}</div>
      <div class="policy-stats">
        <span class="pill">allow: {{ policy?.allowCount ?? 0 }}</span>
        <span class="pill pill-danger">deny: {{ policy?.denyCount ?? 0 }}</span>
      </div>
      <div v-if="policy?.deny?.length" class="deny-list">
        <div v-for="item in policy.deny" :key="item" class="deny-item mono">{{ item }}</div>
      </div>
    </section>

    <section class="cap-section">
      <div class="section-head">
        <h4>Skills</h4>
        <span class="section-hint">opencode：来自 config/opencode/skills（原生加载，不可在此开关）</span>
      </div>
      <div v-for="skill in skills" :key="skill.path" class="skill-card">
        <div class="skill-main">
          <div class="skill-title">{{ skill.title }}</div>
          <div class="skill-desc">{{ skill.description }}</div>
          <div class="skill-meta mono">{{ skill.path }}</div>
        </div>
        <div class="skill-actions">
          <span v-if="skill.enabled" class="pill pill-ok pill-sm">原生</span>
          <label v-else class="toggle" :class="{ 'is-loading': toggleLoading === skill.path }">
            <input
              type="checkbox"
              :checked="skill.enabled"
              :disabled="toggleLoading === skill.path"
              @change="onToggleSkill(skill.path, ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
          </label>
          <button class="workbench-link" @click="openPath(skill.absolutePath)">打开</button>
        </div>
      </div>
      <form class="new-skill-form" @submit.prevent="createSkill">
        <label>
          <span>名称</span>
          <input v-model.trim="newSkillName" autocomplete="off" placeholder="event-pacing" />
        </label>
        <label class="description-field">
          <span>描述</span>
          <input v-model.trim="newSkillDescription" autocomplete="off" placeholder="说明这个 skill 什么时候应该被使用" />
        </label>
        <button class="workbench-button" :disabled="creatingSkill || !newSkillName || !newSkillDescription">
          {{ creatingSkill ? '创建中…' : '+ 新建 Skill' }}
        </button>
      </form>
    </section>

    <section class="cap-section">
      <div class="section-head">
        <h4>参考文档</h4>
        <span class="section-hint">config/opencode/AGENTS.md（运行时同步到 .opencode）与 docs 手册；skills 在 config/opencode/skills</span>
      </div>
      <div v-for="group in ruleGroups" :key="group.category" class="rule-group">
        <div class="group-title">{{ group.category }}</div>
        <div v-for="rule in group.items" :key="rule.id" class="rule-row">
          <div>
            <div class="rule-title">{{ rule.title }}</div>
            <div class="rule-meta mono">{{ rule.path }}</div>
          </div>
          <button class="workbench-link" @click="openPath(rule.absolutePath)">打开</button>
        </div>
      </div>
    </section>

    <!-- Toast notifications -->
    <Teleport to="body">
      <div class="toast-stack">
        <TransitionGroup name="toast">
          <div v-for="t in toasts" :key="t.id" class="toast-item" :class="'toast-' + t.type">
            {{ t.message }}
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { settings } from '../../api/client'
import { useSettingsStore } from '../../stores/settings'
import type { RuleSnapshot } from '../../api/client'

const store = useSettingsStore()
const loading = ref(false)
const toggleLoading = ref<string | null>(null)
const creatingSkill = ref(false)
const newSkillName = ref('')
const newSkillDescription = ref('')

/* ---- Toast system (replaces ElMessage) ---- */
type ToastType = 'success' | 'error' | 'warn' | 'info'
const toasts = ref<Array<{ id: number; type: ToastType; message: string }>>([])
let _toastId = 0
function toast(type: ToastType, message: string) {
  const id = ++_toastId
  toasts.value.push({ id, type, message })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3000)
}

const snapshot = computed(() => store.agentCapabilities)
const policy = computed(() => snapshot.value?.agentPolicy)
const policyNote = computed(() => policy.value?.note || null)
const skills = computed(() => snapshot.value?.skills || [])

const ruleGroups = computed(() => {
  const rules = snapshot.value?.rules || []
  const map = new Map<string, RuleSnapshot[]>()
  for (const rule of rules) {
    const cat = rule.category || 'rules'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(rule)
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }))
})

async function reload() {
  loading.value = true
  try {
    await store.loadAgentCapabilities()
  } catch {
    toast('error', '加载规则与技能失败')
  } finally {
    loading.value = false
  }
}

async function onToggleSkill(skillPath: string, enabled: boolean) {
  toggleLoading.value = skillPath
  try {
    await store.saveAgentSkillEnabled(skillPath, enabled)
    toast('success', enabled ? '已启用技能' : '已禁用技能')
  } catch {
    toast('error', '更新技能失败')
  } finally {
    toggleLoading.value = null
  }
}

async function createSkill() {
  creatingSkill.value = true
  try {
    await settings.createSkill(newSkillName.value, newSkillDescription.value)
    newSkillName.value = ''
    newSkillDescription.value = ''
    await store.loadAgentCapabilities()
    toast('success', '已新建 Skill')
  } catch (error) {
    toast('error', `新建 Skill 失败：${(error as Error).message}`)
  } finally {
    creatingSkill.value = false
  }
}

async function openPath(filePath: string) {
  try {
    await store.openCapabilityPath(filePath)
  } catch {
    toast('error', '无法打开文件')
  }
}

onMounted(() => {
  if (!store.agentCapabilities) reload()
})
</script>

<style scoped>
.capabilities-tab {
  padding: 0;
}

.capabilities-tab h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 650;
  color: var(--app-ink);
}

.capabilities-tab .desc {
  color: var(--app-ink-soft);
  margin: 0 0 16px;
  font-size: 13px;
}

/* Alert */
.alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--app-radius-sm);
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.5;
}

.alert-icon {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
}

.alert-error {
  background: var(--app-danger-soft);
  color: var(--app-danger);
}

.alert-error .alert-icon {
  background: var(--app-danger);
  color: var(--app-bg);
}

/* Meta bar */
.meta-bar {
  margin-bottom: 12px;
}

/* Pills (replace el-tag) */
.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: var(--app-radius-pill);
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--app-border);
  color: var(--app-ink-soft);
  background: var(--app-bg-soft);
  white-space: nowrap;
}

.pill-info {
  border-color: var(--app-accent);
  color: var(--app-accent);
  background: var(--app-accent-soft);
}

.pill-danger {
  border-color: var(--app-danger);
  color: var(--app-danger);
  background: var(--app-danger-soft);
}

.pill-ok {
  border-color: var(--app-ok);
  color: var(--app-ok);
  background: var(--app-ok-soft);
}

.pill-sm {
  font-size: 11px;
  padding: 1px 7px;
}

/* Sections */
.cap-section {
  margin-bottom: 28px;
}

.section-head {
  margin-bottom: 12px;
}

.section-head h4 {
  margin: 0;
  font-size: 15px;
  color: var(--app-ink);
}

.section-hint {
  display: block;
  font-size: 12px;
  color: var(--app-ink-soft);
  margin-top: 4px;
}

/* Policy */
.policy-note {
  padding: 12px;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-sunken);
  font-size: 13px;
  margin-bottom: 12px;
  white-space: pre-wrap;
  color: var(--app-ink-soft);
  line-height: 1.5;
}

.policy-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.deny-list {
  margin-bottom: 12px;
}

.deny-item {
  font-size: 12px;
  padding: 4px 0;
  color: var(--app-danger);
}

/* Skill cards & rule rows */
.skill-card,
.rule-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  margin-bottom: 8px;
}

.skill-card:hover,
.rule-row:hover {
  background: var(--app-bg-sunken);
}

.skill-title,
.rule-title {
  font-weight: 600;
  color: var(--app-ink);
}

.skill-desc,
.skill-meta,
.rule-meta {
  font-size: 12px;
  color: var(--app-ink-soft);
  margin-top: 4px;
}

.skill-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.new-skill-form {
  display: grid;
  grid-template-columns: minmax(150px, 220px) minmax(260px, 1fr) auto;
  gap: 8px;
  align-items: end;
  margin-top: 10px;
}

.new-skill-form label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--app-ink-soft);
  font-size: 11px;
}

.new-skill-form input {
  min-width: 0;
  height: 32px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
}

.new-skill-form input:focus {
  outline: none;
  box-shadow: var(--app-ring);
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  margin: 12px 0 8px;
  color: var(--app-ink-soft);
}

.mono {
  font-family: var(--app-font-mono);
}

/* Link button (text-style button) */
.workbench-link {
  background: none;
  border: none;
  color: var(--app-accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--app-radius-sm);
}

.workbench-link:hover {
  background: var(--app-accent-soft);
}

/* Toggle switch */
.toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle.is-loading {
  opacity: 0.5;
  pointer-events: none;
}

.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-pill);
  position: relative;
  transition: background var(--app-dur) var(--app-ease), border-color var(--app-dur) var(--app-ease);
}

.toggle-thumb {
  width: 14px;
  height: 14px;
  background: var(--app-ink-muted);
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform var(--app-dur) var(--app-ease), background var(--app-dur) var(--app-ease);
}

.toggle input:checked + .toggle-track {
  background: var(--app-accent-soft);
  border-color: var(--app-accent);
}

.toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(16px);
  background: var(--app-accent);
}

/* Toast stack */
.toast-stack {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  padding: 8px 16px;
  border-radius: var(--app-radius-sm);
  font-size: 13px;
  font-family: var(--app-font-mono);
  border: 1px solid;
  pointer-events: auto;
  max-width: 420px;
  line-height: 1.4;
}

.toast-success {
  background: var(--app-ok-soft);
  color: var(--app-ok);
  border-color: var(--app-ok);
}

.toast-error {
  background: var(--app-danger-soft);
  color: var(--app-danger);
  border-color: var(--app-danger);
}

.toast-warn {
  background: var(--app-warn-soft);
  color: var(--app-warn);
  border-color: var(--app-warn);
}

.toast-info {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  border-color: var(--app-accent);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
