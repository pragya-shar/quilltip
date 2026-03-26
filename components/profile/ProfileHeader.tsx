import { User, Calendar } from 'lucide-react'
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
    articleCount: number
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
    <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-8">
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="flex-shrink-0">
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
              className="h-[120px] w-[120px] border-4 border-border"
              fallbackClassName="text-4xl font-bold"
            />
          )}
        </div>

        {/* User Info */}
        <div className="flex-grow">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-foreground">
              {user.name || user.username}
            </h1>
            <p className="text-lg text-muted-foreground">@{user.username}</p>
          </div>

          {/* Bio */}
          {user.bio && (
            <p className="text-foreground mb-4 max-w-2xl">{user.bio}</p>
          )}

          {/* Stats */}
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-brand-blue/10 rounded-lg">
                <User className="w-4 h-4 text-brand-blue" />
              </div>
              <div>
                <p className="font-semibold text-foreground">
                  {user.articleCount}
                </p>
                <p className="text-gray-600">
                  {user.articleCount === 1 ? 'Article' : 'Articles'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="p-2 bg-brand-blue/10 rounded-lg">
                <Calendar className="w-4 h-4 text-brand-blue" />
              </div>
              <div>
                <p className="text-muted-foreground">Member {memberSince}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
