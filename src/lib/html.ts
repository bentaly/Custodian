// ─── HTML escaping for generated email ───────────────────────────────────────
//
// Everything the app emails is assembled here rather than passed through: a
// foundation's award-letter template and an applicant's organisation name are both
// third-party text that ends up in HTML we send to third parties. Escape at the point
// of interpolation, always — there is no "trusted" branch.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
