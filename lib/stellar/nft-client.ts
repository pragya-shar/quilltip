import { STELLAR_CONFIG } from './config'
import { createMemo } from './memo-utils'
import { loadStellarSdk } from './sdk-loader'
import type { MintNFTParams, NFTOwnership, NFTTransactionResult } from './types'

type StellarSdkContext = {
  StellarSdk: Awaited<ReturnType<typeof loadStellarSdk>>
  server: InstanceType<
    Awaited<ReturnType<typeof loadStellarSdk>>['Horizon']['Server']
  >
  sorobanServer: InstanceType<
    Awaited<ReturnType<typeof loadStellarSdk>>['rpc']['Server']
  >
}

export class NFTClient {
  private readonly networkPassphrase = STELLAR_CONFIG.NETWORK_PASSPHRASE
  private sdkContextPromise: Promise<StellarSdkContext> | null = null

  private async getSdkContext(): Promise<StellarSdkContext> {
    this.sdkContextPromise ??= (async () => {
      const StellarSdk = await loadStellarSdk()
      const server = new StellarSdk.Horizon.Server(STELLAR_CONFIG.HORIZON_URL)
      const sorobanServer = new StellarSdk.rpc.Server(
        STELLAR_CONFIG.SOROBAN_RPC_URL
      )
      return { StellarSdk, server, sorobanServer }
    })()
    return this.sdkContextPromise
  }

  async checkEligibility(
    articleId: string,
    tipAmount: number
  ): Promise<{
    eligible: boolean
    alreadyMinted: boolean
    reason?: string
  }> {
    try {
      const alreadyMinted = await this.isArticleMinted(articleId)
      if (alreadyMinted) {
        return {
          eligible: false,
          alreadyMinted: true,
          reason: 'Article already minted as NFT',
        }
      }

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

  async isArticleMinted(articleId: string): Promise<boolean> {
    const { StellarSdk, sorobanServer } = await this.getSdkContext()
    try {
      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

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

      const result = await sorobanServer.simulateTransaction(transaction)

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

  async getTipThreshold(): Promise<number> {
    const { StellarSdk, sorobanServer } = await this.getSdkContext()
    try {
      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

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

      const result = await sorobanServer.simulateTransaction(transaction)

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

  async buildMintTransaction(
    authorPublicKey: string,
    params: MintNFTParams
  ): Promise<{
    xdr: string
    tokenId?: number
  }> {
    const { StellarSdk, server, sorobanServer } = await this.getSdkContext()
    try {
      const account = await server.loadAccount(authorPublicKey)

      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

      const memo = await createMemo({ type: 'nft', id: params.articleId })

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'mint_article_nft',
            StellarSdk.nativeToScVal(params.authorAddress, { type: 'address' }),
            StellarSdk.nativeToScVal(params.articleId, { type: 'symbol' }),
            StellarSdk.nativeToScVal(params.tipAmount, { type: 'i128' }),
            StellarSdk.nativeToScVal(params.metadataUrl, { type: 'string' })
          )
        )
        .addMemo(memo)
        .setTimeout(180)
        .build()

      const preparedTransaction =
        await sorobanServer.prepareTransaction(transaction)

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

  async submitMintTransaction(
    signedXDR: string
  ): Promise<NFTTransactionResult> {
    const { StellarSdk, sorobanServer } = await this.getSdkContext()
    try {
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        signedXDR,
        this.networkPassphrase
      )

      const result = await sorobanServer.sendTransaction(transaction)

      if (result.status === 'PENDING') {
        let txResult = await sorobanServer.getTransaction(result.hash)
        let retries = 0
        const maxRetries = 30

        while (txResult.status === 'NOT_FOUND' && retries < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          txResult = await sorobanServer.getTransaction(result.hash)
          retries++
        }

        if (txResult.status === 'SUCCESS') {
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
          const errorDetails = {
            status: txResult.status,
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

      console.error('Transaction submission failed:', {
        status: result.status,
        errorResult: result.errorResult,
      })

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

  async getOwnership(tokenId: number): Promise<NFTOwnership | null> {
    const { StellarSdk, sorobanServer } = await this.getSdkContext()
    try {
      const contract = new StellarSdk.Contract(STELLAR_CONFIG.NFT_CONTRACT_ID)

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

      const result = await sorobanServer.simulateTransaction(transaction)

      if (
        StellarSdk.rpc.Api.isSimulationSuccess(result) &&
        result.result?.retval
      ) {
        const owner = StellarSdk.scValToNative(result.result.retval)

        return {
          tokenId,
          owner,
          minter: null,
          articleId: null,
          mintedAt: null,
          tipAmount: null,
        }
      }

      return null
    } catch (error) {
      console.error('Error getting NFT ownership:', error)
      return null
    }
  }
}

export const nftClient = new NFTClient()
