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
    color:
      'text-yellow-900 bg-yellow-50 dark:text-yellow-200 dark:bg-yellow-950/50',
    icon: <Clock className="w-4 h-4" />,
    label: 'Uploading to Arweave',
  },
  uploaded: {
    color: 'text-blue-900 bg-blue-50 dark:text-blue-200 dark:bg-blue-950/50',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    label: 'Confirming on Arweave',
  },
  verified: {
    color:
      'text-green-900 bg-green-50 dark:text-green-200 dark:bg-green-950/50',
    icon: <CheckCircle className="w-4 h-4" />,
    label: 'Permanently stored',
  },
  failed: {
    color: 'text-red-900 bg-red-50 dark:text-red-200 dark:bg-red-950/50',
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
