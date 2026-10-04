import Link from 'next/link'

export default function Home() {
  return (
    <div className="app-shell">
      <header className="site-header" aria-label="Keeply">
        <span className="brand-mark" aria-hidden="true">
          ✲
        </span>
        <div>
          <p className="aster-eyebrow aster-eyebrow--green">Maintenance, made clear</p>
          <h1>Keeply</h1>
        </div>
      </header>

      <main className="home-content">
        <section className="appliances-panel aster-glass" aria-labelledby="appliances-title">
          <div className="section-heading">
            <div>
              <p className="aster-eyebrow">Your home</p>
              <h2 id="appliances-title">My appliances</h2>
            </div>
            <span className="appliance-count" aria-hidden="true">
              0
            </span>
          </div>

          <div className="empty-state aster-inner">
            <span className="appliance-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <rect x="5" y="2.75" width="14" height="18.5" rx="2" />
                <path d="M5 8h14M8 5.5h.01M11 5.5h5M8.5 12.25a4.5 4.5 0 1 0 7 0" />
              </svg>
            </span>
            <div>
              <h3>No appliances yet.</h3>
              <p>Add your dishwasher to start building its maintenance plan.</p>
            </div>
          </div>

          <Link className="aster-btn aster-btn--primary add-appliance" href="/appliances/new">
            <span aria-hidden="true">＋</span>
            Add manually
          </Link>
        </section>
      </main>

      <footer className="site-footer aster-mono">Dishwashers only</footer>
    </div>
  )
}
