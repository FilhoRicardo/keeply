import Link from 'next/link'
import type { ReactNode } from 'react'

// Shared mobile shell for inner screens: back link, eyebrow, title, scrolling content.
export function Screen({
  back,
  eyebrow,
  title,
  children,
  footer,
}: {
  back: { href: string; label: string }
  eyebrow: string
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="app-shell">
      <header className="screen-header">
        <Link className="back-link" href={back.href}>
          <span aria-hidden="true">‹</span> {back.label}
        </Link>
        <p className="aster-eyebrow aster-eyebrow--green">{eyebrow}</p>
        <h1>{title}</h1>
      </header>
      <main className="screen-content">{children}</main>
      {footer ? <footer className="screen-footer">{footer}</footer> : <footer className="site-footer aster-mono">Dishwashers only</footer>}
    </div>
  )
}

export function LoadingPanel() {
  return (
    <div className="empty-state aster-inner" aria-busy="true">
      <p>Loading…</p>
    </div>
  )
}

export function NotFoundPanel() {
  return (
    <div className="empty-state aster-inner">
      <div>
        <h3>We could not find that dishwasher.</h3>
        <p>Check the link, or go back to your appliances.</p>
      </div>
    </div>
  )
}
