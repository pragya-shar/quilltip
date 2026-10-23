'use client'

import { useRef, useState } from 'react'
import { Camera, ImageOff, ImageUp, Link2, Loader2 } from 'lucide-react'
import { useAction, useConvex, useMutation } from 'convex/react'
import { toast } from 'sonner'

import { UserAvatar } from '@/components/ui/user-avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/convex/_generated/api'
import { compressImage, uploadAvatarFile } from '@/lib/upload'

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

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
  const updateProfile = useMutation(api.users.updateProfile)
  const clearAvatar = useMutation(api.users.clearAvatar)
  const resolveWikimediaFileUrl = useAction(
    api.wikimedia.resolveWikimediaFileUrl
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const avatarMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [isSavingUrl, setIsSavingUrl] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const isBusy = isUploading || isRemoving || isSavingUrl

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

  const handleSaveUrl = async () => {
    if (isBusy) return
    const trimmed = urlInput.trim()
    if (!trimmed) {
      toast.error('Enter an image URL')
      return
    }
    if (!isValidHttpUrl(trimmed)) {
      toast.error('URL must start with http:// or https://')
      return
    }

    setIsSavingUrl(true)
    try {
      const resolved = await resolveWikimediaFileUrl({ pageUrl: trimmed })
      let avatarUrl = trimmed
      if (resolved.kind === 'ok') {
        avatarUrl = resolved.directUrl
      } else if (resolved.kind === 'unresolved') {
        toast.error(
          'Could not resolve that Wikimedia link. Use a direct image address (for example from upload.wikimedia.org) or upload a file instead.'
        )
        return
      }

      await updateProfile({ avatar: avatarUrl })
      toast.success('Profile photo updated')
      setUrlDialogOpen(false)
      setUrlInput('')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save image URL'
      )
    } finally {
      setIsSavingUrl(false)
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

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              ref={avatarMenuTriggerRef}
              type="button"
              disabled={isBusy}
              className="profile-photo-trigger"
              aria-label="Change profile photo"
              aria-busy={isBusy}
            >
              {isUploading || isRemoving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="profile-photo-menu"
            onCloseAutoFocus={(event) => {
              if (urlDialogOpen) event.preventDefault()
            }}
          >
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
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              disabled={isBusy}
              onSelect={(ev) => {
                ev.preventDefault()
                setMenuOpen(false)
                setUrlDialogOpen(true)
              }}
            >
              <Link2 className="h-4 w-4" />
              Paste image URL
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
      </div>

      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent
          className="profile-photo-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            avatarMenuTriggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Change your profile photo</DialogTitle>
            <DialogDescription>
              Paste a direct image link (ends in .jpg, .png, etc.), or a
              Wikipedia / Wikimedia Commons &quot;File:&quot; page URL; those
              are resolved automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="avatar-url">Image URL</Label>
            <Input
              id="avatar-url"
              type="url"
              placeholder="https://"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveUrl()
              }}
              disabled={isSavingUrl}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUrlDialogOpen(false)
                setUrlInput('')
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveUrl()}
              disabled={isSavingUrl}
            >
              {isSavingUrl ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving
                </>
              ) : (
                'Save photo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
