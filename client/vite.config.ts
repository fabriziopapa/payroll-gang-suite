import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Legge le variabili VITE_* dal .env nella root del monorepo
  envDir: '../',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    // Proxy API verso il server Fastify in sviluppo
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Chunk splitting per performance
    rollupOptions: {
      output: {
        manualChunks: {
          react:   ['react', 'react-dom'],
          zustand: ['zustand', 'immer'],
        },
      },
    },
  },
})
