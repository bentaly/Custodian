import { bankStatus } from '../../lib/bankVerification'

/**
 * The bank columns of an application, as one indivisible write.
 *
 * `applications.bank_check_status` is a cache of a pure function of the other two
 * columns, which means it can go stale in exactly one way: a writer updates the numbers
 * and forgets the status. So there is no way to write the numbers on their own — every
 * path spreads this, and the status comes with them.
 *
 * Pass the FULL resulting pair, not a patch: a partial update that changes only the sort
 * code still changes what the check says about the account number beside it.
 */
export function bankFields(input: {
  bankSortCode: string | null | undefined
  bankAccountNumber: string | null | undefined
}) {
  const bankSortCode = input.bankSortCode ?? null
  const bankAccountNumber = input.bankAccountNumber ?? null
  return {
    bankSortCode,
    bankAccountNumber,
    bankCheckStatus: bankStatus({ bankSortCode, bankAccountNumber }),
  }
}
