'use client'

import { useState } from 'react'
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

interface ArweaveStatusProps {
  status?: string
  txId?: string
  url?: string
  timestamp?: number
}

const statusConfig: Record<
  ArweaveStatusType,
  { color: string; icon: React.ReactNode; label: string }
> = {
  pending: {
    color: 'bg-warning text-warning-foreground',
    icon: <Clock className="w-4 h-4" />,
    label: 'Uploading to Arweave',
  },
  uploaded: {
    color: 'bg-info text-info-foreground',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    label: 'Confirming on Arweave',
  },
  verified: {
    color: 'bg-success text-success-foreground',
    icon: <CheckCircle className="w-4 h-4" />,
    label: 'Permanently stored',
  },
  failed: {
    color: 'bg-destructive/10 text-destructive',
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

  if (!status) return null

  const config =
    statusConfig[status as ArweaveStatusType] || statusConfig.pending

  return (
    <div className={`rounded-lg p-3 ${config.color}`}>
      <button
        onClick={() => setExpanded(!expanded)}
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
        <div className="mt-3 pt-3 border-t border-current/10 space-y-2 text-sm">
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
