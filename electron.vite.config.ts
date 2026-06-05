import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const appVersion: string = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          codebook: resolve('src/renderer/codebook.html'),
          logbook: resolve('src/renderer/logbook.html'),
          welcome: resolve('src/renderer/welcome.html'),
          'memo-edit': resolve('src/renderer/memo-edit.html'),
          'query-results': resolve('src/renderer/query-results.html')
        }
      }
    },
    plugins: [react()]
  }
})
