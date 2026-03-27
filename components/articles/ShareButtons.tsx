'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Share2, Twitter, Linkedin, Facebook, Link, Check } from 'lucide-react'

interface ShareButtonsProps {
  title: string
  url: string
  excerpt?: string | null
  className?: string
}

export default function ShareButtons({
  title,
  url,
  excerpt,
  className = '',
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false)
  const [hasNativeShare, setHasNativeShare] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Clean and encode sharing text
  const shareText = excerpt || title
  const encodedTitle = useMemo(() => encodeURIComponent(title), [title])
  const encodedText = useMemo(() => encodeURIComponent(shareText), [shareText])
  const encodedUrl = useMemo(() => encodeURIComponent(url), [url])

  // Share URLs for different platforms
  const shareUrls = useMemo(
    () => ({
      twitter: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
    }),
    [encodedTitle, encodedUrl, encodedText]
  )

  // Check for native share support (client-side only)
  useEffect(() => {
    setHasNativeShare(!!navigator?.share)
  }, [])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Copy link to clipboard
  const handleCopyLink = async () => {
    setError(null)

    try {
      // Modern Clipboard API (requires HTTPS)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        timeoutRef.current = setTimeout(() => setCopied(false), 2000)
        return
      }

      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = url
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()

      try {
        const success = document.execCommand('copy')
        if (success) {
          setCopied(true)
          timeoutRef.current = setTimeout(() => setCopied(false), 2000)
        } else {
          throw new Error('Copy command failed')
        }
      } finally {
        document.body.removeChild(textArea)
      }
    } catch {
      setError('Failed to copy link. Please manually copy the URL.')
      timeoutRef.current = setTimeout(() => setError(null), 3000)
    }
  }

  // Handle Web Share API if available
  const handleNativeShare = async () => {
    if (!navigator.share) return

    setError(null)
    try {
      await navigator.share({
        title,
        text: shareText,
        url,
      })
    } catch (err: unknown) {
      // User cancelled (AbortError) - don't show error
      if (err instanceof Error && err.name !== 'AbortError') {
        setError('Sharing failed. Please try another method.')
        timeoutRef.current = setTimeout(() => setError(null), 3000)
      }
    }
  }

  // Open share URL in new window
  const openShareWindow = (shareUrl: string) => {
    const popup = window.open(
      shareUrl,
      'share-dialog',
      'width=626,height=436,resizable=yes,scrollbars=yes'
    )

    // Check if popup was blocked
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      // Fallback: open in same tab
      window.location.href = shareUrl
    }
  }

  return (
    <div className={`${className}`}>
      {/* Error message */}
      {error && (
        <div className="mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Share label */}
        <span className="text-sm text-muted-foreground font-medium">
          Share:
        </span>

        {/* Native share button (mobile) */}
        {hasNativeShare && (
          <button
            onClick={handleNativeShare}
            className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-brand-blue hover:bg-muted rounded-lg transition-colors"
            aria-label="Share article"
          >
            <Share2 className="h-4 w-4" />
          </button>
        )}

        {/* Twitter */}
        <button
          onClick={() => openShareWindow(shareUrls.twitter)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-blue-500 hover:bg-muted rounded-lg transition-colors"
          aria-label="Share on Twitter"
        >
          <Twitter className="h-4 w-4" />
          <span className="hidden sm:inline">Twitter</span>
        </button>

        {/* LinkedIn */}
        <button
          onClick={() => openShareWindow(shareUrls.linkedin)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-blue-600 hover:bg-muted rounded-lg transition-colors"
          aria-label="Share on LinkedIn"
        >
          <Linkedin className="h-4 w-4" />
          <span className="hidden sm:inline">LinkedIn</span>
        </button>

        {/* Facebook */}
        <button
          onClick={() => openShareWindow(shareUrls.facebook)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-blue-700 hover:bg-muted rounded-lg transition-colors"
          aria-label="Share on Facebook"
        >
          <Facebook className="h-4 w-4" />
          <span className="hidden sm:inline">Facebook</span>
        </button>

        {/* Copy Link */}
        <button
          onClick={handleCopyLink}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-brand-blue hover:bg-muted rounded-lg transition-colors"
          aria-label={copied ? 'Link copied!' : 'Copy link'}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-600" />
              <span className="hidden sm:inline text-green-600">Copied!</span>
            </>
          ) : (
            <>
              <Link className="h-4 w-4" />
              <span className="hidden sm:inline">Copy Link</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
