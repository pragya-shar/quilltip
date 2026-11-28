import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { ProfileAvatarEditor } from '../../../components/profile/ProfileAvatarEditor'

// `?photo=none` is the welcome step: a writer with no photo yet.
const initial =
  new URLSearchParams(location.search).get('photo') === 'none'
    ? ''
    : 'http://127.0.0.1:4176/api/storage/original.svg'

function Fixture() {
  const [avatar, setAvatar] = useState(initial)
  useEffect(() => {
    const saved = (event: Event) => setAvatar((event as CustomEvent).detail)
    window.addEventListener('avatar-saved', saved)
    return () => window.removeEventListener('avatar-saved', saved)
  }, [])
  return (
    <main className="profile-page min-h-screen p-12">
      <ProfileAvatarEditor avatar={avatar} name="QA Writer" username="qa" />
      <a href="#articles">Read articles</a>
      <Toaster />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
