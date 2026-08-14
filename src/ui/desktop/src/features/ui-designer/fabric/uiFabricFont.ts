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
