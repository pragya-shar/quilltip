/* Full navigation runs the writing desk unsaved-changes guard. */
/* eslint-disable @next/next/no-html-link-for-pages */
export function WritingBrand() {
  return (
    <a className="brand" aria-label="QuillTip home" href="/">
      <svg viewBox="0 0 100 112" aria-hidden="true">
        <defs>
          <mask id="writing-ring">
            <rect width="110" height="120" fill="white" />
            <path
              d="M47 49 78 60 98 106 53 83Z"
              fill="black"
              stroke="black"
              strokeWidth="11"
            />
          </mask>
        </defs>
        <path
          mask="url(#writing-ring)"
          transform="translate(5.88 .3) scale(.88 .94)"
          fill="currentColor"
          fillRule="evenodd"
          d="M49 5C18 5 5 24 5 49s14 44 44 44 47-18 47-44S80 5 49 5ZM49 16c21 0 32 12 32 33S70 81 49 81 17 70 17 49s11-33 32-33Z"
        />
        <path fill="currentColor" d="M47 49 78 60 98 106 53 83Z" />
        <circle cx="68" cy="74" r="6" fill="var(--paper)" />
        <path d="M68 74 98 106" stroke="var(--paper)" strokeWidth="3" />
      </svg>
      <span className="brand-word">uillTip</span>
      <span className="desk-label"> / Writing desk</span>
    </a>
  )
}
