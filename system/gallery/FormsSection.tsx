'use client'

import { useState } from 'react'
import { Tabs } from '../components/Tabs'
import { TextField } from '../components/TextField'
import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'

const FEED = [
  { id: 'lines', label: 'Top lines', panelId: 'gallery-feed-panel' },
  { id: 'articles', label: 'Articles', panelId: 'gallery-feed-panel' },
  { id: 'following', label: 'Following', panelId: 'gallery-feed-panel' },
]
const RANGE = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All time' },
]

/** Text fields and tabs. */
export function FormsSection() {
  const [tab, setTab] = useState('lines')
  const [range, setRange] = useState('month')
  const [name, setName] = useState('')
  return (
    <GallerySection id="forms" title="Fields and tabs">
      <Specimen name="Text field">
        <TextField
          label="Name on your tips"
          hint="Readers see this only if you choose to show it."
          autoComplete="nickname"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Specimen>
      <Specimen name="With a prefix">
        <TextField
          label="Amount"
          prefix="$"
          inputMode="decimal"
          defaultValue="2.50"
        />
      </Specimen>
      <Specimen name="Error">
        <TextField
          label="Email"
          type="email"
          defaultValue="tomas@"
          error="Enter an email like name@example.com."
        />
      </Specimen>
      <Specimen name="Disabled">
        <TextField
          label="Your Quilltip address"
          defaultValue="tomas"
          disabled
        />
      </Specimen>
      <Specimen name="Tabs" wide>
        <Tabs items={FEED} value={tab} onChange={setTab} label="Feed" />
        <div
          id="gallery-feed-panel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className="qt-gallery__text"
        >
          Showing {FEED.find((item) => item.id === tab)?.label}.
        </div>
      </Specimen>
      <Specimen name="Segmented control">
        <Tabs
          items={RANGE}
          value={range}
          onChange={setRange}
          label="Range"
          variant="segmented"
        />
      </Specimen>
    </GallerySection>
  )
}
