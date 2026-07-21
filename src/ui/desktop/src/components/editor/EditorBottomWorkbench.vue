<template>
  <section class="bottom-workbench" :class="{ collapsed: !open }">
    <header class="workbench-tabs">
      <button type="button" class="workbench-tab active" :aria-expanded="open" @click="$emit('toggle')">
        <span>{{ title }}</span>
        <span v-if="badge" class="tab-badge" :class="{ empty: badgeEmpty }">{{ badge }}</span>
      </button>
      <div class="workbench-spacer" />
      <slot name="actions" />
      <button
        type="button"
        class="collapse-button"
        :title="open ? collapseLabel : expandLabel"
        :aria-label="open ? collapseLabel : expandLabel"
        :aria-expanded="open"
        @click="$emit('toggle')"
      >
        <ArrowDown v-if="open" />
        <ArrowUp v-else />
      </button>
    </header>
    <div v-show="open" class="workbench-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue';

defineProps<{
  open: boolean;
  title: string;
  badge?: string;
  badgeEmpty?: boolean;
  collapseLabel: string;
  expandLabel: string;
}>();

defineEmits<{ toggle: [] }>();
</script>

<style scoped>
.bottom-workbench{height:200px;min-height:36px;flex-shrink:0;display:flex;flex-direction:column;background:var(--app-bg);transition:height 250ms var(--app-ease)}
.bottom-workbench.collapsed{height:36px}
.workbench-tabs{height:36px;flex-shrink:0;display:flex;align-items:center;padding:0 8px;background:var(--app-bg)}
.workbench-tab{height:100%;padding:0 10px;display:flex;align-items:center;gap:5px;border:0;background:none;color:var(--app-ink);font-family:inherit;font-size:11px;font-weight:600;cursor:pointer}
.workbench-tab:hover{color:var(--app-ink-soft)}
.workbench-tab:focus-visible,.collapse-button:focus-visible{outline:2px solid var(--app-accent);outline-offset:-2px}
.tab-badge{min-width:14px;height:18px;padding:0 3px;display:grid;place-items:center;border-radius:var(--app-radius-pill);background:var(--app-accent-soft);color:var(--app-accent);font-size:10px;font-weight:700}
.tab-badge.empty{background:var(--app-bg-soft);color:var(--app-ink-muted)}
.workbench-spacer{flex:1}
.collapse-button{width:26px;height:26px;display:grid;place-items:center;border:0;border-radius:var(--app-radius-sm);background:transparent;color:var(--app-ink-muted);cursor:pointer}
.collapse-button:hover{background:var(--app-bg-sunken);color:var(--app-ink)}
.collapse-button :deep(svg){width:12px;height:12px}
.workbench-body{min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
@media (prefers-reduced-motion:reduce){.bottom-workbench{transition:none}}
</style>
