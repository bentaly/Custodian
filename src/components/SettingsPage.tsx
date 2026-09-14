import { Breadcrumb, type Crumb } from './ui'
import { C } from './ui/tokens'

/**
 * Shared chrome for a Settings sub-page: the trail back to the hub, then the title.
 * Settings pages are reached by card, so without the breadcrumb there is no sidebar
 * entry to click back to.
 *
 * The header is the app's header — `font-display text-heading font-medium`, the same
 * `<h1>` Applications, Awards, Finance and Reports wear. It used to be
 * `text-heading font-semibold` with no `font-display`, which is heavier AND wider (the
 * utility carries the -0.025em tracking), so every Settings page announced itself in a
 * different voice from the screen you had just left.
 *
 * The column stays capped where the list screens run full width, and that is deliberate:
 * these pages are prose and forms, and a text field stretched across a 27" display is
 * not a better field. One cap for all of them, rather than the 3xl/4xl/5xl the pages had
 * picked individually.
 */
export function SettingsPage({
  title,
  description,
  crumbs = [],
  children,
}: {
  title: string
  /** A string renders as one paragraph; pass a node for anything longer, such as a list. */
  description?: React.ReactNode
  /** Any levels between Settings and this page. The page itself is appended. */
  crumbs?: Crumb[]
  children: React.ReactNode
}) {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Breadcrumb items={[{ label: 'Settings', to: '/settings' }, ...crumbs, { label: title }]} />
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
          {title}
        </h1>
        {typeof description === 'string' ? (
          <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
            {description}
          </p>
        ) : description ? (
          <div
            className="flex flex-col gap-2 font-display text-body leading-relaxed"
            style={{ color: C.sub }}
          >
            {description}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}
