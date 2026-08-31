import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appRailSource = readFileSync(
  fileURLToPath(new URL('./AppRail.vue', import.meta.url)),
  'utf8',
)
const statusBarSource = readFileSync(
  fileURLToPath(new URL('./StatusBar.vue', import.meta.url)),
  'utf8',
)
const panelSource = readFileSync(
  fileURLToPath(new URL('../project/ProjectVersionPanel.vue', import.meta.url)),
  'utf8',
)
const versionWindowAppSource = readFileSync(
  fileURLToPath(new URL('../../VersionWindowApp.vue', import.meta.url)),
  'utf8',
)
const rendererMainSource = readFileSync(
  fileURLToPath(new URL('../../main.ts', import.meta.url)),
  'utf8',
)
const routerSource = readFileSync(
  fileURLToPath(new URL('../../router/index.ts', import.meta.url)),
  'utf8',
)
const consoleViewSource = readFileSync(
  fileURLToPath(new URL('../../views/ConsoleView.vue', import.meta.url)),
  'utf8',
)
const consoleHomeSource = readFileSync(
  fileURLToPath(new URL('../console/ConsoleHome.vue', import.meta.url)),
  'utf8',
)
const preloadSource = readFileSync(
  fileURLToPath(new URL('../../../electron/preload.ts', import.meta.url)),
  'utf8',
)
const versionWindowMainSource = readFileSync(
  fileURLToPath(new URL('../../../electron/version-window.ts', import.meta.url)),
  'utf8',
)
const zhCnSource = readFileSync(
  fileURLToPath(new URL('../../i18n/locales/zh-CN.ts', import.meta.url)),
  'utf8',
)
const enUsSource = readFileSync(
  fileURLToPath(new URL('../../i18n/locales/en-US.ts', import.meta.url)),
  'utf8',
)

describe('project version entry placement', () => {
  it('keeps version management out of the primary rail and router', () => {
    expect(appRailSource).not.toMatch(/project-collaboration/)
    expect(appRailSource).not.toMatch(/app\.nav\.projectCollaboration/)
    expect(appRailSource).not.toMatch(/ProjectVersionPanel/)
    expect(routerSource).not.toMatch(/\/project-collaboration/)
    expect(routerSource).not.toMatch(/ProjectCollaborationView/)
  })

  it('opens a dedicated desktop window from the status bar without navigation', () => {
    expect(statusBarSource).toMatch(/data-ui-id="status-project-version"/)
    expect(statusBarSource).toMatch(/versionWindow\.open/)
    expect(statusBarSource).toMatch(/onStatusChanged/)
    expect(statusBarSource).not.toMatch(/router\.push|useRouter/)
    expect(statusBarSource).not.toMatch(/ProjectVersionPanel/)
    expect(versionWindowMainSource).toMatch(/new BrowserWindow/)
    expect(versionWindowMainSource).toMatch(/'window', 'version'/)
    expect(rendererMainSource).toMatch(/window.*version/)
    expect(versionWindowAppSource).toMatch(/ProjectVersionPanel/)
  })

  it('wires the panel to the git service instead of change packages', () => {
    expect(panelSource).toMatch(/projectGit\.status/)
    expect(panelSource).toMatch(/projectGit\.commit/)
    expect(panelSource).toMatch(/projectGit\.push/)
    expect(panelSource).toMatch(/projectGit\.pull/)
    expect(panelSource).toMatch(/projectGit\.diff/)
    expect(panelSource).not.toMatch(/projectCollaboration|exportPackage|inspectImport|applyImport|el-dialog/)
    expect(preloadSource).toMatch(/projectGit:status/)
    expect(preloadSource).toMatch(/projectGit:push/)
    expect(preloadSource).toMatch(/projectGit:diff/)
    expect(preloadSource).toMatch(/versionWindow:open/)
    expect(preloadSource).not.toMatch(/project-collaboration:/)
  })

  it('removes the legacy versioning control from console surfaces', () => {
    expect(consoleViewSource).not.toMatch(/StoryProjectIdentityControl/)
    expect(consoleHomeSource).not.toMatch(/StoryProjectIdentityControl/)
  })

  it('uses projectGit locale keys in both languages and drops legacy labels', () => {
    for (const source of [zhCnSource, enUsSource]) {
      expect(source).not.toMatch(/storyIdentity\./)
      expect(source).not.toMatch(/projectCollaboration\./)
      expect(source).not.toMatch(/app\.nav\.projectCollaboration/)
      expect(source).toMatch(/projectGit\.status\.label/)
      expect(source).toMatch(/projectGit\.status\.open/)
      expect(source).toMatch(/projectGit\.remote\.push/)
      expect(source).toMatch(/projectGit\.conflict\.keepLocal/)
    }
    expect(zhCnSource).toMatch(/'projectGit\.title': '版本管理'/)
    expect(enUsSource).toMatch(/'projectGit\.title': 'Version management'/)
  })
})
