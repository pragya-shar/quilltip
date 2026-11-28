import type { Metadata } from 'next'
import '@/system/gallery/gallery.css'
import { Gallery } from '@/system/gallery/Gallery'

// The design system reference. Not linked from the product, not in the
// sitemap, and not indexed.
export const metadata: Metadata = {
  title: 'Design system',
  robots: { index: false, follow: false },
}

export default function SystemGalleryPage() {
  return <Gallery />
}
