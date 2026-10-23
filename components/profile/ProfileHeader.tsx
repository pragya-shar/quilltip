import { UserAvatar } from '@/components/ui/user-avatar'
import { ProfileAvatarEditor } from '@/components/profile/ProfileAvatarEditor'
import { formatDistanceToNow } from 'date-fns'

interface ProfileHeaderProps {
  user: {
    id: string
    username: string
    name?: string | null
    bio?: string | null
    avatar?: string | null
    createdAt: Date | string
    articleCount: number | null
  }
  isOwnProfile?: boolean
}

export default function ProfileHeader({
  user,
  isOwnProfile = false,
}: ProfileHeaderProps) {
  const memberSince = formatDistanceToNow(new Date(user.createdAt), {
    addSuffix: true,
  })

  return (
    <header className="profile-identity">
      <div className="profile-portrait">
        {isOwnProfile ? (
          <ProfileAvatarEditor
            avatar={user.avatar}
            name={user.name || user.username}
            username={user.username}
          />
        ) : (
          <UserAvatar
            src={user.avatar}
            alt={user.name || user.username}
            name={user.name || user.username}
            className="profile-avatar"
            fallbackClassName="profile-avatar-fallback"
          />
        )}
      </div>
      <div className="profile-introduction">
        <h1>{user.name || user.username}</h1>
        <p className="profile-handle">@{user.username}</p>
        {user.bio && <p className="profile-bio">{user.bio}</p>}
        <div className="profile-member-info">
          <p>
            <strong>{user.articleCount ?? '…'}</strong>{' '}
            {user.articleCount === 1 ? 'article' : 'articles'} published
          </p>
          <p>Joined {memberSince}</p>
        </div>
      </div>
    </header>
  )
}
