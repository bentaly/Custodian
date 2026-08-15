import { describe, expect, it } from 'vitest'
import { bankStatus, checkBankAccount } from './modulus'
import { bankFields } from '../../server/applications/bank'

describe('checkBankAccount', () => {
  // Cases drawn from the VocaLink "Validating account numbers" spec examples,
  // including ones that exercise the exception rules.
  it('passes a valid combination', () => {
    expect(checkBankAccount({ sortCode: '089999', accountNumber: '66374958' })).toEqual({
      status: 'valid',
      sortCode: '089999',
      accountNumber: '66374958',
    })
  })

  it('fails a combination that breaks the modulus algorithm', () => {
    const result = checkBankAccount({ sortCode: '938063', accountNumber: '15764273' })
    expect(result.status).toBe('invalid')
    expect(result.reason).toBe('failed_modulus')
  })

  it('passes combinations that rely on exception rules', () => {
    // Exception 3 and exception 5 from the spec.
    expect(checkBankAccount({ sortCode: '107999', accountNumber: '88837491' }).status).toBe('valid')
    expect(checkBankAccount({ sortCode: '200915', accountNumber: '41011166' }).status).toBe('valid')
  })

  it('tolerates hyphen/space formatting in the inputs', () => {
    const result = checkBankAccount({ sortCode: '08-99-99', accountNumber: '6637 4958' })
    expect(result.status).toBe('valid')
    // Stored/echoed value is normalised to digits only.
    expect(result.sortCode).toBe('089999')
    expect(result.accountNumber).toBe('66374958')
  })

  it('reports a malformed sort code without running the check', () => {
    const result = checkBankAccount({ sortCode: '0899', accountNumber: '66374958' })
    expect(result.status).toBe('unchecked')
    expect(result.reason).toBe('malformed_sort_code')
  })

  it('reports a malformed account number without running the check', () => {
    const result = checkBankAccount({ sortCode: '089999', accountNumber: '1234567' })
    expect(result.status).toBe('unchecked')
    expect(result.reason).toBe('malformed_account_number')
  })
})

/**
 * `bankStatus` is what gets STORED on the application, so the Finance list can sort and
 * count by it. These pin the two things a cache must not get wrong: that it agrees with
 * the live check, and that "we hold nothing" is a state of its own rather than a
 * failure — a grant with no details is chased differently from one with a typo.
 */
describe('bankStatus (the stored verdict)', () => {
  it('agrees with the live check when both numbers are held', () => {
    const pair = { bankSortCode: '089999', bankAccountNumber: '66374958' }
    expect(bankStatus(pair)).toBe('valid')
    expect(bankStatus(pair)).toBe(
      checkBankAccount({ sortCode: pair.bankSortCode, accountNumber: pair.bankAccountNumber })
        .status,
    )
  })

  it('is `missing` when either number is absent, rather than invalid', () => {
    expect(bankStatus({ bankSortCode: null, bankAccountNumber: '66374958' })).toBe('missing')
    expect(bankStatus({ bankSortCode: '089999', bankAccountNumber: null })).toBe('missing')
    expect(bankStatus({ bankSortCode: null, bankAccountNumber: null })).toBe('missing')
  })

  it('is `invalid` for a well-formed pair that fails the algorithm', () => {
    expect(bankStatus({ bankSortCode: '089999', bankAccountNumber: '66374959' })).toBe('invalid')
  })
})

/**
 * The invariant the column depends on: a write cannot set the numbers and leave the
 * verdict behind. `bankFields` returns all three or none, which is why every write path
 * spreads it rather than assigning the columns itself.
 */
describe('bankFields', () => {
  it('returns the verdict alongside the numbers it describes', () => {
    expect(bankFields({ bankSortCode: '089999', bankAccountNumber: '66374958' })).toEqual({
      bankSortCode: '089999',
      bankAccountNumber: '66374958',
      bankCheckStatus: 'valid',
    })
  })

  it('normalises absent to null and says so', () => {
    expect(bankFields({ bankSortCode: undefined, bankAccountNumber: undefined })).toEqual({
      bankSortCode: null,
      bankAccountNumber: null,
      bankCheckStatus: 'missing',
    })
  })

  it('re-checks the PAIR when only one side changes', () => {
    // Swapping in an account number that fails against this sort code must flip the
    // stored verdict — a patch that kept the old one would leave the cache lying.
    const before = bankFields({ bankSortCode: '089999', bankAccountNumber: '66374958' })
    const after = bankFields({ bankSortCode: '089999', bankAccountNumber: '66374959' })
    expect(before.bankCheckStatus).toBe('valid')
    expect(after.bankCheckStatus).toBe('invalid')
  })
})
