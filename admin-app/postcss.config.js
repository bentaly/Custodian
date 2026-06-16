// Local PostCSS config so the build uses admin-app's own tailwind/autoprefixer
// instead of walking up to the repo root's config (whose deps aren't installed
// when Cloudflare builds with Path=admin-app).
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
