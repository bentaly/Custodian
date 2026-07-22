// Ambient types for `uk-modulus-checking` (MIT, uphold/uk-modulus-checking).
//
// The package ships no type declarations. It is a plain CommonJS default export
// with a single class; the VocaLink weight/substitution tables are embedded
// inline as strings (no `fs`), so it runs unchanged on Cloudflare Workers.
declare module 'uk-modulus-checking' {
  interface UkModulusCheckingInput {
    accountNumber: string
    sortCode: string
  }

  export default class UkModulusChecking {
    constructor(input: UkModulusCheckingInput)
    /** True if the sort code + account number pass VocaLink modulus checking. */
    isValid(): boolean
  }
}
