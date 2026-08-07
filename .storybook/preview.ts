import type { Preview } from '@storybook/react-vite'
import '../src/styles/globals.css'

// The app's own stylesheet and the app's own font, so a story is not a near-miss of
// what ships. Inter is loaded from Google Fonts exactly as `__root.tsx` loads it,
// including the `opsz` axis the `font-display` utility pins.

const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap'
document.head.appendChild(link)

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      options: {
        canvas: { name: 'Canvas', value: '#FAFBFA' },
        white: { name: 'White', value: '#FFFFFF' },
      },
    },
  },
  initialGlobals: { backgrounds: { value: 'canvas' } },
}

export default preview
