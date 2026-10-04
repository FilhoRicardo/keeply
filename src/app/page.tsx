import Link from 'next/link'
import { ApplianceCount, ApplianceList } from './appliance-list'

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
            <ApplianceCount />
          </div>

          <ApplianceList />

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
