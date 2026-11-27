import localFont from 'next/font/local'

/**
 * The one web font: Literata for reading, display and money figures
 * (variable: optical size 12 to 60 and weight 400 to 700; see
 * system/fonts/README.md). Self-hosted, `display: swap`. next/font writes a
 * fallback face from Times New Roman with Literata's own metrics (size,
 * ascent, descent), so text keeps its lines when the font arrives: no
 * layout shift. The browser picks the optical size from the font size.
 *
 * The roman file (60 KB) is preloaded; the italic (62 KB) is its own family
 * and loads only when a page draws italic text. The UI uses the platform
 * face and loads nothing.
 */
export const readingFace = localFont({
  src: './fonts/literata-latin-normal.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--qt-face-read',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Times New Roman',
  fallback: ['Charter', 'Iowan Old Style', 'Georgia', 'serif'],
})

/** Italic as its own family, so only the roman file is preloaded. */
export const readingItalicFace = localFont({
  src: './fonts/literata-latin-italic.woff2',
  weight: '400 700',
  style: 'italic',
  variable: '--qt-face-read-italic',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
  fallback: ['Charter', 'Iowan Old Style', 'Georgia', 'serif'],
})
