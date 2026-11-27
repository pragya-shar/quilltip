import localFont from 'next/font/local'

/**
 * The one web font: Source Serif 4 for reading (variable weight, Latin).
 * Self-hosted, preloaded, `display: swap`. next/font writes a fallback face
 * from Times New Roman with the serif's own metrics (size, ascent, descent),
 * so text keeps its lines when the font arrives: no layout shift.
 *
 * The roman file (51 KB) is preloaded; the italic (52 KB) loads only when a
 * page draws italic text. The UI uses the platform face and loads nothing.
 * Optical sizing: this is the weight-only file. The opsz file is 122 KB; the
 * design hand-over may choose it here, with no change to a component.
 */
export const readingFace = localFont({
  src: './fonts/source-serif-4-latin-wght-normal.woff2',
  weight: '200 900',
  style: 'normal',
  variable: '--qt-face-read',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Times New Roman',
  fallback: ['Charter', 'Iowan Old Style', 'Georgia', 'serif'],
})

/** Italic as its own family, so only the roman file is preloaded. */
export const readingItalicFace = localFont({
  src: './fonts/source-serif-4-latin-wght-italic.woff2',
  weight: '200 900',
  style: 'italic',
  variable: '--qt-face-read-italic',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
  fallback: ['Charter', 'Iowan Old Style', 'Georgia', 'serif'],
})
