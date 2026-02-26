/**
 * Stellar Wallet Adapter
 *
 * Abstraction layer over @creit.tech/stellar-wallets-kit
 * Provides a unified API for all Stellar wallets (Freighter, xBull, Albedo, Rabet, Hana, etc.)
 * Maintains compatibility with previous Freighter-only implementation
 *
 * FIXES:
 * - Albedo: Special handling for localhost CORS issues
 * - xBull: Proper error extraction and retry logic
 * - Hot wallets: Eager connection strategy to prevent double-popups
 * - Better error messages for all wallet types
 */

import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  ISupportedWallet,
  FREIGHTER_ID,
  XBULL_ID,
  ALBEDO_ID,
  RABET_ID,
  HANA_ID,
  HOTWALLET_ID,
} from '@creit.tech/stellar-wallets-kit'

// Wallet type definitions
export type WalletType =
  | 'freighter'
  | 'xbull'
  | 'albedo'
  | 'rabet'
  | 'hana'
  | 'hot'

export interface WalletInfo {
  id: string
  name: string
  type: WalletType
  requiresEagerConnection?: boolean // Some wallets need immediate connection
}

export interface ConnectionResult {
  publicKey: string
  network: string
  networkPassphrase: string
}

// Wallet metadata mapping
export const WALLET_METADATA: Record<string, WalletInfo> = {
  [FREIGHTER_ID]: { id: FREIGHTER_ID, name: 'Freighter', type: 'freighter' },
  [XBULL_ID]: {
    id: XBULL_ID,
    name: 'xBull',
    type: 'xbull',
    requiresEagerConnection: true,
  },
  [ALBEDO_ID]: {
    id: ALBEDO_ID,
    name: 'Albedo',
    type: 'albedo',
    requiresEagerConnection: true,
  },
  [RABET_ID]: { id: RABET_ID, name: 'Rabet', type: 'rabet' },
  [HANA_ID]: {
    id: HANA_ID,
    name: 'Hana',
    type: 'hana',
    requiresEagerConnection: true,
  },
  [HOTWALLET_ID]: {
    id: HOTWALLET_ID,
    name: 'HOT Wallet',
    type: 'hot' as WalletType,
    requiresEagerConnection: true,
  },
}

/**
 * Helper function to extract meaningful error messages from wallet errors
 */
function extractErrorMessage(error: unknown, walletId?: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  const walletName = walletId
    ? WALLET_METADATA[walletId]?.name || walletId
    : 'wallet'

  // Handle empty error objects (xBull issue)
  if (error && typeof error === 'object' && Object.keys(error).length === 0) {
    console.warn(
      `[Wallet Adapter] Empty error object from ${walletName}:`,
      error
    )
    return `${walletName} connection failed. Please ensure the wallet is unlocked and try again.`
  }

  if (error instanceof Error) {
    // Albedo CORS error
    if (error.message.includes("origins don't match")) {
      const localhostMsg = isLocalhost()
        ? ' Run ./scripts/setup-https-dev.sh to enable HTTPS locally.'
        : ''
      return `Albedo requires HTTPS.${localhostMsg} See WALLET_INTEGRATION_GUIDE.md for details.`
    }

    // xBull specific errors
    if (
      error.message.includes('User declined') ||
      error.message.includes('rejected')
    ) {
      return 'Connection request was declined. Please try again and approve the connection.'
    }

    // Timeout errors
    if (error.message.includes('timeout')) {
      return `${walletName} connection timed out. Please ensure the wallet extension is unlocked and try again.`
    }

    // Network errors
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return `Network error connecting to ${walletName}. Please check your internet connection.`
    }

    // Log full error in development
    if (isDev) {
      console.error(`[Wallet Adapter] ${walletName} error:`, error)
    }

    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  // Unknown error - log it for debugging
  console.error(
    `[Wallet Adapter] Unknown error type from ${walletName}:`,
    error
  )
  return 'Unknown wallet error. Please try reconnecting.'
}

/**
 * Check if we're running on localhost
 */
function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  )
}

/**
 * Stellar Wallet Adapter Class
 * Singleton instance that manages wallet connections across the app
 */
class StellarWalletAdapter {
  private kit: StellarWalletsKit | null = null
  private selectedWalletId: string | null = null
  private isInitialized = false
  private connectionCache: Map<string, ConnectionResult> = new Map() // Cache wallet details

  constructor() {
    // Kit will be created lazily on first use to avoid SSR issues
  }

  /**
   * Create or recreate the wallet kit instance
   */
  private createKit(network?: WalletNetwork): StellarWalletsKit {
    const targetNetwork = network || this.getNetworkFromEnv()
    const savedWalletId = this.getStoredWalletId()

    return new StellarWalletsKit({
      network: targetNetwork,
      selectedWalletId: savedWalletId || FREIGHTER_ID,
      modules: allowAllModules(),
    })
  }

  /**
   * Get network from environment variable
   */
  private getNetworkFromEnv(): WalletNetwork {
    const envNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK
    return envNetwork === 'PUBLIC'
      ? WalletNetwork.PUBLIC
      : WalletNetwork.TESTNET
  }

  /**
   * Get stored wallet ID from localStorage
   */
  private getStoredWalletId(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('selectedWalletId')
  }

  /**
   * Store wallet ID to localStorage
   */
  private storeWalletId(walletId: string): void {
    if (typeof window === 'undefined') return
    localStorage.setItem('selectedWalletId', walletId)
    this.selectedWalletId = walletId
  }

  /**
   * Clear stored wallet ID
   */
  private clearStoredWalletId(): void {
    if (typeof window === 'undefined') return
    localStorage.removeItem('selectedWalletId')
    this.selectedWalletId = null
  }

  /**
   * Ensure kit is initialized (client-side only)
   */
  private ensureKit(): StellarWalletsKit {
    if (typeof window === 'undefined') {
      throw new Error('Wallet adapter can only be used in the browser')
    }

    if (!this.kit) {
      this.kit = this.createKit()
    }

    return this.kit
  }

  /**
   * Initialize the adapter (lazy initialization)
   * Note: Does NOT auto-reconnect to avoid triggering wallet popups on every page load
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return

    // Ensure kit exists
    this.ensureKit()

    // Only restore the wallet ID from storage, don't trigger connection
    const storedWalletId = this.getStoredWalletId()
    if (storedWalletId) {
      this.selectedWalletId = storedWalletId
    }

    this.isInitialized = true
  }

  /**
   * Check if any wallet is installed/available
   */
  async isInstalled(): Promise<boolean> {
    await this.initialize()
    // Always return true since the kit supports multiple wallets
    // The modal will show which wallets are actually available
    return true
  }

  /**
   * Connect wallet with modal selection
   * Opens wallet selection modal and connects to user's choice
   */
  async connect(): Promise<ConnectionResult> {
    await this.initialize()
    const kit = this.ensureKit()

    // Warn about Albedo on localhost
    if (isLocalhost()) {
      console.warn(
        '[Wallet Adapter] Running on localhost. Albedo wallet may not work due to CORS restrictions. Use HTTPS or choose a different wallet.'
      )
    }

    return new Promise((resolve, reject) => {
      kit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          try {
            // Albedo-specific warning for localhost (but allow trying)
            if (option.id === ALBEDO_ID && isLocalhost()) {
              console.warn(
                '[Wallet Adapter] Albedo may not work on localhost due to CORS. Consider using HTTPS.'
              )

              // Try to connect anyway with special handling
              try {
                await this.setWalletWithRetry(option.id, 1) // Single attempt for Albedo on localhost
                this.storeWalletId(option.id)

                // Add timeout for Albedo on localhost
                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(
                    () =>
                      reject(
                        new Error('Albedo connection timeout on localhost')
                      ),
                    5000
                  )
                )

                const addressPromise = kit.getAddress()
                const networkPromise = kit.getNetwork()

                const [{ address }, network] = (await Promise.race([
                  Promise.all([addressPromise, networkPromise]),
                  timeoutPromise,
                ])) as [
                  { address: string },
                  { network: string; networkPassphrase: string },
                ]

                const result = {
                  publicKey: address,
                  network: network.network,
                  networkPassphrase: network.networkPassphrase,
                }

                this.connectionCache.set(option.id, result)
                resolve(result)
                return
              } catch {
                // Provide helpful error message
                reject(
                  new Error(
                    'Albedo requires HTTPS to work properly. ' +
                      'Please either:\n' +
                      '1. Use HTTPS locally (run ./scripts/setup-https-dev.sh)\n' +
                      '2. Deploy to a staging environment\n' +
                      '3. Use a different wallet like Freighter'
                  )
                )
                return
              }
            }

            // Set the selected wallet with retry logic for xBull and other wallets
            await this.setWalletWithRetry(option.id)
            this.storeWalletId(option.id)

            const walletInfo = this.getWalletInfo(option.id)

            // Add delay for wallets requiring eager connection (xBull, Hana)
            if (
              walletInfo?.requiresEagerConnection &&
              option.id !== ALBEDO_ID
            ) {
              await new Promise((resolve) => setTimeout(resolve, 500))
            }

            // Get address and network with retry logic for xBull
            let address: string | undefined
            let network:
              | { network: string; networkPassphrase: string }
              | undefined

            if (option.id === XBULL_ID) {
              // Special handling for xBull with retries
              let retries = 0
              while (retries < 3) {
                try {
                  const addressResult = await kit.getAddress()
                  address = addressResult.address
                  network = await kit.getNetwork()
                  break
                } catch (getAddressError) {
                  retries++
                  if (retries === 3) {
                    throw getAddressError
                  }
                  console.warn(
                    `[Wallet Adapter] xBull getAddress attempt ${retries} failed, retrying...`
                  )
                  await new Promise((resolve) => setTimeout(resolve, 500))
                }
              }
            } else {
              // Standard flow for other wallets
              const addressResult = await kit.getAddress()
              address = addressResult.address
              network = await kit.getNetwork()
            }

            if (!address || !network) {
              throw new Error(`Failed to get wallet details from ${option.id}`)
            }

            const result = {
              publicKey: address,
              network: network.network,
              networkPassphrase: network.networkPassphrase,
            }

            // Cache the connection result
            this.connectionCache.set(option.id, result)

            resolve(result)
          } catch (error) {
            const errorMsg = extractErrorMessage(error, option.id)
            console.error('[Wallet Adapter] Connection error:', errorMsg, error)
            reject(new Error(errorMsg))
          }
        },
        onClosed: (error) => {
          if (error) {
            const errorMsg = extractErrorMessage(error)
            reject(
              new Error(errorMsg || 'Wallet selection cancelled or failed')
            )
          } else {
            reject(new Error('Wallet selection cancelled'))
          }
        },
      })
    })
  }

  /**
   * Set wallet with retry logic (helps with xBull and hot wallets)
   */
  private async setWalletWithRetry(
    walletId: string,
    maxRetries = 3
  ): Promise<void> {
    const kit = this.ensureKit()
    const walletInfo = this.getWalletInfo(walletId)

    // For wallets requiring eager connection (xBull, Hot, Hana), reduce retries to avoid multiple popups
    const actualMaxRetries = walletInfo?.requiresEagerConnection
      ? 1
      : maxRetries

    let lastError: unknown

    for (let attempt = 1; attempt <= actualMaxRetries; attempt++) {
      try {
        kit.setWallet(walletId)

        // For wallets requiring eager connection, add delay and verify connection
        if (walletInfo?.requiresEagerConnection) {
          // Give the wallet time to fully establish connection
          await new Promise((resolve) => setTimeout(resolve, 500))

          // Verify connection by attempting to get address with retry
          let verifyRetries = 0
          while (verifyRetries < 2) {
            try {
              await kit.getAddress()
              break // Connection verified
            } catch (verifyError) {
              verifyRetries++
              if (verifyRetries === 2) {
                throw verifyError
              }
              await new Promise((resolve) => setTimeout(resolve, 300))
            }
          }
        }

        return // Success
      } catch (error) {
        lastError = error

        // Don't retry on user rejection
        if (
          error instanceof Error &&
          (error.message.includes('declined') ||
            error.message.includes('rejected') ||
            error.message.includes('denied'))
        ) {
          throw error
        }

        // Wait before retrying (exponential backoff) - only for non-eager wallets
        if (attempt < actualMaxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 3000)
          console.warn(
            `[Wallet Adapter] setWallet attempt ${attempt} failed for ${walletId}, retrying in ${delay}ms...`
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    // All retries failed
    throw lastError
  }

  /**
   * Connect to a specific wallet (skip modal)
   * Useful for auto-reconnect or direct wallet selection
   */
  async connectToWallet(walletId: string): Promise<ConnectionResult> {
    await this.initialize()
    const kit = this.ensureKit()

    // Check cache first
    const cached = this.connectionCache.get(walletId)
    if (cached) {
      return cached
    }

    try {
      // Albedo-specific handling for localhost
      if (walletId === ALBEDO_ID && isLocalhost()) {
        console.warn(
          '[Wallet Adapter] Albedo may not work on localhost due to CORS. Attempting connection...'
        )

        // Try to connect with timeout
        try {
          await this.setWalletWithRetry(walletId, 1) // Single attempt for Albedo on localhost
          this.storeWalletId(walletId)

          // Add timeout for Albedo on localhost
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Albedo connection timeout on localhost')),
              5000
            )
          )

          const addressPromise = kit.getAddress()
          const networkPromise = kit.getNetwork()

          const [{ address }, network] = (await Promise.race([
            Promise.all([addressPromise, networkPromise]),
            timeoutPromise,
          ])) as [
            { address: string },
            { network: string; networkPassphrase: string },
          ]

          const result = {
            publicKey: address,
            network: network.network,
            networkPassphrase: network.networkPassphrase,
          }

          this.connectionCache.set(walletId, result)
          return result
        } catch {
          throw new Error(
            'Albedo requires HTTPS to work properly. ' +
              'Please either:\n' +
              '1. Use HTTPS locally (run ./scripts/setup-https-dev.sh)\n' +
              '2. Deploy to a staging environment\n' +
              '3. Use a different wallet like Freighter'
          )
        }
      }

      await this.setWalletWithRetry(walletId)
      this.storeWalletId(walletId)

      const walletInfo = this.getWalletInfo(walletId)

      // Add delay for wallets requiring eager connection
      if (walletInfo?.requiresEagerConnection) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      // Get address and network with retry logic for xBull
      let address: string | undefined
      let network: { network: string; networkPassphrase: string } | undefined

      if (walletId === XBULL_ID) {
        // Special handling for xBull with retries
        let retries = 0
        while (retries < 3) {
          try {
            const addressResult = await kit.getAddress()
            address = addressResult.address
            network = await kit.getNetwork()
            break
          } catch (getAddressError) {
            retries++
            if (retries === 3) {
              throw getAddressError
            }
            console.warn(
              `[Wallet Adapter] xBull getAddress attempt ${retries} failed, retrying...`
            )
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
      } else {
        // Standard flow for other wallets
        const addressResult = await kit.getAddress()
        address = addressResult.address
        network = await kit.getNetwork()
      }

      if (!address || !network) {
        throw new Error(`Failed to get wallet details from ${walletId}`)
      }

      const result = {
        publicKey: address,
        network: network.network,
        networkPassphrase: network.networkPassphrase,
      }

      // Cache the result
      this.connectionCache.set(walletId, result)

      return result
    } catch (error) {
      const errorMsg = extractErrorMessage(error, walletId)
      throw new Error(errorMsg)
    }
  }

  /**
   * Disconnect wallet (clear state)
   */
  disconnect(): void {
    this.clearStoredWalletId()
    this.connectionCache.clear()
    // Note: Stellar Wallets Kit doesn't have explicit disconnect
    // We handle disconnection through state management
  }

  /**
   * Check if wallet is connected (based on stored state AND cache)
   * Note: This is a passive check that doesn't trigger wallet popups
   * Returns true only if we have both a wallet ID and cached connection details
   */
  async isConnected(): Promise<boolean> {
    await this.initialize()

    // Check if we have a stored wallet ID AND cached connection details
    // This prevents the app from showing "connected" state when cache is empty
    if (!this.selectedWalletId) return false

    // Only consider connected if we have cached details
    // This prevents unwanted popups when trying to fetch missing details
    const cached = this.connectionCache.get(this.selectedWalletId)
    return cached !== undefined
  }

  /**
   * Get cached connection details without triggering wallet popups
   * Returns null if no cached details are available
   */
  getCachedConnection(): ConnectionResult | null {
    if (!this.selectedWalletId) return null
    return this.connectionCache.get(this.selectedWalletId) || null
  }

  /**
   * Get current wallet public key
   * Note: Returns cached value if available to avoid triggering wallet popups
   */
  async getPublicKey(): Promise<string> {
    await this.initialize()
    const kit = this.ensureKit()

    // Check cache first
    if (this.selectedWalletId) {
      const cached = this.connectionCache.get(this.selectedWalletId)
      if (cached) {
        return cached.publicKey
      }
    }

    // Ensure wallet is set before getting address
    if (this.selectedWalletId) {
      try {
        await this.setWalletWithRetry(this.selectedWalletId)
      } catch (error) {
        // If setWallet fails, clear stored state
        this.clearStoredWalletId()
        const errorMsg = extractErrorMessage(error, this.selectedWalletId)
        throw new Error(errorMsg)
      }
    }

    const { address } = await kit.getAddress()
    return address
  }

  /**
   * Get current network details
   * Note: Returns cached value if available to avoid triggering wallet popups
   */
  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    await this.initialize()
    const kit = this.ensureKit()

    // Check cache first
    if (this.selectedWalletId) {
      const cached = this.connectionCache.get(this.selectedWalletId)
      if (cached) {
        return {
          network: cached.network,
          networkPassphrase: cached.networkPassphrase,
        }
      }
    }

    // Ensure wallet is set before getting network
    if (this.selectedWalletId) {
      try {
        await this.setWalletWithRetry(this.selectedWalletId)
      } catch (error) {
        // If setWallet fails, clear stored state
        this.clearStoredWalletId()
        const errorMsg = extractErrorMessage(error, this.selectedWalletId)
        throw new Error(errorMsg)
      }
    }

    const network = await kit.getNetwork()
    return {
      network: network.network,
      networkPassphrase: network.networkPassphrase,
    }
  }

  /**
   * Get wallet info metadata
   */
  getWalletInfo(walletId: string): WalletInfo | null {
    return WALLET_METADATA[walletId] || null
  }

  /**
   * Check if wallet requires eager connection
   */
  requiresEagerConnection(walletId: string): boolean {
    const info = this.getWalletInfo(walletId)
    return info?.requiresEagerConnection || false
  }

  /**
   * Sign a transaction
   *
   * @param xdr - Transaction XDR string
   * @param networkPassphrase - Network passphrase for the transaction
   * @returns Signed transaction XDR
   */
  async signTransaction(
    xdr: string,
    networkPassphrase: string
  ): Promise<string> {
    await this.initialize()
    const kit = this.ensureKit()

    if (!this.selectedWalletId) {
      throw new Error('No wallet connected')
    }

    try {
      const { address } = await kit.getAddress()

      const { signedTxXdr } = await kit.signTransaction(xdr, {
        address,
        networkPassphrase,
      })

      return signedTxXdr
    } catch (error) {
      // Handle user rejection
      if (error instanceof Error) {
        if (
          error.message.includes('rejected') ||
          error.message.includes('denied') ||
          error.message.includes('User declined')
        ) {
          throw new Error('Transaction signature rejected by user')
        }
      }
      throw error
    }
  }

  /**
   * Get currently selected wallet info
   */
  getSelectedWallet(): WalletInfo | null {
    if (!this.selectedWalletId) return null
    return WALLET_METADATA[this.selectedWalletId] || null
  }

  /**
   * Get all available wallet modules
   */
  getAvailableWallets(): WalletInfo[] {
    return Object.values(WALLET_METADATA)
  }

  /**
   * Watch for account changes (polling-based)
   * Returns cleanup function
   *
   * Note: Stellar Wallets Kit doesn't provide native event listeners
   * so we use polling. Interval is configurable (default 2000ms)
   * HOT wallet is excluded from polling to prevent popups
   */
  watchAccountChanges(
    callback: (address: string) => void,
    interval: number = 2000
  ): () => void {
    // Skip polling for HOT wallet to prevent popups
    if (this.selectedWalletId === HOTWALLET_ID) {
      return () => {} // Return no-op cleanup function
    }

    let lastAddress: string | null = null
    let isActive = true
    const kit = this.ensureKit()

    const poll = async () => {
      if (!isActive) return

      try {
        const { address } = await kit.getAddress()
        if (address !== lastAddress) {
          lastAddress = address
          callback(address)
        }
      } catch {
        // Wallet disconnected or error - don't propagate
      }

      if (isActive) {
        setTimeout(poll, interval)
      }
    }

    // Start polling
    poll()

    // Return cleanup function
    return () => {
      isActive = false
    }
  }

  /**
   * Watch for network changes (polling-based)
   * Returns cleanup function
   * HOT wallet is excluded from polling to prevent popups
   */
  watchNetworkChanges(
    callback: (network: { network: string; networkPassphrase: string }) => void,
    interval: number = 2000
  ): () => void {
    // Skip polling for HOT wallet to prevent popups
    if (this.selectedWalletId === HOTWALLET_ID) {
      return () => {} // Return no-op cleanup function
    }

    let lastNetwork: string | null = null
    let isActive = true
    const kit = this.ensureKit()

    const poll = async () => {
      if (!isActive) return

      try {
        const network = await kit.getNetwork()
        if (network.network !== lastNetwork) {
          lastNetwork = network.network
          callback(network)
        }
      } catch {
        // Wallet disconnected or error - don't propagate
      }

      if (isActive) {
        setTimeout(poll, interval)
      }
    }

    // Start polling
    poll()

    // Return cleanup function
    return () => {
      isActive = false
    }
  }

  /**
   * Refresh wallet state (force re-check)
   */
  async refresh(): Promise<void> {
    await this.initialize()
    const kit = this.ensureKit()

    if (this.selectedWalletId) {
      try {
        kit.setWallet(this.selectedWalletId)
      } catch (error) {
        console.warn('Failed to refresh wallet:', error)
        this.clearStoredWalletId()
        throw error
      }
    }
  }
}

// Export singleton instance
export const walletAdapter = new StellarWalletAdapter()

// Export wallet IDs for direct reference
export {
  FREIGHTER_ID,
  XBULL_ID,
  ALBEDO_ID,
  RABET_ID,
  HANA_ID,
  HOTWALLET_ID,
  WalletNetwork,
}
