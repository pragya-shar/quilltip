import type { ReactNode } from 'react'

/**
 * The public segment: reading, discovery, writer pages and shared links.
 * Everything here renders its content on the server in the first response
 * and works with no script (D19). No loading.tsx, and no Suspense above
 * reading content, anywhere under this group; interactive parts (the tip
 * control, menus, sheets) attach to content that is already there.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return children
}
