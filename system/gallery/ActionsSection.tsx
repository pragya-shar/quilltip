'use client'

import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { TextLink } from '../components/TextLink'
import { KeepDemo } from './KeepDemo'
import { AddIcon, ShareIcon, WithdrawIcon } from '../icons'
import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'
import { worst } from './samples'

const VARIANTS = ['primary', 'secondary', 'quiet', 'danger'] as const

/** Buttons, icon buttons and links in every state. */
export function ActionsSection() {
  return (
    <GallerySection
      id="actions"
      title="Buttons and links"
      note="Hover, focus and press respond to a real pointer or keyboard; the tests drive them."
    >
      {VARIANTS.map((variant) => (
        <Specimen key={variant} name={`Button ${variant}`}>
          <div className="qt-gallery__row">
            <Button variant={variant}>
              {variant === 'danger' ? 'Try again' : 'Add money'}
            </Button>
            <Button variant={variant} icon={AddIcon}>
              With icon
            </Button>
            <Button variant={variant} loading>
              Saving
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </div>
        </Specimen>
      ))}
      <Specimen name="Button large, full width">
        <Button variant="primary" size="l" block icon={WithdrawIcon}>
          Withdraw $280.40
        </Button>
      </Specimen>
      <Specimen name="Button with a long label">
        <Button variant="secondary" block>
          {`Follow ${worst.longName}`}
        </Button>
      </Specimen>
      <Specimen name="Icon buttons">
        <div className="qt-gallery__row">
          <IconButton icon={ShareIcon} label="Share" />
          <IconButton icon={ShareIcon} label="Share (sunk)" variant="sunk" />
          <IconButton icon={AddIcon} label="Add money" variant="action" />
          <IconButton icon={ShareIcon} label="Sharing" loading />
          <IconButton icon={ShareIcon} label="Share (disabled)" disabled />
        </div>
      </Specimen>
      <Specimen name="Keep (live): keep, kept, saving, disabled">
        <KeepDemo />
      </Specimen>
      <Specimen name="Links">
        <p className="qt-gallery__text">
          Read the <TextLink href="/terms">terms</TextLink> or{' '}
          <TextLink href="https://developers.stellar.org" external>
            Stellar’s docs
          </TextLink>
          .
        </p>
        <TextLink href="/articles" variant="standalone">
          Read more
        </TextLink>
      </Specimen>
    </GallerySection>
  )
}
