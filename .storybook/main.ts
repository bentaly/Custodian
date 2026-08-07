import type { StorybookConfig } from '@storybook/react-vite'

// Storybook runs the UI kit on its own, without the app's router, auth or loaders — so
// a component that can only be reached three clicks into a funding round is one click
// here, and every variant of it can be seen side by side rather than hunted for.
//
// Stories live next to the components they document (`Button.tsx` / `Button.stories.tsx`),
// so a variant added without a story is visible in review.

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    // Its own Vite config — see the note in `.storybook/vite.config.ts`.
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
}

export default config
