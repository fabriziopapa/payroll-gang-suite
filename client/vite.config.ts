import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'path'

// File creati da aaPanel nella document root (= dist) con flag immutabile
// (chattr +i): vite emptyOutDir fallirebbe con EPERM nel cancellarli.
const AAPANEL_KEEP = new Set(['.user.ini', '.htaccess'])

/**
 * Pulisce manualmente la outDir PRESERVANDO i file aaPanel immutabili.
 * Usato con `emptyOutDir: false` per evitare l'EPERM su `.user.ini` in deploy,
 * rimuovendo comunque gli asset stantii del build precedente.
 */
function cleanDistKeepAapanel(dir: string): Plugin {
  return {
    name: 'clean-dist-keep-aapanel',
    apply: 'build',
    buildStart() {
      const out = path.resolve(__dirname, dir)
      if (!fs.existsSync(out)) return
      for (const entry of fs.readdirSync(out)) {
        if (AAPANEL_KEEP.has(entry)) continue
        fs.rmSync(path.join(out, entry), { recursive: true, force: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), cleanDistKeepAapanel('dist')],
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
    // Non svuotare automaticamente: lo fa cleanDistKeepAapanel() saltando
    // i file immutabili di aaPanel (.user.ini/.htaccess) → niente EPERM in deploy.
    emptyOutDir: false,
    sourcemap: false,
    // Chunk splitting per performance
    rollupOptions: {
      output: {
        manualChunks: {
          react:   ['react', 'react-dom'],
          zustand: ['zustand', 'immer'],
        },
        // Asset .mjs (pdf.worker di pdfjs-dist via `?url`) rinominati .js:
        // nginx aaPanel non mappa .mjs → serve application/octet-stream e
        // Chrome (strict MIME + nosniff) rifiuta il module worker → ogni PDF
        // dell'editor regioni falliva con "PDF non leggibile o danneggiato".
        // L'estensione .js viene servita come application/javascript ovunque.
        assetFileNames: (info) =>
          info.names?.some(n => n.endsWith('.mjs'))
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
