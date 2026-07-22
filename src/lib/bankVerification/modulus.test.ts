import { describe, expect, it } from 'vitest'
import { checkBankAccount } from './modulus'

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
