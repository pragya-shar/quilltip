import { preload } from 'react-dom'

function preloadFont(href: string) {
  preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
}

/**
 * Preloads Work Sans 400 (the interface face) for pages that show it on the
 * first screen. The sign-in pages do not use it, so the root layout no longer
 * preloads it for every page.
 */
export function preloadUiFont() {
  preloadFont('/landing/fonts/work-sans-latin-400-normal.woff2')
}
