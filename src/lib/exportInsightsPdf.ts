// Client-only PDF export for the Insights screen. Captures the current on-screen
// state of each panel as an image and stacks them under a vector header that
// records the active filters — the "glossy screengrab for stakeholders" export.
//
// jspdf and html2canvas are heavy and reference `window`/`document` at import
// time, so they are dynamically imported inside the handler: they never enter
// the SSR/Workers bundle and only load when a user actually exports.
import type { jsPDF as JsPDF } from 'jspdf'

export type InsightsPdfMeta = {
  /** Big title, e.g. "Insights". */
  title: string
  /** Active-filter summary, e.g. "All time · All programmes · All regions". */
  filters: string
  /** Headline, e.g. "12 grants · £1.2m committed". */
  summary: string
  /** Pre-formatted generation date, e.g. "6 July 2026". */
  generatedAt: string
}

// A4 portrait in points (jsPDF's default unit here).
const PAGE = { w: 595.28, h: 841.89 }
const MARGIN = 40
const BLOCK_GAP = 14
const EMERALD: [number, number, number] = [29, 158, 117]

export async function exportInsightsPdf(root: HTMLElement, meta: InsightsPdfMeta) {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([import('jspdf'), import('html2canvas')])
  const html2canvas = html2canvasMod.default

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const contentW = PAGE.w - MARGIN * 2
  let y = MARGIN

  // ── Header (crisp vector text, not part of the screenshot) ──
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(150)
  pdf.text('CUSTODIAN', MARGIN, y + 4)
  y += 26
  pdf.setFontSize(24)
  pdf.setTextColor(30)
  pdf.text(meta.title, MARGIN, y)
  y += 20
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(110)
  pdf.text(meta.filters, MARGIN, y)
  y += 14
  pdf.setFontSize(9)
  pdf.setTextColor(150)
  pdf.text(`${meta.summary} · Generated ${meta.generatedAt}`, MARGIN, y)
  y += 12
  pdf.setDrawColor(EMERALD[0], EMERALD[1], EMERALD[2])
  pdf.setLineWidth(1.5)
  pdf.line(MARGIN, y, PAGE.w - MARGIN, y)
  y += 20

  // ── Body: one image per panel, so cards are never cut mid-block ──
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-export-block]'))
  for (const block of blocks) {
    const canvas = await html2canvas(block, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    })
    y = placeCanvas(pdf, canvas, contentW, y)
  }

  pdf.save(`insights-${new Date().toISOString().slice(0, 10)}.pdf`)
}

// Draws a captured panel at the current y, adding pages as needed. A panel that
// fits within a page is never split; only a panel taller than a full page is
// sliced across pages.
function placeCanvas(pdf: JsPDF, canvas: HTMLCanvasElement, contentW: number, y: number): number {
  const scale = contentW / canvas.width // canvas px → pt
  const fullH = canvas.height * scale
  const pageBottom = PAGE.h - MARGIN
  const pageContentH = PAGE.h - MARGIN * 2

  if (fullH <= pageContentH) {
    if (y + fullH > pageBottom) {
      pdf.addPage()
      y = MARGIN
    }
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', MARGIN, y, contentW, fullH, undefined, 'FAST')
    return y + fullH + BLOCK_GAP
  }

  // Oversized panel: start on a fresh page (unless already at the top) and slice.
  const pxPerPt = canvas.width / contentW
  if (y > MARGIN + 1) {
    pdf.addPage()
    y = MARGIN
  }
  let srcY = 0
  while (srcY < canvas.height) {
    const availPt = pageBottom - y
    const sliceHpx = Math.min(canvas.height - srcY, Math.floor(availPt * pxPerPt))
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = sliceHpx
    slice.getContext('2d')!.drawImage(canvas, 0, srcY, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx)
    const sliceHpt = sliceHpx / pxPerPt
    pdf.addImage(slice.toDataURL('image/png'), 'PNG', MARGIN, y, contentW, sliceHpt, undefined, 'FAST')
    srcY += sliceHpx
    y += sliceHpt
    if (srcY < canvas.height) {
      pdf.addPage()
      y = MARGIN
    }
  }
  return y + BLOCK_GAP
}
