import * as StellarSdk from '@stellar/stellar-sdk'
import { STELLAR_CONFIG } from './config'
import { createMemo } from './memo-utils'
import type { MintNFTParams, NFTOwnership, NFTTransactionResult } from './types'

export class NFTClient {
  private server: StellarSdk.Horizon.Server
  private sorobanServer: StellarSdk.rpc.Server
  private networkPassphrase: string

  constructor() {
    this.server = new StellarSdk.Horizon.Server(STELLAR_CONFIG.HORIZON_URL)
    this.sorobanServer = new StellarSdk.rpc.Server(
      STELLAR_CONFIG.SOROBAN_RPC_URL
    )
    this.networkPassphrase = STELLAR_CONFIG.NETWORK_PASSPHRASE
  }

  /**
   * Check if an article is eligible for NFT minting
   */
  async checkEligibility(
    articleId: string,
    tipAmount: number
  ): Promise<{
    eligible: boolean
    alreadyMinted: boolean
    reason?: string
  }> {
    try {
      // Check if already minted
      const alreadyMinted = await this.isArticleMinted(articleId)
      if (alreadyMinted) {
        return {
          eligible: false,
          alreadyMinted: true,
          reason: 'Article already minted as NFT',
        }
      }

      // Check tip threshold
      const threshold = STELLAR_CONFIG.NFT_TIP_THRESHOLD_STROOPS
      if (tipAmount < threshold) {
        return {
          eligible: false,
          alreadyMinted: false,
          reason: `Need ${threshold / 10_000_000} XLM in tips (current: ${tipAmount / 10_000_000} XLM)`,
        }
      }

      return { eligible: true, alreadyMinted: false }
    } catch (error) {
      console.error('Error checking NFT eligibility:', error)
      return {
        eligible: false,
        alreadyMinted: false,
        reason: 'Error checking eligibility',
      }
    }
  }

  /**
   * Check if an article is already minted as NFT
   */
  async isArticleMinted(articleId: string): Promise<boolean> {
    try {
      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

      // Create a dummy account for simulation (read-only operation)
      const account = new StellarSdk.Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0'
      )

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'is_article_minted',
            StellarSdk.nativeToScVal(articleId, { type: 'symbol' })
          )
        )
        .setTimeout(30)
        .build()

      const result = await this.sorobanServer.simulateTransaction(transaction)

      if (
        StellarSdk.rpc.Api.isSimulationSuccess(result) &&
        result.result?.retval
      ) {
        return StellarSdk.scValToNative(result.result.retval)
      }

      return false
    } catch (error) {
      console.error('Error checking if article is minted:', error)
      return false
    }
  }

  /**
   * Get the current tip threshold from contract
   */
  async getTipThreshold(): Promise<number> {
    try {
      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

      // Create a dummy account for simulation
      const account = new StellarSdk.Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0'
      )

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_tip_threshold'))
        .setTimeout(30)
        .build()

      const result = await this.sorobanServer.simulateTransaction(transaction)

      if (
        StellarSdk.rpc.Api.isSimulationSuccess(result) &&
        result.result?.retval
      ) {
        return parseInt(StellarSdk.scValToNative(result.result.retval), 10)
      }

      return STELLAR_CONFIG.NFT_TIP_THRESHOLD_STROOPS
    } catch (error) {
      console.error('Error getting tip threshold:', error)
      return STELLAR_CONFIG.NFT_TIP_THRESHOLD_STROOPS
    }
  }

  /**
   * Build NFT minting transaction (returns XDR for signing)
   */
  async buildMintTransaction(
    authorPublicKey: string,
    params: MintNFTParams
  ): Promise<{
    xdr: string
    tokenId?: number
  }> {
    try {
      // Load the author's account
      const account = await this.server.loadAccount(authorPublicKey)

      // Create contract instance
      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

      // Build the transaction
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'mint_article_nft',
            StellarSdk.nativeToScVal(params.authorAddress, { type: 'address' }), // author
            StellarSdk.nativeToScVal(params.articleId, { type: 'symbol' }), // article_id
            StellarSdk.nativeToScVal(params.tipAmount, { type: 'i128' }), // tip_amount
            StellarSdk.nativeToScVal(params.metadataUrl, { type: 'string' }) // metadata_url
          )
        )
        .addMemo(createMemo({ type: 'nft', id: params.articleId }))
        .setTimeout(180)
        .build()

      // Prepare transaction for Soroban
      const preparedTransaction =
        await this.sorobanServer.prepareTransaction(transaction)

      return {
        xdr: preparedTransaction.toXDR(),
      }
    } catch (error) {
      console.error('Error building mint transaction:', error)
      throw new Error(
        `Failed to build mint transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Submit signed NFT transaction to network
   */
  async submitMintTransaction(
    signedXDR: string
  ): Promise<NFTTransactionResult> {
    try {
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        signedXDR,
        this.networkPassphrase
      )

      // Submit transaction
      const result = await this.sorobanServer.sendTransaction(transaction)

      if (result.status === 'PENDING') {
        // Wait for transaction to be included in ledger
        let txResult = await this.sorobanServer.getTransaction(result.hash)
        let retries = 0
        const maxRetries = 30 // 30 seconds timeout

        while (txResult.status === 'NOT_FOUND' && retries < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          txResult = await this.sorobanServer.getTransaction(result.hash)
          retries++
        }

        if (txResult.status === 'SUCCESS') {
          // Parse the return value from contract (token ID)
          let tokenId: number | undefined
          if (txResult.returnValue) {
            tokenId = parseInt(
              StellarSdk.scValToNative(txResult.returnValue),
              10
            )
          }

          return {
            success: true,
            tokenId,
            transactionHash: result.hash,
          }
        } else if (txResult.status === 'FAILED') {
          // Parse the error for better debugging
          const errorDetails = {
            status: txResult.status,
            // Additional error properties if available
            ...((txResult as unknown as Record<string, unknown>).resultXdr
              ? {
                  resultXdr: (txResult as unknown as Record<string, unknown>)
                    .resultXdr,
                }
              : {}),
            ...((txResult as unknown as Record<string, unknown>).resultMetaXdr
              ? {
                  resultMetaXdr: (
                    txResult as unknown as Record<string, unknown>
                  ).resultMetaXdr,
                }
              : {}),
          }
          console.error('Transaction failed with details:', errorDetails)
          return {
            success: false,
            error: `Transaction failed: ${JSON.stringify(errorDetails, null, 2)}`,
          }
        } else if (txResult.status === 'NOT_FOUND' && retries >= maxRetries) {
          return {
            success: false,
            error:
              'Transaction timeout: Could not confirm transaction after 30 seconds',
          }
        }
      }

      // Handle various error cases
      console.error('Transaction submission failed:', {
        status: result.status,
        errorResult: result.errorResult,
      })

      // Extract meaningful error message
      let errorMessage = 'Transaction submission failed'

      if (result.errorResult) {
        if (typeof result.errorResult === 'string') {
          errorMessage = result.errorResult
        } else if (
          typeof result.errorResult === 'object' &&
          result.errorResult !== null
        ) {
          errorMessage = `Transaction failed with status: ${result.status}. Details: ${JSON.stringify(result.errorResult, null, 2)}`
        } else {
          errorMessage = `Transaction failed with status: ${result.status}. Error: ${String(result.errorResult)}`
        }
      } else {
        errorMessage = `Transaction failed with status: ${result.status}`
      }

      return {
        success: false,
        error: errorMessage,
      }
    } catch (error) {
      console.error('Error submitting mint transaction:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get NFT ownership information
   */
  async getOwnership(tokenId: number): Promise<NFTOwnership | null> {
    try {
      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

      // Create a dummy account for simulation
      const account = new StellarSdk.Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0'
      )

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'get_owner',
            StellarSdk.nativeToScVal(tokenId, { type: 'u64' })
          )
        )
        .setTimeout(30)
        .build()

      const result = await this.sorobanServer.simulateTransaction(transaction)

      if (
        StellarSdk.rpc.Api.isSimulationSuccess(result) &&
        result.result?.retval
      ) {
        const owner = StellarSdk.scValToNative(result.result.retval)

        // Return actual data from contract; null for fields contract doesn't expose
        // Additional contract methods would be needed to populate these fields
        return {
          tokenId,
          owner,
          minter: null, // Contract doesn't expose minter info
          articleId: null, // Contract doesn't expose article ID
          mintedAt: null, // Contract doesn't expose mint timestamp
          tipAmount: null, // Contract doesn't expose tip amount
        }
      }

      return null
    } catch (error) {
      console.error('Error getting NFT ownership:', error)
      return null
    }
  }
}

// Export singleton instance
export const nftClient = new NFTClient()
