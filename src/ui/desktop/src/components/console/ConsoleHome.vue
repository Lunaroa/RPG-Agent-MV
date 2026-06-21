<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Collection, Connection, Document, Setting, Tickets } from '@element-plus/icons-vue';
import { useProjectStore } from '../../stores/project';
import type { ConsolePage } from '../../stores/workbenchUi';
import StoryProjectIdentityControl from './StoryProjectIdentityControl.vue';
import ProjectAccessControl from './ProjectAccessControl.vue';
import { useI18n, type MessageKey } from '../../i18n';

const props = defineProps<{
  assetCount: number;
  sessionCount: number;
  projectItemCount: number;
  databaseCount: number;
  audioCount: number;
  projectStatsError: string | null;
}>();
const emit = defineEmits<{ navigate: [page: ConsolePage] }>();
const projectStore = useProjectStore();
const { t } = useI18n();

const kpis = computed(() => [
  { label: 'STATIC ASSETS', caption: t('console.home.kpiStaticAssets'), value: props.assetCount },
  { label: 'PROJECT DATA', caption: props.projectStatsError ? t('console.home.kpiReadFailed') : t('console.home.kpiProjectData'), value: props.projectStatsError ? '!' : props.projectItemCount },
  { label: 'SESSIONS', caption: t('console.home.kpiSessions'), value: props.sessionCount },
  { label: 'AUDIO', caption: props.projectStatsError ? t('console.home.kpiReadFailed') : t('console.home.kpiAudio'), value: props.projectStatsError ? '!' : props.audioCount },
]);

const cards = [
  { page: 'assets' as const, titleKey: 'settings.console.assets', descKey: 'console.home.assetsDesc', icon: Collection, tone: 'purple' },
  { page: 'story' as const, titleKey: 'settings.console.story', descKey: 'console.home.storyDesc', icon: Tickets, tone: 'green' },
  { page: 'plugins' as const, titleKey: 'settings.console.plugins', descKey: 'console.home.pluginsDesc', icon: Connection, tone: 'blue' },
  { page: 'logs' as const, titleKey: 'settings.console.logs', descKey: 'console.home.logsDesc', icon: Document, tone: 'amber' },
  { page: 'settings' as const, titleKey: 'settings.console.settings', descKey: 'console.home.settingsDesc', icon: Setting, tone: 'gray' },
] satisfies Array<{ page: ConsolePage; titleKey: MessageKey; descKey: MessageKey; icon: Component; tone: string }>;
</script>

<template>
  <section class="console-home" data-ui-id="console-home">
    <header>
      <div class="hero-copy">
        <h1>{{ t('settings.console.home') }}</h1>
      </div>
      <div class="home-actions">
        <div class="engine-pill"><span />{{ t('console.home.engineReady') }}</div>
        <ProjectAccessControl />
        <StoryProjectIdentityControl v-if="projectStore.currentProject" :project="projectStore.currentProject" />
      </div>
    </header>

    <div v-if="!projectStore.currentProject" class="project-onboarding">
      <strong>{{ t('console.home.onboardingTitle') }}</strong>
      <span>{{ t('console.home.onboardingBody') }}</span>
    </div>

    <div class="kpi-strip" :aria-label="t('console.home.kpiAria')">
      <div v-for="item in kpis" :key="item.label" class="kpi-item">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <small>{{ item.caption }}</small>
      </div>
    </div>

    <div class="card-grid" :class="{ 'has-five': cards.length === 5 }">
      <button
        v-for="card in cards"
        :key="card.page"
        type="button"
        class="home-card"
        :data-ui-id="`console-card-${card.page}`"
        @click="emit('navigate', card.page)"
      >
        <span class="card-top">
          <span class="card-icon" :class="card.tone"><component :is="card.icon" /></span>
          <span class="card-arrow">→</span>
        </span>
        <span class="card-body">
          <strong>{{ t(card.titleKey) }}</strong><small>{{ t(card.descKey) }}</small>
          <span class="stats" v-if="card.page === 'assets'"><b>{{ assetCount }}</b> {{ t('console.home.statsStaticAssets') }}</span>
          <span class="stats error" v-else-if="card.page === 'story' && projectStatsError">{{ t('console.home.statsProjectFailed') }}</span>
          <span class="stats" v-else-if="card.page === 'story'"><b>{{ databaseCount }}</b> {{ t('console.home.statsDatabase') }} · <b>{{ audioCount }}</b> {{ t('console.home.statsAudio') }}</span>
          <span class="stats" v-else-if="card.page === 'plugins'">{{ t('console.home.statsPlugins') }}</span>
          <span class="stats" v-else-if="card.page === 'logs'"><b>{{ sessionCount }}</b> {{ t('console.home.statsSessions') }}</span>
          <span class="stats" v-else>{{ t('console.home.statsSettings') }}</span>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.console-home{width:100%;max-width:1260px;margin:0 auto;padding:34px 40px 46px;overflow:auto}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:26px}.hero-copy{max-width:560px}h1{margin:0;color:var(--console-text,#211d17);font-size:28px;line-height:1.1;font-weight:650;letter-spacing:-.01em}p{margin:6px 0 0;color:var(--console-text-faint,#b3a795);font-family:var(--app-font-mono);font-size:12px}.home-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.engine-pill{height:34px;display:flex;align-items:center;gap:7px;padding:0 12px;border:1px solid #cfe2cd;border-radius:9px;background:#e6f0e5;color:#3f7a4d;font-size:12.5px;font-weight:600;white-space:nowrap}.engine-pill span{width:7px;height:7px;border-radius:50%;background:#4e8a5b}.project-onboarding{display:grid;gap:5px;margin:-8px 0 22px;padding:14px 16px;border:1px solid var(--console-border,#e4dcce);border-radius:12px;background:var(--console-paper,#fffdfa);color:var(--console-text-muted,#9a8e7e);font-size:13px}.project-onboarding strong{color:var(--console-text,#211d17);font-weight:650}.kpi-strip{display:flex;overflow:hidden;margin-bottom:24px;border:1px solid var(--console-border,#e4dcce);border-radius:14px;background:var(--console-paper,#fffdfa)}.kpi-item{flex:1;min-width:0;padding:18px 22px;border-right:1px solid #efe7d9}.kpi-item:last-child{border-right:0}.kpi-item span{display:block;color:var(--console-text-faint,#b3a795);font-family:var(--app-font-mono);font-size:9.5px;font-weight:600;letter-spacing:.12em}.kpi-item strong{display:block;margin-top:7px;color:var(--console-text,#211d17);font-size:30px;font-weight:650;line-height:1}.kpi-item small{display:block;margin-top:4px;color:var(--console-text-muted,#9a8e7e);font-size:11.5px}.card-grid,.card-grid.has-five{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.home-card{position:relative;display:flex;min-height:204px;flex-direction:column;padding:20px;border:1px solid var(--console-border,#e4dcce);border-radius:14px;background:var(--console-paper,#fffdfa);box-shadow:none;color:var(--console-text,#211d17);text-align:left;cursor:pointer;transition:transform .18s var(--app-ease),border-color .18s var(--app-ease),box-shadow .18s var(--app-ease)}.home-card:hover{transform:translateY(-2px);border-color:#d2a88c;box-shadow:var(--console-shadow,0 14px 30px -18px rgba(80,50,25,.4))}.home-card:focus-visible{outline:none;box-shadow:var(--app-ring),var(--console-shadow,0 14px 30px -18px rgba(80,50,25,.4))}.card-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px}.card-arrow{color:#c9bdab;font-size:22px;line-height:1}.card-icon{width:42px;height:42px;display:grid;place-items:center;flex:0 0 42px;border-radius:12px}.card-icon :deep(svg){width:21px}.purple{background:#f7e7dc;color:#be5630}.green{background:#e4efe2;color:#4e8a5b}.blue{background:#e2e9f2;color:#4a6fa5}.amber{background:#f4ebd8;color:#c28a2e}.orange{background:#ece6f1;color:#7a6098}.gray{background:#f0ede8;color:#746b5f}.card-body{min-width:0;display:flex;flex:1;flex-direction:column}.card-body strong{color:var(--console-text,#211d17);font-size:18px;font-weight:650}.card-body small{margin:9px 0 18px;color:var(--console-text-muted,#9a8e7e);font-size:13px;line-height:1.55}.stats{display:flex;flex-wrap:wrap;gap:5px;margin-top:auto;color:var(--console-text-muted,#9a8e7e);font-size:12px}.stats b{color:var(--console-text,#211d17);font-size:16px;font-weight:650}.stats.error{color:var(--app-danger)}@media(max-width:1060px){.card-grid,.card-grid.has-five{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi-strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.kpi-item{border-bottom:1px solid #efe7d9}}@media(max-width:760px){.console-home{padding:24px}header{align-items:flex-start;flex-direction:column}.home-actions{width:100%;align-items:stretch;flex-direction:column}.card-grid,.card-grid.has-five{grid-template-columns:1fr}.kpi-strip{grid-template-columns:1fr}.kpi-item{border-right:0}}

.console-home {
  padding-top: 78px;
}

header {
  flex-wrap: nowrap;
}

.hero-copy {
  min-width: 220px;
}

.home-actions {
  min-width: 0;
  flex: 1 1 auto;
  flex-wrap: nowrap;
}

.home-actions :deep(.project-access) {
  min-width: 0;
}

.home-actions :deep(.project-access-main) {
  flex-wrap: nowrap;
  justify-content: flex-end;
}

.home-actions :deep(.project-access-main > label),
.home-actions :deep(.project-access-main > .icon-button) {
  flex: 0 0 auto;
}

.home-actions :deep(.project-access-main > .icon-button) {
  white-space: nowrap;
}

.home-actions :deep(.project-picker) {
  width: clamp(190px, 24vw, 360px);
}

.home-actions :deep(.story-identity) {
  flex: 0 0 auto;
  flex-wrap: nowrap;
}

@media(max-width:760px){
  .home-actions {
    flex-wrap: wrap;
  }
}
</style>
