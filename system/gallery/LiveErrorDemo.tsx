'use client'

import { useState } from 'react'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'

/** A field checked by the server while focus stays on the button: the
 * error comes through the field's polite live region. */
export function LiveErrorDemo() {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="qt-gallery__stack">
      <TextField
        label="Your Quilltip address"
        defaultValue="tomas"
        error={error}
        errorAnnouncement="live"
      />
      <Button
        variant="secondary"
        onClick={() => setError('That address is taken. Try another.')}
      >
        Check address
      </Button>
    </div>
  )
}
