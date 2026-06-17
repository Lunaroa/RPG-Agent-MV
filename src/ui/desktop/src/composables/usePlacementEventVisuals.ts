import { reactive, watch, type Ref } from 'vue';
import { eventRegistry, type EditorProjectCatalog } from '../api/client';
import { useProjectStore } from '../stores/project';
import type { PlacementListEvent } from '../stores/eventPlacementAsk';
import { extractContractPageImage } from '../utils/placementContractImage';
import { characterSpriteStyle } from '../utils/spritePreviewStyle';

export interface PlacementEventVisual {
  loading: boolean;
  loaded: boolean;
  error?: string;
  image: ReturnType<typeof extractContractPageImage>;
  characterUrl: string | null;
  spriteStyle: Record<string, string> | null;
  usesTile: boolean;
}

function emptyVisual(): PlacementEventVisual {
  return {
    loading: false,
    loaded: false,
    image: null,
    characterUrl: null,
    spriteStyle: null,
    usesTile: false,
  };
}

function findCharacterAssetUrl(catalog: EditorProjectCatalog | null, name: string): string | null {
  if (!catalog || !name) return null;
  const asset = catalog.assets.characters.find((item) => (
    item.name === name
    || item.fileName === name
    || item.fileName.replace(/\.[^.]+$/, '') === name
  ));
  return asset?.url || null;
}

export function usePlacementEventVisuals(
  events: Ref<PlacementListEvent[]>,
  catalog: Ref<EditorProjectCatalog | null>,
) {
  const projectStore = useProjectStore();
  const visuals = reactive<Record<string, PlacementEventVisual>>({});

  async function loadVisual(contractId: string): Promise<void> {
    if (!contractId) return;
    const existing = visuals[contractId];
    if (existing?.loading || existing?.loaded) return;
    visuals[contractId] = { ...emptyVisual(), loading: true };
    try {
      const res = await eventRegistry.showContract(projectStore.currentProject, contractId) as {
        status?: string;
        contract?: Record<string, unknown>;
      };
      if (res.status !== 'ok' || !res.contract) {
        visuals[contractId] = {
          ...emptyVisual(),
          loaded: true,
          error: '未找到事件契约图像信息',
        };
        return;
      }
      const image = extractContractPageImage(res.contract);
      const usesTile = Boolean(image?.tileId && Number(image.tileId) > 0 && !image.characterName);
      const characterUrl = image?.characterName
        ? findCharacterAssetUrl(catalog.value, image.characterName)
        : null;
      const spriteStyle = characterUrl && image?.characterName
        ? characterSpriteStyle(characterUrl, image)
        : null;
      visuals[contractId] = {
        loading: false,
        loaded: true,
        image,
        characterUrl,
        spriteStyle,
        usesTile,
      };
    } catch (error) {
      visuals[contractId] = {
        ...emptyVisual(),
        loaded: true,
        error: error instanceof Error ? error.message : '读取事件图像失败',
      };
    }
  }

  watch(
    () => events.value.map((event) => event.contractId).join('\n'),
    () => {
      for (const event of events.value) void loadVisual(event.contractId);
    },
    { immediate: true },
  );

  watch(catalog, () => {
    for (const event of events.value) {
      const visual = visuals[event.contractId];
      if (!visual?.loaded || !visual.image?.characterName) continue;
      const characterUrl = findCharacterAssetUrl(catalog.value, visual.image.characterName);
      visual.characterUrl = characterUrl;
      visual.spriteStyle = characterUrl
        ? characterSpriteStyle(characterUrl, visual.image)
        : null;
    }
  });

  return { visuals, loadVisual };
}
