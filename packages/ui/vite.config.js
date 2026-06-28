import { defineConfig }  from 'vite'
import vue               from '@vitejs/plugin-vue'
import { readdirSync }   from 'fs'
import { resolve, extname, basename } from 'path'
import { fileURLToPath } from 'url'

const dir    = fileURLToPath(new URL('.', import.meta.url))
const srcDir = resolve(dir, 'src')

const entries = Object.fromEntries(
  readdirSync(srcDir)
    .filter(f => /\.(vue|js)$/.test(f))
    .map(f => [basename(f, extname(f)), resolve(srcDir, f)])
)

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir:      'dist',
    emptyOutDir: true,
    lib: {
      entry:   entries,
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue', 'vue-router', '@iconify/vue', 'radix-vue', 'clsx', 'tailwind-merge'],
      output: {
        preserveModules:     true,
        preserveModulesRoot: 'src',
        entryFileNames:      '[name].js',
        chunkFileNames:      '[name].js',
      },
    },
  },
})
