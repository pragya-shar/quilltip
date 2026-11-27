'use client'

import { useEffect, useState } from 'react'

type Matrix = { size: number; dark: boolean[] }

/**
 * A QR code drawn as one SVG path, ink on cream with the standard four-module
 * quiet zone. The `qrcode` encoder loads only when a code is shown.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [matrix, setMatrix] = useState<Matrix | null>(null)

  useEffect(() => {
    let live = true
    void import('qrcode').then(({ default: QR }) => {
      if (!live) return
      const code = QR.create(value, { errorCorrectionLevel: 'M' })
      const size = code.modules.size
      const dark = Array.from({ length: size * size }, (_, i) =>
        Boolean(code.modules.data[i])
      )
      setMatrix({ size, dark })
    })
    return () => {
      live = false
    }
  }, [value])

  if (!matrix) {
    return <div className="wallet-qr wallet-qr-placeholder" aria-hidden />
  }
  const quiet = 4
  const span = matrix.size + quiet * 2
  let path = ''
  matrix.dark.forEach((on, i) => {
    if (!on) return
    const x = (i % matrix.size) + quiet
    const y = Math.floor(i / matrix.size) + quiet
    path += `M${x} ${y}h1v1h-1z`
  })
  return (
    <svg
      className="wallet-qr"
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-modules={matrix.size}
    >
      <rect width={span} height={span} fill="#fffaf2" />
      <path d={path} fill="#390c18" />
    </svg>
  )
}
