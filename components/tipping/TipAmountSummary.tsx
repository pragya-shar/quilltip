import { formatTipAmount } from '@/lib/stellar/highlight-utils'

interface TipAmountSummaryProps {
  amountCents: number
  message?: string
}

export function TipAmountSummary({ amountCents, message }: TipAmountSummaryProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <p className="font-medium text-foreground">
        Tip amount: {formatTipAmount(amountCents)}
      </p>
      {message ? (
        <p className="mt-2 text-muted-foreground">
          <span className="font-medium text-foreground">Message: </span>
          &ldquo;{message}&rdquo;
        </p>
      ) : null}
    </div>
  )
}
