import { Breadcrumb, type Crumb } from './ui'

/**
 * Shared chrome for a Settings sub-page: the trail back to the hub, then the title.
 * Settings pages are reached by card, so without the breadcrumb there is no sidebar
 * entry to click back to.
 */
export function SettingsPage({
  title,
  description,
  crumbs = [],
  children,
}: {
  title: string
  description?: string
  /** Any levels between Settings and this page. The page itself is appended. */
  crumbs?: Crumb[]
  children: React.ReactNode
}) {
  return (
    <div className="max-w-3xl">
      <Breadcrumb items={[{ label: 'Settings', to: '/settings' }, ...crumbs, { label: title }]} />
      <h1 className="mt-3 text-2xl font-semibold text-[#141C24]">{title}</h1>
      {description && <p className="mt-1 text-sm text-[#637083]">{description}</p>}
      <div className="mt-8">{children}</div>
    </div>
  )
}
