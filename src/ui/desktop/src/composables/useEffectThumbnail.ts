import { ref, watch, type Ref } from 'vue'

import { particlePreview } from '../api/client'

/** Default bucket for effect thumbnails; 256 balances grid crispness and cache size. */
export const DEFAULT_EFFECT_THUMBNAIL_BUCKET = 256

export interface UseEffectThumbnailResult {
  url: Ref<string>;
  loading: Ref<boolean>;
  failed: Ref<boolean>;
  reload: () => Promise<void>;
}

export interface UseEffectThumbnailOptions {
  sizeBucket?: number;
  /** Current project path; defaults to the app default project when omitted. */
  project?: () => string | undefined;
  /** Skip generation until true (e.g. lazily armed grid cells). Defaults to always on. */
  enabled?: () => boolean;
}

/**
 * Resolve an effect's representative-frame thumbnail URL, generating it on first
 * use via the offscreen capture pipeline and reusing the disk cache afterwards.
 * Shared by the asset grid, the side preview panel and the effect detail dialog.
 */
export function useEffectThumbnail(
  effectName: () => string,
  options: UseEffectThumbnailOptions = {},
): UseEffectThumbnailResult {
  const url = ref('')
  const loading = ref(false)
  const failed = ref(false)
  const sizeBucket = options.sizeBucket ?? DEFAULT_EFFECT_THUMBNAIL_BUCKET

  // Guards against out-of-order responses when the effect name changes mid-flight.
  let requestToken = 0

  async function reload(): Promise<void> {
    const name = effectName()
    const enabled = options.enabled ? options.enabled() : true
    const token = ++requestToken
    url.value = ''
    if (!name || !enabled) {
      loading.value = false
      failed.value = false
      return
    }
    loading.value = true
    failed.value = false
    try {
      const result = await particlePreview.ensureThumbnail(name, sizeBucket, options.project?.())
      if (token !== requestToken) return
      url.value = result.url
    } catch {
      if (token !== requestToken) return
      failed.value = true
    } finally {
      if (token === requestToken) loading.value = false
    }
  }

  watch(
    () => [effectName(), options.project?.(), options.enabled ? options.enabled() : true],
    () => { void reload() },
    { immediate: true },
  )

  return { url, loading, failed, reload }
}
