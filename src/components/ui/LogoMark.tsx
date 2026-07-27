// The Custodian mark, exactly as drawn in Figma (node 126:31799) — the rounded chip
// background is baked into the SVG, so the whole thing scales from one `className`.
// Shared by the app sidebar and the signed-out shell; there is only one logo.
export function LogoMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <rect width="40" height="40" rx="10" fill="#DFF3EA" />
      <path
        d="M20 29C18.22 29 16.4799 28.4722 14.9999 27.4832C13.5198 26.4943 12.3663 25.0887 11.6851 23.4442C11.0039 21.7996 10.8257 19.99 11.1729 18.2442C11.5202 16.4984 12.3774 14.8947 13.636 13.636C14.8947 12.3774 16.4984 11.5202 18.2442 11.1729C19.99 10.8257 21.7996 11.0039 23.4442 11.6851C25.0887 12.3663 26.4943 13.5198 27.4832 14.9999C28.4722 16.4799 29 18.22 29 20"
        stroke="#1F7A5C"
        strokeWidth="6"
      />
      <rect x="26" y="26" width="6" height="6" fill="#1F7A5C" />
    </svg>
  )
}
