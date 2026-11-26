'use client'

import { ProfileAvatarEditor } from '@/components/profile/ProfileAvatarEditor'
import { ProfileHandleEditor } from '@/components/profile/ProfileHandleEditor'
import { MAX_RETIRED_HANDLES } from '@/lib/profile/handleRules'
import { SITE_HOST } from '@/lib/profile/profileUrl'

/** Photo and handle. Each saves as soon as the writer confirms it. */
export function ProfileIdentitySettings({
  name,
  username,
  avatar,
}: {
  name: string
  username: string
  avatar?: string | null
}) {
  return (
    <div className="settings-identity">
      <div className="settings-row">
        <div className="settings-portrait">
          <ProfileAvatarEditor
            avatar={avatar}
            name={name}
            username={username}
          />
        </div>
        <div className="settings-row-text">
          <h2 className="settings-row-title">Photo</h2>
          <p className="settings-hint">
            Use the camera button to upload a photo, paste an image link, or
            remove it.
          </p>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <h2 className="settings-row-title">Handle</h2>
          <p className="settings-url">
            {SITE_HOST}/<strong>{username}</strong>
          </p>
          <p className="settings-hint">
            Your handle is in your profile and article links. Old links keep
            working after a change, and you can keep up to {MAX_RETIRED_HANDLES}{' '}
            earlier handles.
          </p>
        </div>
        <ProfileHandleEditor username={username} onChanged={() => undefined} />
      </div>
    </div>
  )
}
