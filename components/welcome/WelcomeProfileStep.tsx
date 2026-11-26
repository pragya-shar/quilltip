'use client'

import { useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '@/convex/_generated/api'
import { ProfileAvatarEditor } from '@/components/profile/ProfileAvatarEditor'
import {
  PROFILE_BIO_MAX_LENGTH,
  profileBioError,
} from '@/lib/profile/profileRules'

type Finish = 'primary' | 'articles' | 'skip'

/** Step 2: an optional photo and bio, then into the product. */
export function WelcomeProfileStep({
  name,
  username,
  avatar,
  initialBio,
  primaryLabel,
  onFinish,
}: {
  name: string
  username: string
  avatar?: string | null
  initialBio: string
  primaryLabel: string
  onFinish: (choice: Finish) => Promise<void>
}) {
  const updateProfile = useMutation(api.users.updateProfile)
  const [bio, setBio] = useState(initialBio)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Finish | null>(null)
  const bioRef = useRef<HTMLTextAreaElement>(null)
  const bioLength = bio.trim().length

  async function finish(choice: Finish) {
    if (busy) return
    setError(null)
    if (choice !== 'skip') {
      const message = profileBioError(bio)
      if (message) {
        setError(message)
        bioRef.current?.focus()
        return
      }
    }
    setBusy(choice)
    try {
      if (choice !== 'skip' && bio.trim() !== initialBio.trim()) {
        await updateProfile({ bio })
      }
      await onFinish(choice)
    } catch (caught) {
      setError(
        caught instanceof ConvexError && typeof caught.data === 'string'
          ? caught.data
          : 'That didn’t save. Check your connection and try again.'
      )
      setBusy(null)
    }
  }

  return (
    <form
      className="settings-form welcome-form"
      noValidate
      aria-busy={Boolean(busy)}
      onSubmit={(event) => {
        event.preventDefault()
        void finish('primary')
      }}
    >
      <div className="settings-row welcome-photo-row">
        <div className="settings-portrait">
          <ProfileAvatarEditor
            avatar={avatar}
            name={name}
            username={username}
          />
        </div>
        <div className="settings-row-text">
          <h3 className="settings-row-title">Photo</h3>
          <p className="settings-hint">
            Use the camera button to upload a photo or paste an image link.
          </p>
        </div>
      </div>
      <div className="settings-field">
        <div className="settings-label-row">
          <label htmlFor="welcome-bio">
            Short bio <span className="settings-optional">Optional</span>
          </label>
          <span
            id="welcome-bio-count"
            className="settings-count"
            data-over={bioLength > PROFILE_BIO_MAX_LENGTH || undefined}
          >
            {bioLength} / {PROFILE_BIO_MAX_LENGTH}
          </span>
        </div>
        <textarea
          ref={bioRef}
          id="welcome-bio"
          name="bio"
          rows={4}
          value={bio}
          placeholder="What do you write about?"
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? 'welcome-bio-error welcome-bio-count' : 'welcome-bio-count'
          }
          onChange={(event) => {
            setBio(event.target.value)
            if (error) setError(profileBioError(event.target.value))
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void finish('primary')
            }
          }}
        />
        {error && (
          <p id="welcome-bio-error" className="settings-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="welcome-actions">
        <button
          type="submit"
          className="settings-primary"
          disabled={Boolean(busy)}
        >
          {busy === 'primary' ? 'One moment…' : primaryLabel}
        </button>
        <button
          type="button"
          className="settings-secondary"
          disabled={Boolean(busy)}
          onClick={() => void finish('articles')}
        >
          {busy === 'articles' ? 'One moment…' : 'Browse articles'}
        </button>
        <button
          type="button"
          className="welcome-skip"
          disabled={Boolean(busy)}
          onClick={() => void finish('skip')}
        >
          Skip for now
        </button>
      </div>
    </form>
  )
}
