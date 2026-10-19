'use client'

import { useId } from 'react'

// The letterforms are Literata, the existing editorial family. Each mask follows
// the pen through one letter; dots and the crossbar are separate finishing strokes.
const letters = [
  {
    letter: 'w',
    x: 3,
    strokes: [
      {
        order: 0,
        d: 'M5 35 Q14 24 18 31 L13 59 Q11 74 24 65 Q35 53 37 32 Q36 45 34 58 Q32 74 45 65 Q61 46 56 31',
      },
    ],
  },
  {
    letter: 'r',
    x: 67,
    strokes: [{ order: 1, d: 'M3 36 Q14 24 17 31 L9 68 M14 48 Q23 25 33 33' }],
  },
  {
    letter: 'i',
    x: 106,
    strokes: [
      { order: 2, d: 'M3 36 Q14 25 16 33 L9 59 Q6 74 22 62' },
      { order: 9, d: 'M18 14 L19 12' },
    ],
  },
  {
    letter: 't',
    x: 130,
    strokes: [
      { order: 3, d: 'M22 14 L13 55 Q7 75 28 61' },
      { order: 8, d: 'M7 31 L31 31' },
    ],
  },
  {
    letter: 'i',
    x: 162,
    strokes: [
      { order: 4, d: 'M3 36 Q14 25 16 33 L9 59 Q6 74 22 62' },
      { order: 7, d: 'M18 14 L19 12' },
    ],
  },
  {
    letter: 'n',
    x: 187,
    strokes: [
      {
        order: 5,
        d: 'M3 36 Q15 24 17 32 L9 68 M14 49 Q28 23 36 33 Q39 37 32 56 Q26 75 45 62',
      },
    ],
  },
  {
    letter: 'g',
    x: 236,
    strokes: [
      {
        order: 6,
        d: 'M35 32 C15 18 1 51 13 64 C23 75 35 51 36 32 L29 73 C25 91 3 92 8 79',
      },
    ],
  },
]

export function HandwrittenWord() {
  const id = useId().replace(/:/g, '')
  return (
    <>
      <span className="opening-word-measure">writing</span>
      <svg
        className="opening-handwriting"
        viewBox="0 0 286 94"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={`${id}-t-stem`}>
            <path
              clipRule="evenodd"
              d="M-8 0H85V94H-8Z M-8 27H14V35H-8Z M24 27H50V35H24Z"
            />
          </clipPath>
          {letters.map(({ strokes }, index) => (
            <mask
              key={index}
              id={`${id}-letter-${index}`}
              maskUnits="userSpaceOnUse"
              x="-8"
              y="0"
              width="85"
              height="94"
            >
              <g
                fill="none"
                stroke="white"
                strokeWidth="20"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {strokes.map(({ d, order }) => (
                  <path
                    key={order}
                    d={d}
                    clipPath={order === 3 ? `url(#${id}-t-stem)` : undefined}
                    strokeWidth={order === 7 || order === 9 ? 26 : undefined}
                    data-writing-stroke={order}
                  />
                ))}
              </g>
            </mask>
          ))}
        </defs>
        {letters.map(({ letter, x }, index) => (
          <g key={index} transform={`translate(${x} 0)`}>
            <text
              x="0"
              y="69"
              mask={`url(#${id}-letter-${index})`}
              fill="currentColor"
            >
              {letter}
            </text>
          </g>
        ))}
      </svg>
    </>
  )
}

export function OpeningQuill() {
  return (
    <svg viewBox="0 0 64 140" fill="none">
      <path
        d="M12 112 C5 95 8 78 12 70 L16 82 C12 58 21 45 27 38 L27 51 C27 29 42 15 48 12 L47 24 C52 12 58 5 62 3 C60 21 57 32 50 39 L58 36 C53 53 45 63 36 68 L46 65 C40 83 29 91 23 94 L31 92 C25 103 19 109 12 112Z"
        fill="#fff9f2"
      />
      <path
        d="M12 70 L16 82 L21 94 L12 112 C5 95 8 78 12 70ZM27 38 L27 51 L32 68 L21 94 C17 77 12 58 27 38ZM48 12 L47 24 L44 44 L32 68 C28 49 29 29 48 12Z"
        fill="#dca9ae"
      />
      <path
        d="M9 120 C20 83 34 51 54 21"
        stroke="#c88e9b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M9 116 L15 119 L11 128 L3 137 L5 124Z" fill="#e8bdb7" />
      <path d="M3 137 L9 124" stroke="#742350" strokeWidth="1" />
      <circle cx="9" cy="124" r="1.2" fill="#742350" />
      <path
        d="M8 116 L15 119"
        stroke="#c88e9b"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function OpeningInkpot() {
  return (
    <svg viewBox="0 0 72 62" fill="none">
      <path
        d="M22 11 L50 11 L51 24 C66 31 70 45 66 53 C56 62 17 62 7 53 C3 44 9 30 21 24Z"
        fill="#b76f82"
      />
      <path
        d="M22 23 C11 30 8 43 12 50 C20 58 43 57 48 49 C59 32 39 24 22 23Z"
        fill="#cf929e"
      />
      <path
        d="M18 35 C11 44 19 47 24 41 L31 34 C32 28 22 30 18 35Z"
        fill="#e8bdb7"
        opacity=".65"
      />
      <path d="M21 12 L21 20 C28 25 46 24 51 20 L51 12" fill="#c98b98" />
      <ellipse cx="36" cy="12" rx="16" ry="6" fill="#fff1e5" />
      <ellipse cx="36" cy="12" rx="12" ry="3.5" fill="#4d0c2c" />
      <path
        d="M27 11 Q32 9 38 10"
        stroke="#e8bdb7"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}
