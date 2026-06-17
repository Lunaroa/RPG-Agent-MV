import { ref, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import EventEditorDialog from '../components/editor/EventEditorDialog.vue';
import {
  events as eventsApi,
  maps as mapsApi,
  projectAssets,
  resolveAssetUrl,
  storyPages,
  type EditorProjectCatalog,
  type StoryEventOverview,
} from '../api/client';
import { clone, findEditorMapEvent, type MvEditorEvent } from './useEventEditor';

function loadBitmap(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function usePmEventEditor(projectId: () => string, onSaved?: () => void | Promise<void>) {
  const eventDialogOpen = ref(false);
  const eventDialogRef = ref<InstanceType<typeof EventEditorDialog> | null>(null);
  const eventDraft = ref<MvEditorEvent | null>(null);
  const eventOverview = ref<StoryEventOverview | null>(null);
  const eventSaving = ref(false);
  const eventLoading = ref(false);
  const editorMapId = ref<number | null>(null);
  const systemData = ref<{ switches: string[]; variables: string[] } | null>(null);
  const editorCatalog = ref<EditorProjectCatalog | null>(null);
  const tilesetImages = shallowRef<(HTMLImageElement | null)[]>([]);

  let catalogPromise: Promise<EditorProjectCatalog | null> | null = null;

  async function ensureCatalog() {
    if (editorCatalog.value) return editorCatalog.value;
    if (!catalogPromise) {
      catalogPromise = projectAssets.editorCatalog(projectId())
        .then((catalog) => {
          editorCatalog.value = catalog;
          return catalog;
        })
        .catch((error) => {
          ElMessage.warning(`事件资源列表加载失败：${(error as Error).message}`);
          return null;
        });
    }
    return catalogPromise;
  }

  async function loadImage(url: string) {
    return loadBitmap(await resolveAssetUrl(url));
  }

  async function preloadTileset(urls: (string | null)[]) {
    const resolved = await Promise.all(urls.map((url) => (url ? resolveAssetUrl(url) : Promise.resolve(null))));
    return Promise.all(resolved.map((url) => (url ? loadBitmap(url) : Promise.resolve(null))));
  }

  async function openMapEventEditor(mapId: number, eventId: number) {
    eventLoading.value = true;
    eventDialogOpen.value = false;
    eventDraft.value = null;
    eventOverview.value = null;
    editorMapId.value = mapId;
    try {
      const [payload] = await Promise.all([
        mapsApi.get(mapId, projectId()),
        ensureCatalog(),
      ]);
      const event = findEditorMapEvent(payload.map.events, eventId);
      if (!event) {
        ElMessage.error('事件不存在');
        return;
      }
      systemData.value = payload.system || null;
      tilesetImages.value = await preloadTileset(payload.tileset?.imageUrls || []);
      try {
        eventOverview.value = await storyPages.inspectEvent(mapId, eventId, projectId());
      } catch {
        eventOverview.value = null;
      }
      eventDraft.value = clone(event);
      eventDialogOpen.value = true;
    } catch (error) {
      ElMessage.error(`打开事件失败：${(error as Error).message}`);
    } finally {
      eventLoading.value = false;
    }
  }

  function closeEventEditor() {
    eventDialogOpen.value = false;
    eventDraft.value = null;
    eventOverview.value = null;
    editorMapId.value = null;
    systemData.value = null;
    tilesetImages.value = [];
  }

  async function saveEvent(closeAfterSave = true) {
    if (!eventDraft.value || editorMapId.value == null) return;
    eventSaving.value = true;
    try {
      const event = clone(eventDraft.value);
      if (event.id) {
        await eventsApi.update(editorMapId.value, event.id, event as unknown as Record<string, unknown>, projectId());
      }
      await onSaved?.();
      if (closeAfterSave) closeEventEditor();
      else eventDialogRef.value?.markSaved();
      ElMessage.success('事件已保存');
    } catch (error) {
      ElMessage.error(`保存失败：${(error as Error).message}`);
    } finally {
      eventSaving.value = false;
    }
  }

  function resetCatalog() {
    editorCatalog.value = null;
    catalogPromise = null;
  }

  function bindEventDialogRef(el: unknown) {
    eventDialogRef.value = (el as InstanceType<typeof EventEditorDialog> | null) ?? null;
  }

  return {
    eventDialogOpen,
    eventDialogRef,
    bindEventDialogRef,
    eventDraft,
    eventOverview,
    eventSaving,
    eventLoading,
    editorMapId,
    systemData,
    editorCatalog,
    tilesetImages,
    loadImage,
    ensureCatalog,
    openMapEventEditor,
    closeEventEditor,
    saveEvent,
    resetCatalog,
  };
}
