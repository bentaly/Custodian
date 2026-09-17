// ─── Team and account housekeeping ────────────────────────────────────────────
//
// Removing a member (an admin, from Settings → Team), changing a role, and the signed-in
// user's own account: its sessions, and removing it. The rules are `src/lib/team.ts`;
// the guarded writes are `src/server/members.ts`. Invitations live in `invitations.ts`.

import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { badRequest, conflict, notFoundError } from '../../lib/errors'
import { getDb } from '../db'
import { accounts, sessions, users, verifications } from '../../../drizzle/schema'
import { callAuth } from '../auth'
import { requireAuthUser, requireRole } from '../session'
import { recordAudit } from '../audit'
import { activeAdminCount, archiveMember, changeMemberRole, setMemberVote } from '../members'
import {
  deviceLabel,
  removalRefusal,
  roleChangeRefusal,
  voteChangeRefusal,
  type TeamPerson,
} from '../../lib/team'
import {
  REMOVAL_CODE_MESSAGES,
  REMOVAL_CODE_TTL_MS,
  generateRemovalCode,
  hashRemovalCode,
  judgeRemovalCode,
  removalCodeIdentifier,
  removalCodeValue,
} from '../../lib/removalCode'
import { sendAccountRemovalCodeEmail, sendMemberRemovedEmail } from '../../lib/email'

const RACED = 'That could not be done just now, because the team changed. Refresh and try again.'

type SessionUser = Awaited<ReturnType<typeof requireAuthUser>>

function asPerson(user: SessionUser): TeamPerson {
  // `getAuthUser` refuses archived rows, so a signed-in user is never archived.
  return { id: user.id, role: user.role, clientId: user.clientId, archivedAt: null }
}

async function loadMember(userId: string) {
  const row = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, name: true, email: true, role: true, clientId: true, archivedAt: true },
  })
  return row ?? null
}

async function adminsOf(clientId: string | null): Promise<number> {
  return clientId ? activeAdminCount(clientId) : 0
}

/** Why the signed-in user may not remove themselves, or null. Shared by all three self fns. */
async function selfRemovalRefusal(user: SessionUser): Promise<string | null> {
  const me = asPerson(user)
  return removalRefusal({
    actor: me,
    target: me,
    activeAdmins: user.role === 'admin' ? await adminsOf(user.clientId) : 0,
    via: 'self',
  })
}

// ─── Settings → Team ─────────────────────────────────────────────────────────

export const removeMember = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const actor = await requireRole('superadmin', 'admin')
    const target = await loadMember(data.userId)

    const refusal = removalRefusal({
      actor: asPerson(actor),
      target,
      activeAdmins: await adminsOf(actor.clientId),
      via: 'team',
    })
    if (refusal) throw target ? badRequest(refusal) : notFoundError(refusal)
    if (!target || !actor.clientId) throw notFoundError()

    if (!(await archiveMember(target.id, target.email))) throw conflict(RACED)

    await sendMemberRemovedEmail({
      to: target.email,
      clientName: actor.clientName,
      removedBySelf: false,
    })
    await recordAudit({
      actorUserId: actor.id,
      action: 'member_removed',
      clientId: actor.clientId,
      metadata: { name: target.name, email: target.email, role: target.role },
    })
    return { ok: true }
  })

/**
 * Give an admin a vote of their own on applications, or take it back.
 *
 * Deliberately NOT part of `setMemberRole`, though it sits in the same menu: a role says
 * what somebody can DO, and this says whether they are on the board. Folding it in would
 * mean every role change had to restate it, and the one you forgot to restate would
 * quietly drop a vote.
 *
 * `votes` is sent as the state wanted, not as a toggle: two admins pressing at once
 * would otherwise flip it twice and land back where it started, with two audit rows
 * disagreeing about what happened.
 */
export const setMemberVoteOnApplications = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1), votes: z.boolean() }))
  .handler(async ({ data }) => {
    const actor = await requireRole('superadmin', 'admin')
    const target = await loadMember(data.userId)

    const refusal = voteChangeRefusal({ actor: asPerson(actor), target })
    if (refusal) throw target ? badRequest(refusal) : notFoundError(refusal)
    if (!target || !actor.clientId) throw notFoundError()

    if (!(await setMemberVote(target.id, data.votes))) throw conflict(RACED)

    await recordAudit({
      actorUserId: actor.id,
      action: 'member_vote_changed',
      clientId: actor.clientId,
      metadata: {
        name: target.name,
        email: target.email,
        votes: data.votes,
        self: target.id === actor.id,
      },
    })
    return { ok: true }
  })

export const setMemberRole = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1), role: z.enum(['admin', 'trustee', 'finance']) }))
  .handler(async ({ data }) => {
    const actor = await requireRole('superadmin', 'admin')
    const target = await loadMember(data.userId)

    const refusal = roleChangeRefusal({
      actor: asPerson(actor),
      target,
      nextRole: data.role,
      activeAdmins: await adminsOf(actor.clientId),
    })
    if (refusal) throw target ? badRequest(refusal) : notFoundError(refusal)
    if (!target || !actor.clientId) throw notFoundError()

    if (!(await changeMemberRole(target.id, data.role))) throw conflict(RACED)

    await recordAudit({
      actorUserId: actor.id,
      action: 'member_role_changed',
      clientId: actor.clientId,
      metadata: { name: target.name, email: target.email, from: target.role, to: data.role },
    })
    return { ok: true }
  })

// ─── Profile: your own account ───────────────────────────────────────────────

/**
 * What the Profile's account panels need: whether a password exists (so the panel can
 * offer to change it or to set one), where you are signed in, and whether you are
 * allowed to remove your account, with the reason if not.
 *
 * Impersonation sessions are left out of the list. They are a superadmin wearing this
 * account for at most an hour, and a member reading "Chrome on Windows" they do not own
 * would reasonably take it for a break-in.
 */
export const getAccountSecurity = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  const db = getDb()
  const request = getRequest()

  const [current, accountRows, sessionRows, removalBlocked] = await Promise.all([
    callAuth('getSession', (auth) => auth.api.getSession({ headers: request.headers })),
    db
      .select({ providerId: accounts.providerId })
      .from(accounts)
      .where(eq(accounts.userId, user.id)),
    db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, user.id),
          gt(sessions.expiresAt, new Date()),
          isNull(sessions.impersonatedBy),
        ),
      )
      .orderBy(desc(sessions.updatedAt)),
    selfRemovalRefusal(user),
  ])

  return {
    hasPassword: accountRows.some((a) => a.providerId === 'credential'),
    sessions: sessionRows.map((s) => ({
      id: s.id,
      device: deviceLabel(s.userAgent),
      current: s.id === current?.session.id,
      signedInAt: s.createdAt,
      lastActiveAt: s.updatedAt,
    })),
    // Superadmins are not offered the panel at all; everyone else sees it, with the
    // reason in place of the button when it is refused (the only admin, in practice).
    removal: {
      offered: user.role !== 'superadmin',
      refusal: removalBlocked,
    },
  }
})

/**
 * Email yourself the code that confirms removing your account. A fresh request replaces
 * any earlier code, so only the newest email works.
 */
export const requestAccountRemovalCode = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireAuthUser()
  const refusal = await selfRemovalRefusal(user)
  if (refusal) throw badRequest(refusal)

  const code = generateRemovalCode()
  const identifier = removalCodeIdentifier(user.id)
  const now = new Date()
  const db = getDb()
  await db.batch([
    db.delete(verifications).where(eq(verifications.identifier, identifier)),
    db.insert(verifications).values({
      id: crypto.randomUUID(),
      identifier,
      value: removalCodeValue(await hashRemovalCode(user.id, code), 0),
      expiresAt: new Date(now.getTime() + REMOVAL_CODE_TTL_MS),
      createdAt: now,
      updatedAt: now,
    }),
  ])

  await sendAccountRemovalCodeEmail({ to: user.email, otp: code })
  return { sentTo: user.email }
})

export const confirmAccountRemoval = createServerFn({ method: 'POST' })
  .validator(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const db = getDb()
    const identifier = removalCodeIdentifier(user.id)

    const [stored] = await db
      .select()
      .from(verifications)
      .where(eq(verifications.identifier, identifier))
      .limit(1)
    const verdict = judgeRemovalCode({
      stored: stored ?? null,
      submittedHash: await hashRemovalCode(user.id, data.code),
      now: new Date(),
    })
    if (!verdict.ok) {
      if (stored && verdict.discard) {
        await db.delete(verifications).where(eq(verifications.id, stored.id))
      } else if (stored && verdict.nextValue) {
        await db
          .update(verifications)
          .set({ value: verdict.nextValue, updatedAt: new Date() })
          .where(eq(verifications.id, stored.id))
      }
      throw badRequest(REMOVAL_CODE_MESSAGES[verdict.reason])
    }

    // Checked again, not trusted from when the code was sent: in those five minutes the
    // other admin may have left, making this one the last.
    const refusal = await selfRemovalRefusal(user)
    if (refusal) throw badRequest(refusal)

    // Archiving also deletes the code row.
    if (!(await archiveMember(user.id, user.email))) throw conflict(RACED)

    await sendMemberRemovedEmail({
      to: user.email,
      clientName: user.clientName,
      removedBySelf: true,
    })
    if (user.clientId) {
      await recordAudit({
        actorUserId: user.id,
        action: 'member_removed',
        clientId: user.clientId,
        metadata: { name: user.name, email: user.email, role: user.role, self: true },
      })
    }
    return { ok: true }
  })
