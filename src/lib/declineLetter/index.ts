export {
  DECLINE_LETTER_TOKENS,
  DEFAULT_DECLINE_LETTER_SUBJECT,
  DEFAULT_DECLINE_LETTER_TEMPLATE,
  renderDeclineLetterBody,
  resolveDeclineSettings,
  type DeclineLetterSettings,
  type DeclineLetterToken,
} from './template'

export {
  declineLetterVars,
  renderDeclineLetter,
  type DeclineLetterInput,
  type RenderedDeclineLetter,
} from './render'

export {
  normaliseEmail,
  planDeclineBatch,
  type AddressRecord,
  type DeclineCandidate,
  type DeclinePlan,
} from './batch'
