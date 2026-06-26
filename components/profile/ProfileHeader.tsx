import { User, Calendar } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'
import { ProfileAvatarEditor } from '@/components/profile/ProfileAvatarEditor'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'

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

  const content = (
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

      <div className="flex-grow">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-foreground">
            {user.name || user.username}
          </h1>
          <p className="text-lg text-muted-foreground">@{user.username}</p>
        </div>

        {user.bio && (
          <p className="text-foreground mb-4 max-w-2xl">{user.bio}</p>
        )}

        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand-blue/10 rounded-lg">
              <User className="w-4 h-4 text-brand-blue" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                {user.articleCount}
              </p>
              <p className="text-muted-foreground">
                {user.articleCount === 1 ? 'Article' : 'Articles'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand-blue/10 rounded-lg">
              <Calendar className="w-4 h-4 text-brand-blue" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Member</p>
              <p className="text-muted-foreground">Joined {memberSince}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (isOwnProfile) {
    return <div className="border-b border-border pb-8">{content}</div>
  }

  return (
    <Card variant="default">
      <CardContent className="pt-6">{content}</CardContent>
    </Card>
  )
}
