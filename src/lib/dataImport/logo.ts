// ─── The Custodian mark, for the import workbook ─────────────────────────────
//
// Excel cannot render an SVG, so the mark lives here as a 144px PNG rasterised from
// public/favicon.svg — the same drawing as <LogoMark />. It is inlined rather than
// fetched because buildTemplate runs in the browser inside a route chunk: a fetch would
// add a failure path (and a race with the download click) to a file that must always
// build. ~4KB, and only in the data-import chunk.
//
// To regenerate after a logo change:
//   sharp('public/favicon.svg', { density: 600 }).resize(144, 144).png()  →  base64

export const CUSTODIAN_MARK_PNG_BASE64 =
  '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' +
  'ubFB43/Ihyt6g6258QAAAABJRU5ErkJggg=='
