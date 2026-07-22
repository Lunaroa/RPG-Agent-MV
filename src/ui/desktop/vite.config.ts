import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // Bundle electron-updater into main.js so packaged builds (node_modules excluded) still work.
              external: ['electron'],
              output: {
                // The main bundle is ESM, while electron-updater still contains CommonJS modules.
                // Give Rolldown's generated CommonJS bridge a real Node require at runtime.
                banner: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
      },
      {
        entry: 'electron/documentation-preload.ts',
      },
      {
        entry: '../../backend/src/core/desktop/map-overview-thumbnail-worker.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['electron'],
              output: {
                entryFileNames: 'map-overview-thumbnail-worker.js',
              },
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      // 共享 API 契约（RPG-Agent-MV/contract）。与后端共用同一份端点/类型声明。
      '@contract': fileURLToPath(new URL('../../contract', import.meta.url)),
    },
  },
  // 构建配置
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        documentation: fileURLToPath(new URL('documentation.html', import.meta.url)),
      },
      // 将后端模块标记为外部依赖
      external: [
        /..\/..\/backend\/src\/core\/.*/,
      ],
    },
  },
})
