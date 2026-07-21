import { BrowserWindow, ipcMain, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProductLanguage } from '../../../contract/types.ts';
import { resolveDocumentationPath } from './documentation-policy.js';

export const DOCUMENTATION_SCHEME = 'rpg-agent-doc';
const DOCUMENT_EXTENSIONS = ['.md', '.json'] as const;
const RESOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] as const;
let documentationWindow: BrowserWindow | null = null;
let documentationRoot = '';
let preloadPath = '';
let rendererEntry = '';
let configured = false;
let manifestCache: DocumentationManifest | null = null;
type DocumentationPage = { title: string; path: string };
type DocumentationSection = { title: string; pages: DocumentationPage[] };
type DocumentationManifest = Record<ProductLanguage, DocumentationSection[]>;

function validateLanguage(value: unknown): ProductLanguage {
  if (value !== 'zh-CN' && value !== 'en-US') throw new Error('Unsupported documentation language.');
  return value;
}

function readManifest(): DocumentationManifest {
  if (manifestCache) return manifestCache;
  const target = resolveDocumentationPath(documentationRoot, 'navigation.json', DOCUMENT_EXTENSIONS);
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<DocumentationManifest>;
  for (const language of ['zh-CN', 'en-US'] as const) {
    const sections = parsed[language];
    if (!Array.isArray(sections) || !sections.length) throw new Error(`Documentation navigation is empty for ${language}.`);
    for (const section of sections) {
      if (!section || typeof section.title !== 'string' || !Array.isArray(section.pages) || !section.pages.length) {
        throw new Error(`Documentation navigation is invalid for ${language}.`);
      }
      for (const page of section.pages) {
        if (!page || typeof page.title !== 'string' || typeof page.path !== 'string') {
          throw new Error(`Documentation page entry is invalid for ${language}.`);
        }
        const pageTarget = resolveDocumentationPath(documentationRoot, page.path, ['.md']);
        if (!fs.statSync(pageTarget).isFile()) throw new Error(`Documentation page was not found: ${page.path}`);
      }
    }
  }
  manifestCache = parsed as DocumentationManifest;
  return manifestCache;
}

function readPage(relative: string): { path: string; markdown: string } {
  const target = resolveDocumentationPath(documentationRoot, relative, ['.md']);
  if (!fs.statSync(target).isFile()) throw new Error('Documentation page was not found.');
  return { path: String(relative).replaceAll('\\', '/'), markdown: fs.readFileSync(target, 'utf8') };
}

export function configureDocumentationWindow(options: { documentationRoot: string; preloadPath: string; rendererEntry: string }): void {
  if (configured) return;
  configured = true;
  documentationRoot = path.resolve(options.documentationRoot);
  preloadPath = options.preloadPath;
  rendererEntry = options.rendererEntry;
  protocol.handle(DOCUMENTATION_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const target = resolveDocumentationPath(documentationRoot, relative, RESOURCE_EXTENSIONS);
      if (!fs.statSync(target).isFile()) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  });
  ipcMain.handle('documentation:open', (_event, language: ProductLanguage) => openDocumentationWindow(language));
  ipcMain.handle('documentation:bootstrap', (_event, rawLanguage: unknown, preferredPath?: unknown) => {
    const language = validateLanguage(rawLanguage);
    const navigation = readManifest();
    const paths = navigation[language].flatMap((section) => section.pages.map((page) => page.path));
    const requested = typeof preferredPath === 'string' && paths.includes(preferredPath) ? preferredPath : paths[0];
    if (!requested) throw new Error(`Documentation navigation is empty for ${language}.`);
    return { navigation, page: readPage(requested) };
  });
  ipcMain.handle('documentation:navigation', () => readManifest());
  ipcMain.handle('documentation:read', (_event, relative: string) => readPage(relative));
}

async function openDocumentationWindow(rawLanguage: ProductLanguage): Promise<{ ok: true }> {
  const language = validateLanguage(rawLanguage);
  readManifest();
  if (documentationWindow && !documentationWindow.isDestroyed()) {
    if (documentationWindow.isMinimized()) documentationWindow.restore();
    documentationWindow.focus();
    documentationWindow.webContents.send('documentation:setLanguage', language);
    return { ok: true };
  }
  documentationWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 500,
    show: false,
    backgroundColor: '#f7f5f1',
    title: 'RPG Agent MV Documentation',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  documentationWindow.on('closed', () => { documentationWindow = null; });
  documentationWindow.once('ready-to-show', () => documentationWindow?.show());
  documentationWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  documentationWindow.webContents.on('will-navigate', (event, target) => {
    const allowedPrefix = /^https?:\/\//.test(rendererEntry) ? rendererEntry : 'file:';
    if (target.startsWith(allowedPrefix)) return;
    event.preventDefault();
  });
  if (/^https?:\/\//.test(rendererEntry)) {
    const target = new URL(rendererEntry);
    target.searchParams.set('language', language);
    await documentationWindow.loadURL(target.toString());
  } else await documentationWindow.loadFile(rendererEntry, { query: { language } });
  return { ok: true };
}

export function cleanupDocumentationWindow(): void {
  if (!configured) return;
  configured = false;
  ipcMain.removeHandler('documentation:open');
  ipcMain.removeHandler('documentation:bootstrap');
  ipcMain.removeHandler('documentation:navigation');
  ipcMain.removeHandler('documentation:read');
  void protocol.unhandle(DOCUMENTATION_SCHEME);
  if (documentationWindow && !documentationWindow.isDestroyed()) documentationWindow.destroy();
  documentationWindow = null;
  manifestCache = null;
}
