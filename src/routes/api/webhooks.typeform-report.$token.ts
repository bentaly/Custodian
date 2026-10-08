import { createFileRoute } from '@tanstack/react-router'
import { receiveReport, receiveWebhook } from '../../server/webhookIntake'

// Typeform posts a GRANT REPORT here: the report-side twin of
// `/api/webhooks/typeform/<token>`, as `/api/submit-report` is the twin of `/api/apply`.
//
// Same token, different address. The token says WHO (which foundation), the address
// says WHAT (an application or a report), because a Typeform webhook is one URL and
// nothing else, and the form it belongs to is either an application form or a report
// form. Settings → API keys shows both addresses when a webhook token is made.
//
// Before this existed, a report form had no direct route in: `/api/submit-report`
// reads a Typeform envelope but needs an `Authorization` header Typeform cannot send,
// and the only webhook address made APPLICATIONS, so pasting it into a report form
// turned every report into an application.
//
// A report form rarely asks for our reference, so the Typeform "Submission ID" is NOT
// mapped to one here (the report dictionary does not know it). A report links by a
// hidden field carrying the application reference, else by charity number, else it
// waits on the Reports screen for an admin. See `reportMapping/ingest.ts`.
//
// The door is shared with every platform's route: see `server/webhookIntake.ts`.

export const Route = createFileRoute('/api/webhooks/typeform-report/$token')({
  server: {
    handlers: {
      POST: ({ request, params }: { request: Request; params: { token: string } }) =>
        receiveWebhook(request, params.token, receiveReport),
    },
  },
} as any)
