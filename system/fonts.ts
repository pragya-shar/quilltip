import type { CSSProperties } from 'react'
import localFont from 'next/font/local'

/**
 * The one web font: Literata for reading, display and money figures
 * (variable: optical size 12 to 60 and weight 400 to 700; see
 * system/fonts/README.md). Self-hosted, `display: optional`: a page view
 * that starts painting before Literata arrives (the block period is about
 * 100 ms) stays in the fallback for the whole view, so the text being read
 * never changes face or line breaks; Literata shows from the next view that
 * finds it loaded or cached. The fallback is Times New Roman at Literata's
 * metrics, one face per weight band (system/font-fallbacks.css; next/font's
 * own fallback has one face only), so a reader who stays in it sees nearly
 * the same line lengths. The browser picks the optical size from the font
 * size.
 *
 * The roman Latin file (60 KB) is preloaded; the italic (62 KB) is its own
 * family and loads only when a page draws italic text. The Latin Extended
 * files (about 50 KB each: "Łukasz", "Đorđe", "Nguyễn") carry a
 * `unicode-range`, so a browser loads one only when a page draws one of
 * those letters. The UI uses the platform face and loads nothing.
 */
export const readingFace = localFont({
  src: './fonts/literata-latin-normal.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--qt-face-read',
  display: 'optional',
  preload: true,
  adjustFontFallback: false,
  fallback: [],
})

/** Italic as its own family, so only the roman file is preloaded. */
export const readingItalicFace = localFont({
  src: './fonts/literata-latin-italic.woff2',
  weight: '400 700',
  style: 'italic',
  variable: '--qt-face-read-italic',
  display: 'optional',
  preload: false,
  adjustFontFallback: false,
  fallback: [],
})

const readingExtFace = localFont({
  src: './fonts/literata-latin-ext-normal.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'optional',
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  // Literata's Latin Extended subset, as Google Fonts and Fontsource cut it.
  // next/font needs the literal here.
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
})

const readingExtItalicFace = localFont({
  src: './fonts/literata-latin-ext-italic.woff2',
  weight: '400 700',
  style: 'italic',
  display: 'optional',
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  // Literata's Latin Extended subset, as Google Fonts and Fontsource cut it.
  // next/font needs the literal here.
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
})

/**
 * A family list: Literata's Latin face, its Latin Extended face, then the
 * metric-matched fallback (system/font-fallbacks.css), which covers every
 * letter and so comes after both.
 */
export function readingStack(
  latin: string,
  extended: string,
  fallback: string
): string {
  return [latin, extended, `'${fallback}'`].join(', ')
}

/** The reading families for the root element, as custom properties. */
export const readingFaceStyle = {
  '--qt-face-read': readingStack(
    readingFace.style.fontFamily,
    readingExtFace.style.fontFamily,
    'Quilltip Read Fallback'
  ),
  '--qt-face-read-italic': readingStack(
    readingItalicFace.style.fontFamily,
    readingExtItalicFace.style.fontFamily,
    'Quilltip Read Italic Fallback'
  ),
  // The display title has fallbacks of its own (system/font-fallbacks.css).
  '--qt-face-display': readingStack(
    readingFace.style.fontFamily,
    readingExtFace.style.fontFamily,
    'Quilltip Display Fallback'
  ),
  '--qt-face-display-wide': readingStack(
    readingFace.style.fontFamily,
    readingExtFace.style.fontFamily,
    'Quilltip Display Wide Fallback'
  ),
} as CSSProperties
