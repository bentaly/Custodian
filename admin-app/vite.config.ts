import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tailwind v4 runs as a Vite plugin rather than a PostCSS one, so there is no
// postcss.config.js here any more — which also removes the old hazard of this
// build walking up to the repo root's config when Cloudflare builds with
// Path=admin-app.
export default defineConfig({
  plugins: [tailwindcss(), react()],
})
