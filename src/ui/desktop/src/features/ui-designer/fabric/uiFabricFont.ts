export interface UiFabricFontEnvironment {
  install: (family: string, url: string) => Promise<void>
}

const normalizeFontPath = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase()

export function uiFabricFontFamily(path: string): string {
  const normalized = normalizeFontPath(path)
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const name = normalized.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/g, '-') || 'font'
  return `UiDesigner-${name.slice(0, 28)}-${(hash >>> 0).toString(16)}`
}

export function createUiFabricFontLoader(environment: UiFabricFontEnvironment) {
  const installed = new Map<string, Promise<string>>()
  return (path: string, url: string): Promise<string> => {
    const family = uiFabricFontFamily(path)
    const key = `${family}\0${url}`
    const existing = installed.get(key)
    if (existing) return existing
    const loading = environment.install(family, url).then(() => family)
    installed.set(key, loading)
    void loading.catch(() => { if (installed.get(key) === loading) installed.delete(key) })
    return loading
  }
}

const browserFontLoader = createUiFabricFontLoader({
  async install(family, url) {
    if (typeof FontFace !== 'function' || typeof document === 'undefined' || !document.fonts) {
      throw new Error('The UI designer requires the browser FontFace API to render project fonts.')
    }
    const loaded = await new FontFace(family, `url(${JSON.stringify(url)})`).load()
    document.fonts.add(loaded)
  },
})

export const loadUiFabricFont = browserFontLoader

const installedNamedFamilies = new Map<string, Promise<void>>()

/**
 * Install a font file under an explicit family name, e.g. the engine's own
 * 'GameFont' or 'rmmz-mainfont', so design-state text renders with the same
 * glyphs the game preview shows. Failures resolve quietly: the family string
 * stays in the style and the browser falls back per its own list.
 */
export function installUiFabricFontFamily(family: string, url: string): Promise<void> {
  if (typeof FontFace !== 'function' || typeof document === 'undefined' || !document.fonts) {
    return Promise.reject(new Error('The UI designer requires the browser FontFace API to render project fonts.'))
  }
  const key = `${family}\0${url}`
  const existing = installedNamedFamilies.get(key)
  if (existing) return existing
  const loading = new FontFace(family, `url(${JSON.stringify(url)})`).load().then((loaded) => {
    document.fonts.add(loaded)
  })
  installedNamedFamilies.set(key, loading)
  void loading.catch(() => { if (installedNamedFamilies.get(key) === loading) installedNamedFamilies.delete(key) })
  return loading
}
