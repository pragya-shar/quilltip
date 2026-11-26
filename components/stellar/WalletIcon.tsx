'use client'

import { useState } from 'react'

/**
 * A wallet's icon from the Wallets Kit CDN (allowed by `img-src`). The name
 * is always written next to it, so the image is decorative. When the icon
 * cannot load, the wallet's initial takes its place at the same size.
 */
export function WalletIcon({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className="wallet-icon wallet-icon-fallback" aria-hidden>
        {name.charAt(0)}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote 32px icon; next/image would need a loader and a remotePatterns entry
    <img
      className="wallet-icon"
      src={src}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
