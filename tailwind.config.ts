import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Inter ships its Display cut as the `opsz` axis (14 = Text … 32 = Display)
        // rather than a separate family, so one variable font covers both roles —
        // `font-optical-sizing: auto` picks the right cut by size, and `.font-display`
        // pins opsz to 32 for headings. See index.html link + globals.css.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // Lifted from the Figma redesign (same values the Sidebar hard-codes).
        canvas: '#FAFBFA',
        hairline: '#EDF0EF',
        ink: { DEFAULT: '#101828', muted: '#5F6B76', soft: '#3D4852' },
        moss: { 50: '#F0F3F1', 100: '#DFF0E7', 600: '#1C6B4F', 700: '#17795A' },
        // The dashboard's stat-tile tints, reused as the sign-in brand art.
        tile: { lavender: '#EEEEFB', mint: '#E9F7EF', cream: '#FDF6E3', blush: '#FDF0F4' },
      },
    },
  },
  plugins: [typography],
} satisfies Config
