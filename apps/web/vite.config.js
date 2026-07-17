import { defineConfig, createLogger } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// Vite 8 logs "ws proxy socket error" unconditionally whenever a proxied
// WebSocket socket errors. When a WS client goes away mid-write — HMR reload,
// tab close, Socket.IO transport upgrade — http-proxy throws EPIPE/ECONNRESET.
// That's harmless dev-only noise, so drop just those codes while still surfacing
// real proxy failures (e.g. ECONNREFUSED when the API server is down).
const logger = createLogger()
const baseError = logger.error
logger.error = (msg, options) => {
  const code = options?.error?.code
  if (code === 'EPIPE' || code === 'ECONNRESET') return
  baseError(msg, options)
}

export default defineConfig({
  customLogger: logger,
  plugins: [vue()],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  server: {
    proxy: {
      '/api':    { target: 'http://localhost:3000' },
      '/socket': { target: 'http://localhost:3000', ws: true },
    },
    allowedHosts: [
      "8223-195-18-2-113.ngrok-free.app"
    ]
  },
})
