import { preload } from 'react-dom'

// The article body font is only found once the stylesheet is parsed. Preload it
// from this synchronous layout so the hint ships with the page head (the page
// itself streams in later) and the text renders once, in the right typeface.
export default function ArticleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  preload('/landing/fonts/alegreya-latin-400-normal.woff2', {
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  })
  return children
}
