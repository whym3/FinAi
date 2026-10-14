import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': import.meta.dirname + '/src' } },
  // The FastAPI server. Same origin for the browser, so OAuth redirects and cookies just work.
  server: { proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8000', changeOrigin: false } } },
})
