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
      // 将后端模块标记为外部依赖
      external: [
        /..\/..\/backend\/src\/core\/.*/,
      ],
    },
  },
})
