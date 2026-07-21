const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  window: {
    openExternalUrl: (url: string) => ipcRenderer.invoke('window:openExternalUrl', url),
  },
  documentation: {
    bootstrap: (language: string, preferredPath?: string) => ipcRenderer.invoke('documentation:bootstrap', language, preferredPath),
    navigation: () => ipcRenderer.invoke('documentation:navigation'),
    read: (relativePath: string) => ipcRenderer.invoke('documentation:read', relativePath),
    onSetLanguage: (callback: (language: string) => void) => {
      const handler = (_event: unknown, language: string) => callback(language);
      ipcRenderer.on('documentation:setLanguage', handler);
      return () => ipcRenderer.removeListener('documentation:setLanguage', handler);
    },
  },
});
