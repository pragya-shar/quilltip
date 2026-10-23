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
