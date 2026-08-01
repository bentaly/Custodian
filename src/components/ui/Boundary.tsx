import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureException } from '@sentry/react'
import { shouldIgnore } from '../../lib/sentry'
import { ErrorState } from './ErrorState'

type Props = {
  children: ReactNode
  /** Names the failed section in the fallback, e.g. "Custodian score". */
  label?: string
  /** Changing this value clears the error — e.g. the id of the record on screen. */
  resetKey?: unknown
  /** Replaces the default `ErrorState` fallback entirely. */
  fallback?: (error: unknown, reset: () => void) => ReactNode
}

type State = { error: unknown }

/**
 * Isolates one section of a page so a failure there doesn't blank the whole screen.
 *
 * Worth being precise about what this does and does not catch. React error boundaries
 * see errors thrown during **render, lifecycle and constructors** — they do not see
 * event handlers, `setTimeout`, or rejected promises. Those go through `useAction`
 * instead (src/lib/useAction.ts).
 *
 * That still covers the failure mode this app actually has. The AI columns
 * (`custodianScore`, `dueDiligence`, `deprivation`) hold model-produced JSON that the
 * panels destructure directly, and the charts render whatever numbers they are handed.
 * A missing key or an unexpected null throws during render, which without a boundary
 * takes down the entire application detail page — comments, voting, budget and all.
 *
 * Note this cannot isolate a *data* failure: every panel is fed by one route loader,
 * so if the loader throws there is no page to salvage and the route boundary is the
 * right answer.
 */
export class Boundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (shouldIgnore(error)) return
    captureException(error, {
      tags: { boundary: this.props.label ?? 'unnamed' },
      contexts: { react: { componentStack: info.componentStack } },
    })
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <ErrorState
        error={error}
        variant="panel"
        title={this.props.label ? `${this.props.label} couldn't be shown` : undefined}
        onRetry={this.reset}
      />
    )
  }
}
