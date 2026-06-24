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
  const [showPopupBlockedFallback, setShowPopupBlockedFallback] =
    useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const clearExistingTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
  }

  const showTransientError = (message: string, ms = 3000) => {
    clearExistingTimeout()
    setCopied(false)
    setError(message)
    timeoutRef.current = setTimeout(() => setError(null), ms)
  }

  const showTransientCopied = () => {
    clearExistingTimeout()
    setCopied(true)
    timeoutRef.current = setTimeout(() => setCopied(false), 2000)
  }

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
      clearExistingTimeout()
    }
  }, [])

  // Copy link to clipboard
  const handleCopyLink = async () => {
    setError(null)

    try {
      // Modern Clipboard API (requires HTTPS)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
        showTransientCopied()
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
          showTransientCopied()
        } else {
          throw new Error('Copy command failed')
        }
      } finally {
        document.body.removeChild(textArea)
      }
    } catch {
      showTransientError('Failed to copy link. Please manually copy the URL.')
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
        showTransientError('Sharing failed. Please try another method.')
      }
    }
  }

  // Open share URL in new window
  const openShareWindow = (shareUrl: string) => {
    setError(null)
    const popup = window.open(
      shareUrl,
      'share-dialog',
      'width=626,height=436,resizable=yes,scrollbars=yes'
    )

    // Check if popup was blocked
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      setShowPopupBlockedFallback(true)
      showTransientError('Popup was blocked. Use the share options below.')
    }
  }

  return (
    <div className={`${className}`}>
      {/* Error message */}
      {error && (
        <div className="mb-2 text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded px-3 py-1">
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
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-brand hover:bg-muted rounded-lg transition-colors"
          aria-label="Share on Twitter"
        >
          <Twitter className="h-4 w-4" />
          <span className="hidden sm:inline">Twitter</span>
        </button>

        {/* LinkedIn */}
        <button
          onClick={() => openShareWindow(shareUrls.linkedin)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-brand hover:bg-muted rounded-lg transition-colors"
          aria-label="Share on LinkedIn"
        >
          <Linkedin className="h-4 w-4" />
          <span className="hidden sm:inline">LinkedIn</span>
        </button>

        {/* Facebook */}
        <button
          onClick={() => openShareWindow(shareUrls.facebook)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-brand hover:bg-muted rounded-lg transition-colors"
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
              <Check className="h-4 w-4 text-success-foreground" />
              <span className="hidden sm:inline text-success-foreground">
                Copied!
              </span>
            </>
          ) : (
            <>
              <Link className="h-4 w-4" />
              <span className="hidden sm:inline">Copy Link</span>
            </>
          )}
        </button>
      </div>

      {showPopupBlockedFallback && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground">
              Popup blocked. Share using these links instead.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowPopupBlockedFallback(false)
              }}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 self-start sm:self-auto"
            >
              Dismiss
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={shareUrls.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:text-brand hover:bg-muted transition-colors"
              aria-label="Open Twitter share in new tab"
            >
              <Twitter className="h-4 w-4" />
              <span>Twitter</span>
            </a>
            <a
              href={shareUrls.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:text-brand hover:bg-muted transition-colors"
              aria-label="Open LinkedIn share in new tab"
            >
              <Linkedin className="h-4 w-4" />
              <span>LinkedIn</span>
            </a>
            <a
              href={shareUrls.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:text-brand hover:bg-muted transition-colors"
              aria-label="Open Facebook share in new tab"
            >
              <Facebook className="h-4 w-4" />
              <span>Facebook</span>
            </a>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:text-brand-blue hover:bg-muted transition-colors"
              aria-label="Copy link (fallback panel)"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-success-foreground" />
                  <span className="text-success-foreground">Copied!</span>
                </>
              ) : (
                <>
                  <Link className="h-4 w-4" />
                  <span>Copy Link</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
