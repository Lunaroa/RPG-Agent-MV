<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Grid, Monitor, Setting } from '@element-plus/icons-vue'

const route = useRoute()

const items = [
  { path: '/workbench', label: '编辑器', icon: Grid, uiId: 'nav-workbench' },
  { path: '/console', label: '控制台', icon: Monitor, uiId: 'nav-console' },
]

const activePath = computed(() => route.path === '/console' ? '/console' : '/workbench')
</script>

<template>
  <aside class="app-rail" aria-label="全局导航">
    <nav class="app-rail-primary">
      <router-link
        v-for="item in items"
        :key="item.path"
        :to="item.path"
        class="app-rail-item"
        :data-ui-id="item.uiId"
        :class="{ active: activePath === item.path }"
        :title="item.label"
        :aria-label="item.label"
        :aria-current="activePath === item.path ? 'page' : undefined"
      >
        <component :is="item.icon" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
    <router-link
      :to="{ path: '/console', query: { page: 'settings' } }"
      class="app-rail-item app-rail-settings"
      data-ui-id="nav-settings"
      title="设置"
      aria-label="设置"
    >
      <Setting />
      <span>设置</span>
    </router-link>
  </aside>
</template>

<style scoped>
.app-rail {
  position: relative;
  z-index: 10;
  width: var(--app-rail-width);
  min-width: var(--app-rail-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: transparent;
}

.app-rail-primary {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
}

.app-rail-item {
  position: relative;
  width: 50px;
  min-height: 48px;
  padding: 6px 2px 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: var(--app-radius-md);
  color: var(--app-ink-soft);
  text-decoration: none;
  outline: none;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
  transition:
    background-color var(--app-dur) var(--app-ease),
    color var(--app-dur) var(--app-ease);
}

.app-rail-item :deep(svg) {
  width: 17px;
  height: 17px;
}

.app-rail-item:hover {
  background: var(--app-bg-sunken);
  color: var(--app-ink);
}

.app-rail-item:focus-visible {
  box-shadow: var(--app-ring);
}

.app-rail-item.active {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  background: var(--app-bg-elevated);
  box-shadow: var(--app-shadow-1);
}

.app-rail-settings {
  margin-top: auto;
  margin-bottom: 8px;
}
</style>
