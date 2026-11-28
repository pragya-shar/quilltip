import type { CSSProperties } from 'react'
import localFont from 'next/font/local'
import { readingStack } from './readingStack'

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

/*
 * The same four files again under second family names, with font-display:
 * swap. Nothing uses them until a document has the real faces loaded
 * (system/readingFaceUpgrade.ts loads them, from the cache, when idle); the
 * next change of page then puts them first in the family lists, so a reader
 * whose first view stayed in the fallback reads the next page in Literata.
 * Inside a page view nothing changes face. Same files, so no second
 * download.
 */
const readingFaceNext = localFont({
  src: './fonts/literata-latin-normal.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  // next/font names a preloaded file apart: the same flag as readingFace
  // keeps one file (and one preload link) for both names.
  preload: true,
  adjustFontFallback: false,
  fallback: [],
})

const readingItalicFaceNext = localFont({
  src: './fonts/literata-latin-italic.woff2',
  weight: '400 700',
  style: 'italic',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: [],
})

const readingExtFaceNext = localFont({
  src: './fonts/literata-latin-ext-normal.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  // As readingExtFace above; next/font needs the literal here.
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
})

const readingExtItalicFaceNext = localFont({
  src: './fonts/literata-latin-ext-italic.woff2',
  weight: '400 700',
  style: 'italic',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  // As readingExtItalicFace above; next/font needs the literal here.
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
})

export { readingStack }

/** One reading face and its second name: the family to check (it was
 * asked for in this document), the one to load, and their style. */
export type FacePair = { first: string; next: string; italic: boolean }

const pair = (
  first: { style: { fontFamily: string } },
  next: { style: { fontFamily: string } },
  italic: boolean
): FacePair => ({
  first: first.style.fontFamily,
  next: next.style.fontFamily,
  italic,
})

/** The four pairs: Latin and Latin Extended, roman and italic. */
export const READING_FACE_PAIRS = {
  latin: pair(readingFace, readingFaceNext, false),
  latinItalic: pair(readingItalicFace, readingItalicFaceNext, true),
  extended: pair(readingExtFace, readingExtFaceNext, false),
  extendedItalic: pair(readingExtItalicFace, readingExtItalicFaceNext, true),
} as const

/**
 * Each reading variable: its Latin pair, its Latin Extended pair and its
 * metric fallback. A list leads with a pair's second name once that face
 * is loaded (system/readingFaceUpgrade.ts).
 */
export const READING_FACE_LISTS = {
  '--qt-face-read': ['latin', 'extended', 'Quilltip Read Fallback'],
  '--qt-face-read-italic': [
    'latinItalic',
    'extendedItalic',
    'Quilltip Read Italic Fallback',
  ],
  '--qt-face-display': ['latin', 'extended', 'Quilltip Display Fallback'],
  '--qt-face-display-wide': [
    'latin',
    'extended',
    'Quilltip Display Wide Fallback',
  ],
} as const satisfies Record<
  string,
  readonly [
    keyof typeof READING_FACE_PAIRS,
    keyof typeof READING_FACE_PAIRS,
    string,
  ]
>

/** What the client needs to upgrade the faces, written on <html> as
 * `data-reading-faces`, so the client never imports next/font. */
export type ReadingFaceUpgrade = {
  pairs: Record<keyof typeof READING_FACE_PAIRS, FacePair>
  lists: typeof READING_FACE_LISTS
}

export const readingFaceUpgradeData = JSON.stringify({
  pairs: READING_FACE_PAIRS,
  lists: READING_FACE_LISTS,
} satisfies ReadingFaceUpgrade)

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
