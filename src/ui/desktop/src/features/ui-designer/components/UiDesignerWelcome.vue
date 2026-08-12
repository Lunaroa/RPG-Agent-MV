<script setup lang="ts">
import { ref } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { documentation, system } from '../../../api/client'

const props = defineProps<{ designer: UiDesignerController }>()
const emit = defineEmits<{ newScene: [] }>()
const designer = props.designer
const { t, language } = useUiDesignerI18n()
const learningError = ref('')
const learningTechnicalError = ref('')
const templateLabels: Record<string, UiDesignerMessageKey> = {
  'builtin:title': 'sceneTemplateTitle', 'builtin:menu': 'sceneTemplateMenu', 'builtin:dialog': 'sceneTemplateDialog', 'builtin:scrolling-credits': 'sceneTemplateScrollingCredits', 'builtin:portrait-frame': 'sceneTemplatePortraitFrame', 'builtin:status-bars': 'sceneTemplateStatusBars', 'builtin:game-over': 'sceneTemplateGameOver', 'builtin:save-slots': 'sceneTemplateSaveSlots', 'builtin:hud-bars': 'sceneTemplateHudBars', 'builtin:item-tooltip': 'sceneTemplateItemTooltip', 'builtin:choice-menu': 'sceneTemplateChoiceMenu', 'builtin:logo-animation': 'sceneTemplateLogoAnimation',
}
const templateLabel = (name: string) => templateLabels[name] ? t(templateLabels[name]) : name
const openDocs = async () => {
  learningError.value = ''
  learningTechnicalError.value = ''
  try { await documentation.open(language.value) } catch (error) { learningError.value = t('learningOpenFailed'); learningTechnicalError.value = error instanceof Error ? error.message : String(error) }
}
const openExternalLearning = async (url: string) => {
  learningError.value = ''
  learningTechnicalError.value = ''
  try {
    const result = await system.openExternalUrl(url)
    if (!result.ok) { learningError.value = t('learningOpenFailed'); learningTechnicalError.value = 'External navigation was rejected.' }
  } catch (error) { learningError.value = t('learningOpenFailed'); learningTechnicalError.value = error instanceof Error ? error.message : String(error) }
}
const openExamples = () => void openExternalLearning(language.value === 'zh-CN' ? 'https://github.com/Lunaroa/RPG-Agent-MV/blob/master/docs/1-getting-started/1.4-quickstart.md' : 'https://github.com/Lunaroa/RPG-Agent-MV/blob/master/docs/en/getting-started/quickstart.md')
const openChangelog = () => void openExternalLearning('https://github.com/Lunaroa/RPG-Agent-MV/releases')
const formatDate = (value?: string) => {
  if (!value) return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(language.value) : value
}
</script>

<template>
  <section class="welcome-panel" data-ui-id="ui-designer-welcome" data-testid="ui-designer-welcome">
    <div class="welcome-mark">UI</div>
    <h2>{{ t('welcomeTitle') }}</h2>
    <p>{{ t('welcomeBody') }}</p>
    <div class="welcome-actions">
      <el-button data-ui-id="ui-designer-welcome-new-scene" data-testid="ui-designer-new" type="primary" @click="emit('newScene')">{{ t('newScene') }}</el-button>
      <el-button data-testid="ui-designer-open" :disabled="!designer.canSave" @click="void designer.open()">{{ t('open') }}</el-button>
    </div>
    <el-alert v-if="!designer.canSave" type="info" :closable="false" :title="t('adapterRequired')" />
    <el-alert v-else-if="!designer.hasProject" type="info" :closable="false" :title="t('projectRequired')" />
    <div v-if="designer.recentFiles.length" class="welcome-list">
      <div class="list-title">{{ t('recentFiles') }}</div>
      <div v-for="(item, index) in designer.recentFiles.slice(0, 8)" :key="item.sourcePath" class="welcome-row">
        <button :data-testid="`ui-designer-recent-open-${index}`" type="button" :disabled="!item.exists" @click="void designer.open({ path: item.sourcePath })">
          <span class="recent-name">{{ item.sceneName || item.sourcePath }}</span>
          <span class="recent-meta">{{ item.exists ? item.sourcePath : t('recentMissing') }} · {{ t('openedAt') }} {{ formatDate(item.lastOpenedAt) }}<template v-if="item.lastSavedAt"> · {{ t('savedAt') }} {{ formatDate(item.lastSavedAt) }}</template></span>
        </button>
        <el-button :data-testid="`ui-designer-recent-remove-${index}`" size="small" text @click="void designer.removeRecentFile(item.sourcePath)">{{ t('removeRecent') }}</el-button>
      </div>
    </div>
    <div v-if="designer.recoveryRecords.length" class="welcome-list">
      <div class="list-title">{{ t('recovery') }}</div>
      <div v-for="item in designer.recoveryRecords" :key="item.id" class="welcome-row"><span>{{ item.sourcePath || t('recoveryUnnamed') }}</span><el-button size="small" text @click="void designer.restoreRecovery(item.id)">{{ t('recover') }}</el-button><el-button size="small" text @click="void designer.removeRecovery(item.id)">{{ t('removeRecovery') }}</el-button></div>
    </div>
    <div v-if="designer.templates.length || designer.canSave" class="welcome-list">
      <div class="list-title">{{ t('sceneTemplates') }}</div>
      <div v-for="(item, index) in designer.templates" :key="item" class="welcome-row"><span>{{ templateLabel(item) }}</span><el-button :data-testid="`ui-designer-template-load-${index}`" size="small" text @click="void designer.loadTemplate(item)">{{ t('loadTemplate') }}</el-button></div>
    </div>
    <div class="welcome-list learning-list">
      <div class="list-title">{{ t('learning') }}</div>
      <div class="learning-actions">
        <el-button size="small" text @click="void openDocs()">{{ t('learningDocs') }}</el-button>
        <el-button size="small" text @click="openExamples">{{ t('learningExamples') }}</el-button>
        <el-button size="small" text @click="void openChangelog()">{{ t('learningChangelog') }}</el-button>
      </div>
      <el-alert v-if="learningError" type="warning" :closable="false" :title="learningError"><details v-if="learningTechnicalError" class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ learningTechnicalError }}</span></details></el-alert>
    </div>
  </section>
</template>

<style scoped>
.welcome-panel { display: flex; flex-direction: column; align-items: center; gap: 9px; width: min(470px, 92%); padding: 38px; border: 1px solid var(--app-border); border-radius: 8px; background: color-mix(in srgb, var(--app-bg) 94%, var(--app-accent) 6%); text-align: center; }
.welcome-mark { display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--app-accent); border-radius: 12px; color: var(--app-accent); font-weight: 750; }
h2 { margin: 0; font-size: 19px; }
p { margin: 0; max-width: 380px; color: var(--app-ink-soft); font-size: 12px; line-height: 1.6; }
.welcome-actions { display: flex; gap: 8px; margin-top: 6px; }
.welcome-panel .el-alert { margin-top: 8px; text-align: left; }
.welcome-list { width: 100%; margin-top: 10px; text-align: left; }.list-title { margin-bottom: 5px; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; }.welcome-row { display: flex; align-items: center; gap: 8px; min-height: 28px; border-top: 1px solid var(--app-border); font-size: 11px; }.welcome-row > button { flex: 1; overflow: hidden; border: 0; background: none; color: var(--app-ink); cursor: pointer; text-align: left; text-overflow: ellipsis; white-space: nowrap; }.welcome-row > button:disabled { color: var(--app-ink-soft); cursor: not-allowed; }.welcome-row > span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.recent-name, .recent-meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.recent-meta { color: var(--app-ink-soft); font-size: 10px; }
.learning-actions { display: flex; flex-wrap: wrap; gap: 2px; border-top: 1px solid var(--app-border); }
</style>
