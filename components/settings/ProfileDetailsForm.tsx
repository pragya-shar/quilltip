'use client'

import { useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import {
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  profileBioError,
  profileNameError,
} from '@/lib/profile/profileRules'

type Errors = { name?: string; bio?: string; form?: string }

function validate(name: string, bio: string): Errors {
  const errors: Errors = {}
  const nameError = profileNameError(name)
  const bioError = profileBioError(bio)
  if (nameError) errors.name = nameError
  if (bioError) errors.bio = bioError
  return errors
}

/**
 * Display name and bio. Saves optimistically: the header and writer page show
 * the new values at once and roll back if the server rejects them.
 */
export function ProfileDetailsForm({
  initialName,
  initialBio,
}: {
  initialName: string
  initialBio: string
}) {
  const [name, setName] = useState(initialName)
  const [bio, setBio] = useState(initialBio)
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const bioRef = useRef<HTMLTextAreaElement>(null)

  const updateProfile = useMutation(
    api.users.updateProfile
  ).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.users.getCurrentUser, {})
    if (!current) return
    store.setQuery(
      api.users.getCurrentUser,
      {},
      {
        ...current,
        name: args.name?.trim() ?? current.name,
        bio:
          args.bio === undefined ? current.bio : args.bio.trim() || undefined,
      }
    )
  })

  const bioLength = bio.trim().length
  const bioOver = bioLength > PROFILE_BIO_MAX_LENGTH

  function update(field: 'name' | 'bio', value: string) {
    if (field === 'name') setName(value)
    else setBio(value)
    // Reward early: once a field has shown an error, re-check as they type.
    if (submitted) {
      setErrors(
        validate(field === 'name' ? value : name, field === 'bio' ? value : bio)
      )
    }
  }

  async function save() {
    if (saving) return
    setSubmitted(true)
    const found = validate(name, bio)
    setErrors(found)
    if (found.name) return nameRef.current?.focus()
    if (found.bio) return bioRef.current?.focus()

    setSaving(true)
    try {
      await updateProfile({ name, bio })
      setName(name.trim())
      setBio(bio.trim())
      setSubmitted(false)
      toast.success('Profile saved')
    } catch (error) {
      const message =
        error instanceof ConvexError && typeof error.data === 'string'
          ? error.data
          : 'Your profile wasn’t saved. Check your connection and try again.'
      setErrors({ form: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="settings-form"
      noValidate
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {errors.form && (
        <p className="settings-error settings-error-banner" role="alert">
          {errors.form}
        </p>
      )}
      <div className="settings-field">
        <label htmlFor="settings-name">Display name</label>
        <input
          ref={nameRef}
          id="settings-name"
          name="name"
          value={name}
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={
            errors.name ? 'settings-name-error' : 'settings-name-hint'
          }
          onChange={(event) => update('name', event.target.value)}
        />
        {errors.name ? (
          <p id="settings-name-error" className="settings-error">
            {errors.name}
          </p>
        ) : (
          <p id="settings-name-hint" className="settings-hint">
            Shown on your writer page and on your articles. Up to{' '}
            {PROFILE_NAME_MAX_LENGTH} characters.
          </p>
        )}
      </div>
      <div className="settings-field">
        <div className="settings-label-row">
          <label htmlFor="settings-bio">
            Bio <span className="settings-optional">Optional</span>
          </label>
          <span
            id="settings-bio-count"
            className="settings-count"
            data-over={bioOver || undefined}
          >
            {bioLength} / {PROFILE_BIO_MAX_LENGTH}
          </span>
        </div>
        <textarea
          ref={bioRef}
          id="settings-bio"
          name="bio"
          rows={5}
          value={bio}
          aria-invalid={Boolean(errors.bio)}
          aria-describedby={
            errors.bio
              ? 'settings-bio-error settings-bio-count'
              : 'settings-bio-hint settings-bio-count'
          }
          onChange={(event) => update('bio', event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void save()
            }
          }}
        />
        {errors.bio ? (
          <p id="settings-bio-error" className="settings-error">
            {errors.bio}
          </p>
        ) : (
          <p id="settings-bio-hint" className="settings-hint">
            A line or two about what you write. Readers see it on your writer
            page and when your profile is shared.
          </p>
        )}
      </div>
      <button type="submit" className="settings-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  )
}
