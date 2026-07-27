import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    server: {
      port: 5174,
      open: true,
    },
    plugins: [
      // Tailwind v4's Vite plugin, not the PostCSS one: Vite's built-in
      // postcss-import runs first and tries to resolve `@import 'tailwindcss'`
      // as a file path, which fails the SSR build.
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  }
})
