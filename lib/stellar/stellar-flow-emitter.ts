export const TIP_FLOW_STEPS = [
  'awaiting_signature',
  'submitting',
  'confirming',
] as const

export type TipFlowStep = (typeof TIP_FLOW_STEPS)[number]

/** Extend when wiring NFT mint progress through the same emitter. */
export type NftMintFlowStep =
  | 'awaiting_signature'
  | 'submitting'
  | 'confirming'
  | 'idle'

export type StellarFlowEvent =
  | { flow: 'tip'; step: TipFlowStep }
  | { flow: 'nft_mint'; step: NftMintFlowStep }

export type StellarFlowListener = (event: StellarFlowEvent) => void

class StellarFlowEmitter {
  private listeners = new Set<StellarFlowListener>()

  subscribe(listener: StellarFlowListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: StellarFlowEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export const stellarFlowEmitter = new StellarFlowEmitter()

export function tipFlowProgressLabel(step: TipFlowStep): string {
  switch (step) {
    case 'awaiting_signature':
      return 'Awaiting signature'
    case 'submitting':
      return 'Submitting to Stellar'
    case 'confirming':
      return 'Confirming on-chain'
  }
}
