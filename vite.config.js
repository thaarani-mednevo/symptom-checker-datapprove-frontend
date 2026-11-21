import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /api calls are proxied to Django, so no CORS setup is needed on the backend.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8000' } },
})
