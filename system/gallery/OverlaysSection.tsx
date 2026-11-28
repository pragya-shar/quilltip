'use client'

import { useState } from 'react'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { Menu } from '../components/Menu'
import { Notice } from '../components/Notice'
import { Sheet } from '../components/Sheet'
import { TestnetNote } from '../components/TestnetNote'
import { LinkIcon, SaveImageIcon, ShareIcon } from '../icons'
import { showToast } from '../toast'
import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'

/** Sheet, dialog, menu, toasts and notices. */
export function OverlaysSection() {
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState(false)
  return (
    <GallerySection id="overlays" title="Sheets, dialogs, menus and messages">
      <Specimen name="Sheet">
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Open the sheet
        </Button>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Add money to tip $3"
          description="You have $0.40. Tomás gets your $3 as soon as it lands."
          actions={
            <>
              <Button
                variant="primary"
                size="l"
                block
                onClick={() => setSheet(false)}
              >
                Add $10 and tip $3
              </Button>
              <TestnetNote />
            </>
          }
        >
          <p className="qt-gallery__text">
            Drag the top of the sheet down to close it, press Escape, or use the
            close button.
          </p>
        </Sheet>
      </Specimen>
      <Specimen name="Dialog">
        <Button variant="secondary" onClick={() => setDialog(true)}>
          Open the dialog
        </Button>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Sign out?"
          description="Your balance stays. Sign in again to tip."
          actions={
            <>
              <Button variant="primary" onClick={() => setDialog(false)}>
                Sign out
              </Button>
              <Button variant="secondary" onClick={() => setDialog(false)}>
                Stay
              </Button>
            </>
          }
        />
      </Specimen>
      <Specimen name="Menu whose first action is not available">
        <Menu
          label="Article actions"
          items={[
            {
              id: 'download',
              label: 'Download (not available yet)',
              disabled: true,
              onSelect: () => {},
            },
            {
              id: 'copy',
              label: 'Copy link',
              icon: LinkIcon,
              onSelect: () => showToast({ title: 'Link copied', tone: 'done' }),
            },
            {
              id: 'report',
              label: 'Report',
              onSelect: () => showToast({ title: 'Reported' }),
            },
          ]}
        />
      </Specimen>
      <Specimen name="Menu">
        <Menu
          label="Share options"
          icon={ShareIcon}
          items={[
            {
              id: 'copy',
              label: 'Copy link',
              icon: LinkIcon,
              onSelect: () => showToast({ title: 'Link copied', tone: 'done' }),
            },
            {
              id: 'save',
              label: 'Save image',
              icon: SaveImageIcon,
              onSelect: () => {},
            },
            {
              id: 'report',
              label: 'Report this article',
              tone: 'danger',
              onSelect: () => {},
            },
          ]}
        />
      </Specimen>
      <Specimen name="Toasts">
        <div className="qt-gallery__row">
          <Button
            variant="secondary"
            onClick={() =>
              showToast({
                tone: 'done',
                title: 'You tipped Tomás $3',
                description: 'You are supporter #88. Only you see this.',
                action: {
                  label: 'Share',
                  onAction: () => showToast({ title: 'Share opens here' }),
                },
              })
            }
          >
            Sent
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              showToast({
                tone: 'failure',
                title: 'That tip did not go through',
                description: 'You were not charged.',
              })
            }
          >
            Failed
          </Button>
          <Button
            variant="secondary"
            onClick={() => showToast({ title: 'Link copied' })}
          >
            Info
          </Button>
        </div>
      </Specimen>
      <Specimen name="Notice, pending" wide>
        <Notice tone="pending" title="Some tips are taking longer than usual">
          They stay “On its way” until they arrive. If one cannot complete, it
          shows here and the reader is not charged.
        </Notice>
      </Specimen>
      <Specimen name="Notice, failure">
        <Notice
          tone="failure"
          title="This page did not load"
          action={<Button variant="secondary">Try again</Button>}
        >
          Your balance and anything you sent are unaffected.
        </Notice>
      </Specimen>
      <Specimen name="Notice, offline">
        <Notice tone="offline">
          You are offline. Tip again when you are back online.
        </Notice>
      </Specimen>
      <Specimen name="Notice, done">
        <Notice tone="done">Withdrawn to your wallet.</Notice>
      </Specimen>
      <Specimen name="Notice, info">
        <Notice tone="info">You keep 97.5% of every tip.</Notice>
      </Specimen>
    </GallerySection>
  )
}
