import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { ProfileAvatarEditor } from '../../../components/profile/ProfileAvatarEditor'

function Fixture() {
  const [avatar, setAvatar] = useState('/original.svg')
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
