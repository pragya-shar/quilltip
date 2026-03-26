'use client'

import { useRef, useState } from 'react'
import {
  Camera,
  ImageOff,
  ImageUp,
  Link2,
  Loader2,
} from 'lucide-react'
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
import { cn } from '@/lib/utils'

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
  const resolveWikimediaFileUrl = useAction(api.wikimedia.resolveWikimediaFileUrl)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [isSavingUrl, setIsSavingUrl] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

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
          className="h-[120px] w-[120px] border-4 border-border"
          fallbackClassName="text-4xl font-bold"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={isUploading || isRemoving}
              className={cn(
                'absolute bottom-0 right-0 z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 border-border bg-background text-foreground shadow-md transition-colors',
                'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                (isUploading || isRemoving) && 'pointer-events-none opacity-60'
              )}
              aria-label="Change profile photo"
            >
              {isUploading || isRemoving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[11rem]">
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={(ev) => {
                ev.preventDefault()
                fileInputRef.current?.click()
              }}
            >
              <ImageUp className="h-4 w-4" />
              Upload photo
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={(ev) => {
                ev.preventDefault()
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
                  className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                  onSelect={(ev) => {
                    ev.preventDefault()
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Image URL</DialogTitle>
            <DialogDescription>
              Paste a direct image link (ends in .jpg, .png, etc.), or a
              Wikipedia / Wikimedia Commons &quot;File:&quot; page URL; those
              are resolved automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="avatar-url">URL</Label>
            <Input
              id="avatar-url"
              type="url"
              placeholder="https://"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveUrl()
              }}
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
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
