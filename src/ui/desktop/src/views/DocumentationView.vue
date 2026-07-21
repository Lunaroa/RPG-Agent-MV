<template>
  <div class="documentation-window">
    <header class="documentation-toolbar">
      <button type="button" :disabled="historyIndex <= 0" :title="label.back" @click="goHistory(-1)">←</button>
      <button type="button" :disabled="historyIndex >= history.length - 1" :title="label.forward" @click="goHistory(1)">→</button>
      <strong>RPG Agent MV</strong><span>{{ label.documentation }}</span>
    </header>
    <div class="documentation-layout">
      <nav :aria-label="label.contents">
        <section v-for="section in sections" :key="section.title">
          <h2>{{ section.title }}</h2>
          <button v-for="page in section.pages" :key="page.path" type="button" :class="{ active: page.path === currentPath }" @click="navigate(page.path)">{{ page.title }}</button>
        </section>
      </nav>
      <main ref="articleScrollRef" @scroll.passive="saveReadingPosition">
        <article ref="articleRef" class="markdown-body" v-html="html" @click="handleArticleClick" />
        <div v-if="loading" class="doc-state">{{ label.loading }}</div>
        <div v-else-if="error" class="doc-state error">{{ error }}</div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

type ProductLanguage = 'zh-CN' | 'en-US';
interface DocPage { title: string; path: string }
interface DocSection { title: string; pages: DocPage[] }
interface DocContent { path: string; markdown: string }
type DocManifest = Record<ProductLanguage, DocSection[]>;
const props = defineProps<{ initialLanguage?: ProductLanguage }>();
const language = ref<ProductLanguage>(props.initialLanguage === 'zh-CN' ? 'zh-CN' : 'en-US');
const manifest = ref<Record<string, DocSection[]>>({});
const currentPath = ref('');
const html = ref('');
const loading = ref(true);
const error = ref('');
const articleRef = ref<HTMLElement>();
const articleScrollRef = ref<HTMLElement>();
const history = ref<string[]>([]);
const historyIndex = ref(-1);
let removeLanguageListener: (() => void) | null = null;
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
const sections = computed(() => manifest.value[language.value] || []);
const label = computed(() => language.value === 'zh-CN' ? {
  documentation: '文档', contents: '文档目录', back: '后退', forward: '前进', loading: '正在读取文档…',
} : {
  documentation: 'Documentation', contents: 'Contents', back: 'Back', forward: 'Forward', loading: 'Loading documentation…',
});

function normalizedRelativePath(basePath: string, target: string): string | null {
  const clean = target.split('#')[0].replaceAll('\\', '/');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean)) return null;
  const parts = [...basePath.split('/').slice(0, -1), ...clean.split('/')];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!normalized.length) return null;
      normalized.pop();
    } else normalized.push(part);
  }
  return normalized.join('/');
}
function resourceUrl(relative: string): string { return `rpg-agent-doc://docs/${relative.split('/').map(encodeURIComponent).join('/')}`; }
async function renderContent(page: DocContent, anchor = '') {
    currentPath.value = page.path;
    html.value = DOMPurify.sanitize(await marked.parse(page.markdown), {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['srcdoc'],
    });
    await nextTick();
    for (const image of articleRef.value?.querySelectorAll('img') || []) {
      const source = image.getAttribute('src') || '';
      if (/^https?:\/\//i.test(source) || source.startsWith('data:')) {
        image.removeAttribute('src');
        continue;
      }
      const relative = normalizedRelativePath(page.path, source);
      if (relative) image.src = resourceUrl(relative);
      else image.removeAttribute('src');
    }
    await nextTick();
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
    else if (articleScrollRef.value) articleScrollRef.value.scrollTop = Number(localStorage.getItem(positionKey(page.path)) || 0);
}
async function renderPage(path: string, anchor = '') {
  loading.value = true;
  error.value = '';
  try {
    await renderContent(await window.api.documentation.read(path), anchor);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    html.value = '';
  } finally {
    loading.value = false;
  }
}
async function navigate(path: string, anchor = '', record = true) {
  if (record && path !== currentPath.value) {
    history.value = [...history.value.slice(0, historyIndex.value + 1), path];
    historyIndex.value = history.value.length - 1;
  }
  await renderPage(path, anchor);
  if (!error.value) localStorage.setItem(`rpg-agent-doc-last:${language.value}`, path);
}
function goHistory(delta: -1 | 1) {
  const next = historyIndex.value + delta;
  if (next < 0 || next >= history.value.length) return;
  historyIndex.value = next;
  void navigate(history.value[next], '', false);
}
function handleArticleClick(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest('a');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  event.preventDefault();
  if (/^https?:\/\//i.test(href)) {
    void window.api.window.openExternalUrl(href);
    return;
  }
  if (href.startsWith('#')) {
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
    return;
  }
  const [relativeLink, anchor = ''] = href.split('#');
  const relative = normalizedRelativePath(currentPath.value, relativeLink);
  if (relative?.toLocaleLowerCase().endsWith('.md')) void navigate(relative, decodeURIComponent(anchor));
}
function positionKey(path: string) { return `rpg-agent-doc-position:${language.value}:${path}`; }
function saveReadingPosition() {
  if (!currentPath.value || !articleScrollRef.value) return;
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => localStorage.setItem(positionKey(currentPath.value), String(articleScrollRef.value?.scrollTop || 0)), 120);
}
async function setLanguage(next: string) {
  if (next !== 'zh-CN' && next !== 'en-US') return;
  const saved = localStorage.getItem(`rpg-agent-doc-last:${next}`);
  await bootstrap(next, saved || undefined);
}
async function bootstrap(next: ProductLanguage, preferredPath?: string) {
  loading.value = true;
  error.value = '';
  try {
    const result = await window.api.documentation.bootstrap(next, preferredPath);
    language.value = next;
    manifest.value = result.navigation as DocManifest;
    await renderContent(result.page);
    history.value = [result.page.path];
    historyIndex.value = 0;
    localStorage.setItem(`rpg-agent-doc-last:${next}`, result.page.path);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    html.value = '';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  removeLanguageListener = window.api.documentation.onSetLanguage((next) => { void setLanguage(next); });
  const saved = localStorage.getItem(`rpg-agent-doc-last:${language.value}`);
  await bootstrap(language.value, saved || undefined);
});
onUnmounted(() => {
  removeLanguageListener?.();
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  if (currentPath.value && articleScrollRef.value) localStorage.setItem(positionKey(currentPath.value), String(articleScrollRef.value.scrollTop));
});
</script>

<style scoped>
.documentation-window{width:100%;height:100%;display:grid;grid-template-rows:44px minmax(0,1fr);background:var(--app-bg-page);color:var(--app-ink)}.documentation-toolbar{display:flex;align-items:center;gap:7px;padding:0 12px;border-bottom:1px solid var(--app-border);background:var(--app-bg)}.documentation-toolbar button{width:28px;height:28px;border:1px solid var(--app-border);border-radius:4px;background:var(--app-bg);color:var(--app-ink);cursor:pointer}.documentation-toolbar button:disabled{opacity:.35;cursor:not-allowed}.documentation-toolbar strong{margin-left:6px;font-size:13px}.documentation-toolbar span{color:var(--app-ink-muted);font-size:11px}.documentation-layout{min-height:0;display:grid;grid-template-columns:245px minmax(0,1fr)}nav{min-height:0;padding:14px 10px;overflow:auto;border-right:1px solid var(--app-border);background:var(--app-bg)}nav section+section{margin-top:17px}nav h2{margin:0 8px 5px;color:var(--app-ink-muted);font-size:10px;letter-spacing:.07em;text-transform:uppercase}nav button{width:100%;min-height:29px;padding:5px 8px;border:0;border-radius:3px;background:transparent;color:var(--app-ink-soft);font:inherit;font-size:11px;text-align:left;cursor:pointer}nav button:hover{background:var(--app-bg-soft)}nav button.active{background:var(--app-accent-soft);color:var(--app-accent);font-weight:700}main{min-height:0;overflow:auto;scroll-behavior:smooth}.markdown-body{box-sizing:border-box;max-width:860px;margin:0 auto;padding:42px 56px 90px;font-size:14px;line-height:1.75}.markdown-body :deep(h1){margin:0 0 24px;font-size:28px;line-height:1.25}.markdown-body :deep(h2){margin:34px 0 14px;padding-bottom:7px;border-bottom:1px solid var(--app-border);font-size:20px}.markdown-body :deep(h3){margin:26px 0 10px;font-size:16px}.markdown-body :deep(p){margin:10px 0}.markdown-body :deep(a){color:var(--app-accent);text-decoration:none}.markdown-body :deep(a:hover){text-decoration:underline}.markdown-body :deep(code){padding:2px 5px;border-radius:3px;background:var(--app-bg-sunken);font:12px var(--app-font-mono)}.markdown-body :deep(pre){padding:14px;overflow:auto;border:1px solid var(--app-border);border-radius:5px;background:#151a20;color:#d8dee7}.markdown-body :deep(pre code){padding:0;background:transparent;color:inherit}.markdown-body :deep(img){max-width:100%;height:auto;border:1px solid var(--app-border);border-radius:5px}.markdown-body :deep(blockquote){margin:16px 0;padding:2px 14px;border-left:3px solid var(--app-accent);color:var(--app-ink-soft)}.markdown-body :deep(table){width:100%;border-collapse:collapse}.markdown-body :deep(th),.markdown-body :deep(td){padding:7px 9px;border:1px solid var(--app-border);text-align:left}.doc-state{padding:40px;color:var(--app-ink-muted);text-align:center}.doc-state.error{color:var(--app-danger)}
@media(max-width:760px){.documentation-layout{grid-template-columns:190px minmax(0,1fr)}.markdown-body{padding:30px 28px 70px}}
</style>
