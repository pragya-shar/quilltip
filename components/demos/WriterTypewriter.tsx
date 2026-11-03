import { useState } from 'react'

export function WriterTypewriter({ reduced }: { reduced: boolean }) {
  const [held, setHeld] = useState(false)
  // The typewriter and manuscript are the artwork from the onboarding prototype.
  const artwork = (
    <svg viewBox="0 0 420 380" aria-hidden="true">
      <g fill="none" stroke="#660033" strokeWidth="1.2" opacity=".28">
        <path d="m42 182 30-9 14 49-32 9ZM51 190 70 185M54 200 74 195M56 209 70 205M339 167l33 9-12 45-33-9Z" />
        <path
          d="M354 179q-5 20-17 33M357 178q14-7 17-6-1 17-30 30M66 244q-31 41 33 41M336 245q34-32 40-7"
          strokeDasharray="2 8"
        />
      </g>
      <ellipse cx="211" cy="338" rx="113" ry="9" fill="#660033" opacity=".12" />
      <g className="machine">
        <g className="carriage">
          <path
            d="M91 202H337"
            stroke="#38000a"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M99 190v-17h30M333 193v20"
            fill="none"
            stroke="#660033"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <rect x="105" y="190" width="211" height="33" rx="7" fill="#a3607b" />
          <rect x="114" y="196" width="194" height="21" rx="4" fill="#38000a" />
          <g className="typed-paper">
            <path
              d="M153 97 287 97 287 217 153 217Z"
              fill="#38000a"
              opacity=".12"
              transform="translate(4 3)"
            />
            <path d="M153 97 287 97 287 217 153 217Z" fill="#f0dfc7" />
            <text
              x="165"
              y="124"
              fontFamily="Georgia,serif"
              fontSize="13"
              fill="#38000a"
              className="typed-line"
            >
              A thought.
            </text>
            <text
              x="165"
              y="143"
              fontFamily="Georgia,serif"
              fontSize="13"
              fill="#38000a"
              className="typed-line"
            >
              A few words.
            </text>
            <text
              x="165"
              y="162"
              fontFamily="Georgia,serif"
              fontSize="13"
              fill="#38000a"
              className="typed-line"
            >
              A beginning.
            </text>
            <path d="M165 180H259" stroke="#660033" opacity=".16" />
          </g>
          <path d="M116 216H306" stroke="#c38b9a" strokeWidth="8" />
        </g>
        <path
          d="M105 221H316L330 278Q337 329 291 333H127Q83 329 89 283Z"
          fill="#94506e"
        />
        <path
          d="M105 213H316L326 270Q332 320 289 324H130Q89 320 94 276Z"
          fill="#660033"
        />
        <path d="M105 213H316L320 236H100Z" fill="#bc8096" />
        <path
          d="M173 235Q210 258 248 235L239 257Q210 276 182 257Z"
          fill="#d0a0ac"
        />
        <path
          d="M169 246 209 224 251 246"
          fill="none"
          stroke="#38000a"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle
          cx="209"
          cy="230"
          r="10"
          fill="#ead8c4"
          stroke="#38000a"
          strokeWidth="2"
        />
        <path
          className="type-hammer"
          d="M209 245V230"
          stroke="#e4d2bd"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect x="117" y="275" width="189" height="37" rx="12" fill="#38000a" />
        {[0, 1, 2].map((row) =>
          Array.from({ length: 11 }, (_, column) => (
            <circle
              key={row * 11 + column}
              cx={130 + column * 15 + row * 2}
              cy={282 + row * 10}
              r="3.5"
              fill="#e4d2bd"
            />
          ))
        )}
        <path
          d="M159 316H265"
          stroke="#d0a0ac"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  )

  if (reduced) return <div className="writer-intro-typewriter">{artwork}</div>

  return (
    <button
      type="button"
      className="writer-intro-typewriter"
      aria-label="Hold typewriter animation"
      aria-pressed={held}
      onClick={() => setHeld((value) => !value)}
    >
      {artwork}
    </button>
  )
}
