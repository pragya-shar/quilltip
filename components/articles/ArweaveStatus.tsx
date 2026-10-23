'use client'

import { useId, useState } from 'react'
import {
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react'
import type { ArweaveStatus as ArweaveStatusType } from '@/lib/arweave/types'
import { cn } from '@/lib/utils'

interface ArweaveStatusProps {
  status?: string
  txId?: string
  url?: string
  timestamp?: number
}

const statusConfig: Record<
  ArweaveStatusType,
  { className: string; icon: React.ReactNode; label: string }
> = {
  pending: {
    className: 'bg-ui-warning text-ui-warning-foreground',
    icon: <Clock className="w-4 h-4" />,
    label: 'Uploading to Arweave',
  },
  uploaded: {
    className: 'bg-ui-info text-ui-info-foreground',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    label: 'Confirming on Arweave',
  },
  verified: {
    className: 'bg-ui-success text-ui-success-foreground',
    icon: <CheckCircle className="w-4 h-4" />,
    label: 'Permanently stored',
  },
  failed: {
    className: 'bg-ui-surface text-ui-danger',
    icon: <XCircle className="w-4 h-4" />,
    label: 'Upload failed',
  },
}

export function ArweaveStatus({
  status,
  txId,
  url,
  timestamp,
}: ArweaveStatusProps) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()

  if (!status) return null

  const config =
    statusConfig[status as ArweaveStatusType] || statusConfig.pending

  return (
    <div className={cn('reader-storage', config.className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={txId ? expanded : undefined}
        aria-controls={txId ? detailsId : undefined}
        disabled={!txId}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          {config.icon}
          <span className="font-medium text-sm">{config.label}</span>
        </div>
        {txId &&
          (expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          ))}
      </button>

      {expanded && txId && (
        <div
          id={detailsId}
          className="mt-3 pt-3 border-t border-current/10 space-y-2 text-sm"
        >
          <div>
            <span className="opacity-70">Transaction ID:</span>
            <code className="ml-2 font-mono text-xs">{txId}</code>
          </div>
          {timestamp && (
            <div>
              <span className="opacity-70">Uploaded:</span>
              <span className="ml-2">
                {new Date(timestamp).toLocaleString()}
              </span>
            </div>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
            >
              View on Arweave <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
