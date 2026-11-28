'use client'

import { useState } from 'react'
import { Switch } from '../components/Switch'
import { Tabs, tabId } from '../components/Tabs'
import { TextField } from '../components/TextField'
import { LiveErrorDemo } from './LiveErrorDemo'
import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'
import { SwitchDemo } from './SwitchDemo'

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

const noop = () => {}

/** Text fields, switches and tabs. */
export function FormsSection() {
  const [tab, setTab] = useState('lines')
  const [range, setRange] = useState('month')
  const [name, setName] = useState('')
  return (
    <GallerySection id="forms" title="Fields, switches and tabs">
      <Specimen name="Switch, saving for real" wide>
        <SwitchDemo />
      </Specimen>
      <Specimen name="Switch states">
        <div className="qt-gallery__stack" style={{ alignSelf: 'stretch' }}>
          <Switch label="One tap sends" checked onChange={noop} />
          <Switch
            label="Ask first above $5 a day"
            checked={false}
            onChange={noop}
          />
          <Switch label="Saving" checked pending onChange={noop} />
          <Switch
            label="Not available here"
            checked={false}
            disabled
            onChange={noop}
          />
          <Switch
            label="Show my name on tips"
            checked={false}
            error="That did not save. Try again."
            onChange={noop}
          />
        </div>
      </Specimen>
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
      <Specimen name="Error while focus is elsewhere">
        <LiveErrorDemo />
      </Specimen>
      <Specimen name="Disabled">
        <TextField
          label="Your Quilltip address"
          defaultValue="tomas"
          disabled
        />
      </Specimen>
      <Specimen name="Tabs" wide>
        <Tabs
          items={FEED}
          value={tab}
          onChange={setTab}
          label="Feed"
          idBase="gallery-feed"
        />
        <div
          id="gallery-feed-panel"
          role="tabpanel"
          aria-labelledby={tabId('gallery-feed', tab)}
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
