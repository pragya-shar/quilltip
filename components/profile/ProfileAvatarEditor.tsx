'use client'

import { useRef, useState } from 'react'
import { Camera, ImageOff, ImageUp, Loader2 } from 'lucide-react'
import { useConvex, useMutation } from 'convex/react'
import { toast } from 'sonner'

import { UserAvatar } from '@/components/ui/user-avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/convex/_generated/api'
import { compressImage, uploadAvatarFile } from '@/lib/upload'

interface ProfileAvatarEditorProps {
  avatar?: string | null
  name: string
  username: string
}

export function ProfileAvatarEditor({
  avatar,
  name,
  username,
}: ProfileAvatarEditorProps) {
  const convex = useConvex()
  const clearAvatar = useMutation(api.users.clearAvatar)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const isBusy = isUploading || isRemoving

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || isBusy) return

    setIsUploading(true)
    try {
      const compressed = await compressImage(file, 800, 0.88)
      const result = await uploadAvatarFile(compressed, convex)

      if (result.success) {
        toast.success('Profile photo updated')
      } else {
        toast.error(result.error || 'Upload failed')
      }
    } catch {
      toast.error('Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemovePhoto = async () => {
    if (isBusy) return
    setIsRemoving(true)
    try {
      await clearAvatar()
      toast.success('Profile photo removed')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not remove profile photo'
      )
    } finally {
      setIsRemoving(false)
    }
  }

  const hasPhoto = Boolean(avatar?.trim())

  return (
    <>
      <div className="relative inline-flex shrink-0">
        <UserAvatar
          src={avatar}
          alt={name || username}
          name={name || username}
          className="profile-avatar"
          fallbackClassName="profile-avatar-fallback"
        />

        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => {
            if (!open || !isBusy) setMenuOpen(open)
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              // Stays focusable during an upload or a removal, so focus stays.
              aria-disabled={isBusy}
              className="profile-photo-trigger"
              aria-label="Change profile photo"
              aria-busy={isBusy}
            >
              {isUploading || isRemoving ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="profile-photo-menu">
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              disabled={isBusy}
              onSelect={(ev) => {
                ev.preventDefault()
                setMenuOpen(false)
                fileInputRef.current?.click()
              }}
            >
              <ImageUp className="h-4 w-4" />
              Upload photo
            </DropdownMenuItem>
            {hasPhoto ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-ui-danger focus:text-ui-danger"
                  disabled={isBusy}
                  onSelect={(ev) => {
                    ev.preventDefault()
                    setMenuOpen(false)
                    void handleRemovePhoto()
                  }}
                >
                  <ImageOff className="h-4 w-4" />
                  Remove photo
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={handleFileChange}
        />
        {/* Announced once while it runs; the result comes as a toast. */}
        <span role="status" className="sr-only">
          {isUploading
            ? 'Uploading your photo…'
            : isRemoving
              ? 'Removing your photo…'
              : ''}
        </span>
      </div>
    </>
  )
}
