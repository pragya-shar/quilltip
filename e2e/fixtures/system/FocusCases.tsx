import { useRef, useState } from 'react'
import { Sheet } from '../../../system/components/Sheet'

/**
 * Two focus cases for sheets (fixture route /sheets):
 * - the opener is gone when the sheet closes: focus goes to the page
 *   content, never the body;
 * - the page moves focus while the sheet goes away: focus stays there.
 */
export function FocusCases() {
  const [vanishing, setVanishing] = useState<'idle' | 'open' | 'gone'>('idle')
  const [leaving, setLeaving] = useState(false)
  const landing = useRef<HTMLButtonElement>(null)
  return (
    <>
      {vanishing === 'idle' ? (
        <button
          type="button"
          className="qt-button"
          data-variant="secondary"
          onClick={() => setVanishing('open')}
        >
          Open, and the opener goes
        </button>
      ) : null}
      <Sheet
        open={vanishing === 'open'}
        onClose={() => setVanishing('gone')}
        title="The opener is gone"
      >
        <p>Close this: the button that opened it has left the page.</p>
      </Sheet>
      <button
        type="button"
        className="qt-button"
        data-variant="secondary"
        onClick={() => setLeaving(true)}
      >
        Open, then the page moves on
      </button>
      <button type="button" className="qt-button" ref={landing}>
        Where the page went
      </button>
      {leaving ? (
        <Sheet open onClose={() => setLeaving(false)} title="The page moves on">
          <button
            type="button"
            className="qt-button"
            data-variant="primary"
            onClick={() => {
              // The page replaces the sheet and puts focus where it went.
              setLeaving(false)
              requestAnimationFrame(() => landing.current?.focus())
            }}
          >
            Go on
          </button>
        </Sheet>
      ) : null}
    </>
  )
}
