'use client'

import { Loader2, Wallet } from 'lucide-react'

export type WithdrawalDialogViewProps = {
  minWithdrawalUsd: number
  availableBalanceUsd: number
  savedStellarAddress?: string | null
  withdrawAmount: string
  onWithdrawAmountChange: (value: string) => void
  stellarAddress: string
  onStellarAddressChange: (value: string) => void
  addressForSubmit: string
  isSubmitting: boolean
  onCancel: () => void
  onSubmit: () => void
}

export function WithdrawalDialogView({
  minWithdrawalUsd,
  availableBalanceUsd,
  savedStellarAddress,
  withdrawAmount,
  onWithdrawAmountChange,
  stellarAddress,
  onStellarAddressChange,
  addressForSubmit,
  isSubmitting,
  onCancel,
  onSubmit,
}: WithdrawalDialogViewProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">Withdraw Earnings</h3>
          <p className="text-sm text-gray-600 mt-1">
            Withdraw to your Stellar wallet
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label
              htmlFor="withdraw-amount"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                $
              </span>
              <input
                id="withdraw-amount"
                type="number"
                min={minWithdrawalUsd}
                max={availableBalanceUsd}
                step="0.01"
                value={withdrawAmount}
                onChange={(e) => onWithdrawAmountChange(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                placeholder={`${minWithdrawalUsd.toFixed(2)}`}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Available: ${availableBalanceUsd.toFixed(2)} | Min: $
              {minWithdrawalUsd.toFixed(2)}
            </p>
          </div>

          <div>
            <label
              htmlFor="stellar-address"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Stellar Address
            </label>
            <input
              id="stellar-address"
              type="text"
              value={stellarAddress || savedStellarAddress || ''}
              onChange={(e) => onStellarAddressChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
              placeholder="G..."
              readOnly={!!savedStellarAddress}
            />
            <p className="text-xs text-gray-500 mt-1">
              {savedStellarAddress
                ? 'Using your saved wallet address from Wallet settings'
                : 'Enter your Stellar wallet address'}
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              Withdrawals are processed instantly on the Stellar network.
              Transaction fees are covered by Quilltip.
            </p>
          </div>
        </div>

        <div className="p-6 border-t flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || !withdrawAmount || !addressForSubmit}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4" />
                Withdraw
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
