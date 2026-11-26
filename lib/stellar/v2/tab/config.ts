/**
 * The tab modules' view of the v2 client configuration. The network
 * passphrase and the Tab contract id come from `v2Config()` only, never
 * from a server response.
 */
import { v2Config, type V2ClientConfig } from '../config'
import { TabClientError } from './errors'
import type { SessionKeyScope } from './session-key'

export type TabConfig = {
  networkPassphrase: string
  tabContractId: string
}

/**
 * The passphrase and Tab contract id from `config` (default `v2Config()`).
 * Throws `TabClientError` `NOT_CONFIGURED` when no Tab contract is set.
 */
export function tabConfig(
  config: Pick<V2ClientConfig, 'passphrase' | 'tabContractId'> = v2Config()
): TabConfig {
  if (!config.tabContractId) {
    throw new TabClientError(
      'NOT_CONFIGURED',
      'Tabs are not available: NEXT_PUBLIC_TAB_CONTRACT_ID is not set.'
    )
  }
  return {
    networkPassphrase: config.passphrase,
    tabContractId: config.tabContractId,
  }
}

/** The session key scope for `readerAddress` under the configured Tab contract. */
export function tabScope(
  readerAddress: string,
  config?: Pick<V2ClientConfig, 'passphrase' | 'tabContractId'>
): SessionKeyScope {
  return { tabContractId: tabConfig(config).tabContractId, readerAddress }
}
