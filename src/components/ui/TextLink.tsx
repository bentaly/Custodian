import { Link, type LinkComponentProps } from '@tanstack/react-router'
import { cn } from './cn'

// The counterpart to `Button`'s `text` variant: identical to look at, but an actual
// anchor, for things that actually go somewhere.
//
// The pair exists so the choice between them is about behaviour rather than appearance.
// If it navigates it is a `TextLink` — focusable as a link, announced as a link,
// middle-clickable, copyable — and if it acts on this page it is a `Button`, whatever
// it looks like. Before this the app had text buttons called "link" and hand-styled
// anchors repeating `text-success hover:underline`, and no way to tell which was
// which without reading the handler.

const TEXT_LINK = 'font-display font-medium text-brand hover:underline'

/** In-app navigation. Takes TanStack Router's `to` / `params` / `search`. */
export function TextLink({ className, ...props }: LinkComponentProps<'a'>) {
  return <Link className={cn(TEXT_LINK, className)} {...props} />
}

/** The same, for an external URL or a `mailto:` — where a router link makes no sense. */
export function ExternalTextLink({
  className,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cn(TEXT_LINK, className)} {...props}>
      {children}
    </a>
  )
}
