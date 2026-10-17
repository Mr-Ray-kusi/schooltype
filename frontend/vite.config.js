import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Compared against uncompressed chunk size. Keeps Vercel from treating
    // the default 500 kB reporter warning as a failed deploy log.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'router',
              test: /node_modules[\\/]react-router/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules/,
              priority: 10,
              maxSize: 400000,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Local only. The deployed site uses VITE_API_URL and talks to Render directly.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout: 20000,
        proxyTimeout: 20000,
      }
    }
  }
})
