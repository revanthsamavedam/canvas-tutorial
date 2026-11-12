import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      // The pre-existing component library lives at ./lib and is imported
      // by name, exactly like an npm package. The builder resolves the
      // alias at build time and bundles the library into the single file
      // — nothing is loaded from the network at view time.
      // Swap this path for your real library: a workspace package, a
      // design-system repo, or an npm package name (bare import, no alias).
      '@canvas-lib': path.resolve(__dirname, 'lib'),
    },
  },
  build: {
    // Inline every asset (JS + CSS) into dist/index.html. No separate
    // chunks, no external files: the output is one self-contained page.
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
  },
})
