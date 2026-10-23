'use client'

import { useId } from 'react'
import Link from 'next/link'

export function LandingWordmark() {
  const id = useId().replaceAll(':', '')
  const nib = 'M47 49 78 60 98 106 53 83Z'
  return (
    <Link href="/" aria-label="QuillTip home" className="wordmark">
      <span className="logo-study logo-study-1" data-lettering="syne">
        <svg viewBox="0 0 100 112" aria-hidden="true">
          <defs>
            <mask
              id={`${id}-ring`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="110"
              height="120"
            >
              <rect width="110" height="120" fill="white" />
              <path
                d={nib}
                fill="black"
                stroke="black"
                strokeWidth="11"
                strokeLinejoin="round"
              />
            </mask>
            <mask
              id={`${id}-nib`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="110"
              height="120"
            >
              <rect width="110" height="120" fill="white" />
              <circle cx="68" cy="74" r="6" fill="black" />
              <path d="M68 74 98 106" stroke="black" strokeWidth="3.5" />
            </mask>
          </defs>
          <g mask={`url(#${id}-ring)`}>
            <path
              transform="translate(5.88 .3) scale(.88 .94)"
              fill="currentColor"
              fillRule="evenodd"
              d="M49 5C18 5 5 24 5 49s14 44 44 44 47-18 47-44S80 5 49 5ZM49 16c21 0 32 12 32 33S70 81 49 81 17 70 17 49s11-33 32-33Z"
            />
          </g>
          <path d={nib} mask={`url(#${id}-nib)`} fill="currentColor" />
        </svg>
        <span aria-hidden="true">uillTip</span>
      </span>
    </Link>
  )
}
