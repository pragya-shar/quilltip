import { sampleSentences } from '../landing/LandingTippingDemo'
export const sentences = sampleSentences
export const selectedWords = (index: number) => sampleSentences[index] ?? ''
