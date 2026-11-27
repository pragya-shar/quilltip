import type { CSSProperties } from 'react'
import localFont from 'next/font/local'

/**
 * The one web font: Literata for reading, display and money figures
 * (variable: optical size 12 to 60 and weight 400 to 700; see
 * system/fonts/README.md). Self-hosted, `display: swap`. next/font writes a
 * fallback face from Times New Roman with Literata's own metrics (size,
 * ascent, descent), so text keeps its lines when the font arrives: no
 * layout shift. The browser picks the optical size from the font size.
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

const readingExtFace = localFont({
  src: './fonts/literata-latin-ext-normal.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
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
  display: 'swap',
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
 * A family list with the extended face second: after Literata's Latin face
 * and before its metric fallback, which covers every letter and would
 * otherwise win for "Ł".
 */
export function withExtended(stack: string, extended: string): string {
  const [first, ...rest] = stack.split(/,\s*/)
  return [first, extended, ...rest].join(', ')
}

/** The reading families for the root element, as custom properties. */
export const readingFaceStyle = {
  '--qt-face-read': withExtended(
    readingFace.style.fontFamily,
    readingExtFace.style.fontFamily
  ),
  '--qt-face-read-italic': withExtended(
    readingItalicFace.style.fontFamily,
    readingExtItalicFace.style.fontFamily
  ),
} as CSSProperties
