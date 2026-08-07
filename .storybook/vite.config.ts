import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Storybook's Vite config, deliberately separate from the app's.
//
// Left to itself Storybook picks up the root `vite.config.ts`, and the TanStack Start
// plugin in there fails the build: it wants to capture a route manifest from a single
// client entry, and Storybook's preview is a second one. Nothing in Start is relevant
// to rendering a component in isolation — the only plugin both need is Tailwind, so
// that stories are styled by the same `globals.css` token layer the app ships.
//
// React's plugin is supplied by `@storybook/react-vite` itself; adding it here again
// would double-transform every file.

export default defineConfig({
  plugins: [tailwindcss()],
})
