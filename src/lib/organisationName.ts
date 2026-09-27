/**
 * The name an application gets when the submission did not say who it is from.
 *
 * `applications.organisation_name` stays NOT NULL on purpose: every list, search, letter
 * and export reads it, and a nullable name would put a blank row in each of them. So a
 * submission without one lands under a stand-in built from the foundation's own
 * reference (which is still required, so there is always one), and the application
 * lists "Organisation name" among what was not captured, with a way to fill it in.
 *
 * The stand-in is recognised by its SHAPE, which is why it is built and recognised in
 * one place: reading it as a real name would tell the gaps panel nothing is missing.
 */
const PREFIX = 'Unnamed (ref '

export function unnamedOrganisation(reference: string | null | undefined): string {
  return `${PREFIX}${reference?.trim() || 'unknown'})`
}

export function isUnnamedOrganisation(name: string | null | undefined): boolean {
  return !!name && name.startsWith(PREFIX) && name.endsWith(')')
}
