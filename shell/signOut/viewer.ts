'use client'

import { createContext, useContext } from 'react'

/**
 * Who is signing out: the signed-in user's id, asked once when a sign-out
 * starts, so a package's warning knows whose things would be stranded even
 * when its own code has not run on this page (Write's drafts after a fresh
 * load on another surface). The shell provides the live answer
 * (shell/signOut/liveViewer.tsx); by default, as in the gallery and the
 * fixtures, nobody.
 */
export type SignOutViewer = () => Promise<string | null>

export const SignOutViewerContext = createContext<SignOutViewer>(
  async () => null
)

export function useSignOutViewer(): SignOutViewer {
  return useContext(SignOutViewerContext)
}
