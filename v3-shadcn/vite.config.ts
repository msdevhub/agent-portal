import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3013,
    allowedHosts: ['portal.dev.dora.restry.cn', 'dev.dora.restry.cn'],
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
})
