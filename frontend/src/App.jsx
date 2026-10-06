import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

/* ---------- Demo data (replace with your simulator / API output) ---------- */
const NOW0 = Date.now()
const min = (m) => NOW0 + m * 60000

const SEED = [
  { id: 1, asset: 'SAT-102 (Sentinel-A)',    sec: 'SL-16 R/B',          secId: 31922, pc: 4.82e-3, miss: 35.2,  vel: 14.2, tca: min(35),  vol: 120.4, rad: 6.5, sigma: 85,  tleAge: 14, conf: 'Medium' },
  { id: 2, asset: 'SAT-208 (GeoEye-3)',      sec: 'Iridium 33 Debris',  secId: 29712, pc: 1.14e-4, miss: 185.0, vel: 11.8, tca: min(170), vol: 64.9,  rad: 4.0, sigma: 120, tleAge: 22, conf: 'Medium' },
  { id: 3, asset: 'SAT-315 (CommsSat-X)',    sec: 'COSMOS 2251 Debris', secId: 34211, pc: 8.3e-6,  miss: 840.5, vel: 9.6,  tca: min(330), vol: 22.1,  rad: 3.2, sigma: 60,  tleAge: 6,  conf: 'High' },
  { id: 4, asset: 'SAT-105 (NavConstell-1)', sec: 'FENGYUN 1C Debris',  secId: 24871, pc: 6.15e-3, miss: 18.4,  vel: 13.1, tca: min(80),  vol: 143.7, rad: 5.0, sigma: 210, tleAge: 41, conf: 'Low' },
  { id: 5, asset: 'SAT-412 (WeatherData-2)', sec: 'Unknown Debris',     secId: 51102, pc: 2.3e-4,  miss: 210.0, vel: 10.4, tca: min(240), vol: 71.3,  rad: 2.5, sigma: 150, tleAge: 30, conf: 'Low' },
]

const ORBITS = [
  { rx: 150, ry: 60,  rot: -15, dur: 14 },
  { rx: 175, ry: 90,  rot: 10,  dur: 20 },
  { rx: 190, ry: 120, rot: 0,   dur: 26 },
  { rx: 125, ry: 45,  rot: 30,  dur: 11 },
  { rx: 160, ry: 100, rot: -40, dur: 18 },
]

const GLOSSARY = [
  ['Pc (collision probability)', 'Chance the two objects actually collide, given the position uncertainty of both. Shown with a low–high range.'],
  ['TCA (time of closest approach)', 'The moment the two objects are nearest to each other.'],
  ['Miss distance', 'Predicted straight-line gap at TCA. A small miss with large uncertainty can still be risky.'],
  ['Covariance / uncertainty (1σ)', 'How unsure we are about each position. Larger values widen the Pc range.'],
  ['Priority score', 'Rank used to sort the queue: 50% Pc, 20% miss distance, 20% time left, 10% uncertainty.'],
  ['Risk tiers', 'Urgent: Pc ≥ 1E-3. Review: Pc ≥ 1E-4. Watch: below that, or dismissed by an operator.'],
]

/* ---------- Helpers ---------- */
const clamp = (x) => Math.max(0, Math.min(1, x))
const tierOf = (e) => (e.dismissed ? 'Watch' : e.pc >= 1e-3 ? 'Urgent' : e.pc >= 1e-4 ? 'Review' : 'Watch')
const fmtPc = (n) => n.toExponential(2).replace('e-', 'E-').replace('e+', 'E+').replace(/E-0?/, 'E-')
const fmtTime = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const stamp = () => new Date().toISOString().slice(11, 19)
const deltaV = (pc) => Math.max(0.05, 0.12 * Math.log10(pc / 1e-6))
const countdown = (t, now) => {
  const m = Math.max(0, Math.round((t - now) / 60000))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function factors(e, now) {
  const hrs = Math.max(0, (e.tca - now) / 3600000)
  const f = [
    { name: 'Collision probability', w: 50, v: clamp((Math.log10(e.pc) + 6) / 4), note: fmtPc(e.pc) },
    { name: 'Miss distance',         w: 20, v: clamp(1 - e.miss / 1000),          note: `${e.miss.toFixed(1)} m` },
    { name: 'Time to TCA',           w: 20, v: clamp(1 - hrs / 12),               note: countdown(e.tca, now) },
    { name: 'Position uncertainty',  w: 10, v: clamp(e.sigma / 300),              note: `${e.sigma} m (1σ)` },
  ]
  const score = Math.round(f.reduce((s, x) => s + x.v * x.w, 0))
  return { f, score }
}

function explain(e, tier) {
  const unc = e.sigma > 150 ? 'Uncertainty is high, so the Pc range is wide and fresher tracking would help.' : 'Uncertainty is moderate.'
  if (tier === 'Urgent')
    return `Critical conjunction: ${fmtPc(e.pc)} at only ${e.miss.toFixed(1)} m with ${e.vel} km/s closing speed. ${unc} Immediate operator review required.`
  if (tier === 'Review')
    return `Elevated probability (${fmtPc(e.pc)}) at ${e.miss.toFixed(0)} m. ${unc} Refresh tracking data and re-evaluate before the next screening cycle.`
  return `Low probability (${fmtPc(e.pc)}) with a ${e.miss.toFixed(0)} m miss distance. ${unc} Keep monitoring; no action needed unless it grows.`
}

/* ---------- App ---------- */
export default function App() {
  const [events, setEvents] = useState(SEED)
  const [selectedId, setSelectedId] = useState(1)
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(Date.now())
  const [burns, setBurns] = useState({})
  const [spinning, setSpinning] = useState(true)
  const [log, setLog] = useState([{ t: stamp(), m: 'Screening complete: 5 conjunctions found in 24 h window' }])
  const svgRef = useRef(null)

  const addLog = (m) => setLog((l) => [{ t: stamp(), m }, ...l].slice(0, 8))

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    spinning ? svg.unpauseAnimations() : svg.pauseAnimations()
  }, [spinning, events.length])

  const ranked = useMemo(
    () => events
      .map((e) => ({ ...e, tier: tierOf(e), score: factors(e, now).score }))
      .sort((a, b) => b.score - a.score),
    [events, now]
  )
  const count = (t) => ranked.filter((e) => e.tier === t).length
  const rows = ranked.filter(
    (e) =>
      (filter === 'All' || e.tier === filter) &&
      `${e.asset} ${e.sec} ${e.secId}`.toLowerCase().includes(query.toLowerCase())
  )
  const selected = ranked.find((e) => e.id === selectedId)
  const rank = selected ? ranked.indexOf(selected) + 1 : 0
  const nextTca = [...ranked].filter((e) => e.tca > now).sort((a, b) => a.tca - b.tca)[0]

  const simulate = () => {
    const miss = +(10 + Math.random() * 900).toFixed(1)
    const pc = Math.min(9e-3, 0.02 * Math.exp(-miss / 45) * (0.5 + Math.random()))
    const id = Date.now()
    const name = `SAT-${Math.floor(100 + Math.random() * 800)} (Sim-${events.length + 1})`
    setEvents((p) => [
      ...p,
      {
        id, asset: name, sec: 'Simulated Debris', secId: Math.floor(10000 + Math.random() * 60000),
        pc, miss, vel: +(7 + Math.random() * 8).toFixed(1),
        tca: Date.now() + (30 + Math.random() * 400) * 60000,
        vol: +(20 + Math.random() * 130).toFixed(1),
        rad: +(2 + Math.random() * 5).toFixed(1), sigma: Math.floor(50 + Math.random() * 200),
        tleAge: Math.floor(4 + Math.random() * 40), conf: ['High', 'Medium', 'Low'][Math.floor(Math.random() * 3)],
      },
    ])
    setSelectedId(id)
    addLog(`New conjunction detected: ${name}`)
  }

  const reset = () => { setSelectedId(ranked[0]?.id); setFilter('All'); setQuery('') }
  const dismiss = (e) => {
    setEvents((p) => p.map((x) => (x.id === e.id ? { ...x, dismissed: true } : x)))
    addLog(`${e.asset} moved to Watch by operator`)
  }
  const planBurn = (e) => {
    const dv = deltaV(e.pc).toFixed(2)
    setBurns((b) => ({ ...b, [e.id]: dv }))
    addLog(`Burn planned for ${e.asset}: ${dv} m/s`)
  }

  const f = selected ? factors(selected, now) : null
  const range = selected ? (() => { const k = 1.4 + selected.sigma / 120; return [selected.pc / k, selected.pc * k] })() : []
  const lead = selected ? Math.max(0, (selected.tca - now) / 1000) : 0
  const dv = selected ? deltaV(selected.pc) : 0
  const options = selected ? [
    { name: 'Prograde burn',   dv: dv,        gain: 2 * dv * lead,   tag: 'Recommended' },
    { name: 'Retrograde burn', dv: dv * 1.1,  gain: 2 * dv * 1.1 * lead, tag: 'Alternative' },
    { name: 'Radial burn',     dv: dv * 2.2,  gain: 0.5 * dv * 2.2 * lead, tag: 'Costly' },
  ] : []

  return (
    <div className="app">
      {/* ---------- Header ---------- */}
      <header className="topbar">
        <div className="brand">
          <div className="logo">🛰️</div>
          <div>
            <h1>ORBITAL GUARD <span className="ver">v3.4 PRO</span></h1>
            <small>Advanced Collision-Risk Triage &amp; Ephemeris Analytics</small>
          </div>
        </div>
        <div className="top-right">
          <span className="online"><i /> SYSTEM ONLINE</span>
          <div className="clock">
            {new Date(now).toISOString().slice(0, 19).replace('T', ' ')} UTC
            <small>NORAD Two-Line Feed: Active</small>
          </div>
          <button className="btn primary" onClick={simulate}>＋ Simulate</button>
        </div>
      </header>

      <main className="layout">
        {/* ---------- Left column ---------- */}
        <section className="left">
          <div className="stats">
            <Stat label="TRACKED" value="1,255" sub="🌐 Global objects" color="blue" />
            <Stat label="ACTIVE ALERTS" value={ranked.length} sub="▲ 24hr window" color="indigo" />
            <Stat label="URGENT" value={count('Urgent')} sub="🔥 Pc ≥ 1E-3" color="red" />
            <Stat label="REVIEW" value={count('Review')} sub="👓 Pc ≥ 1E-4" color="amber" />
          </div>

          {nextTca && (
            <div className="banner">
              <span><b>Next closest approach:</b> {nextTca.asset} in <b>{countdown(nextTca.tca, now)}</b></span>
              <span><b>Top priority:</b> {ranked[0].asset} (score {ranked[0].score})</span>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h2>☰ Conjunction Triage Queue</h2>
              <div className="tabs">
                {['All', 'Urgent', 'Review', 'Watch'].map((t) => (
                  <button key={t} className={filter === t ? 'active' : ''} onClick={() => setFilter(t)}>
                    {t} ({t === 'All' ? ranked.length : count(t)})
                  </button>
                ))}
              </div>
            </div>

            <input
              className="search"
              placeholder="🔍  Search Primary Asset or Debris..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>PRIMARY ASSET / DEBRIS</th><th>RISK TIER</th><th>SCORE</th>
                    <th>COLLISION PROB (PC)</th><th>MISS DIST</th><th>TCA (UTC)</th><th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className={e.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(e.id)}>
                      <td className="muted">{ranked.indexOf(e) + 1}</td>
                      <td>
                        <b>{e.asset}</b>
                        <div className="muted">vs {e.sec} (#{e.secId})</div>
                      </td>
                      <td><span className={`badge ${e.tier.toLowerCase()}`}>{e.tier}</span></td>
                      <td>
                        <div className="score"><i style={{ width: `${e.score}%` }} className={e.tier.toLowerCase()} /></div>
                        <span className="small mono">{e.score}</span>
                      </td>
                      <td className="mono">{fmtPc(e.pc)}</td>
                      <td className="mono">{e.miss.toFixed(1)} m</td>
                      <td className="mono small">{fmtTime(e.tca)}<div className="muted">in {countdown(e.tca, now)}</div></td>
                      <td><button className="btn ghost" onClick={() => setSelectedId(e.id)}>Inspect</button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan="8" className="empty">No events match this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-col">
            <div className="panel">
              <h2 className="h-sm">📜 Operator Activity Log</h2>
              <ul className="log">
                {log.map((l, i) => (
                  <li key={i}><span className="mono muted">{l.t}</span> {l.m}</li>
                ))}
              </ul>
            </div>
            <div className="panel">
              <h2 className="h-sm">📖 How to read this dashboard</h2>
              <div className="gloss">
                {GLOSSARY.map(([t, d]) => (
                  <details key={t}>
                    <summary>{t}</summary>
                    <p>{d}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Right column ---------- */}
        <aside className="right">
          <div className="panel orbit">
            <span className="chip">● 3D ECI ORBITAL VIEW</span>
            <div className="orbit-btns">
              <button className="btn ghost" onClick={reset}>🎥 Reset</button>
              <button className="btn ghost" onClick={() => setSpinning((s) => !s)}>
                {spinning ? '⟳ Pause' : '⟳ Rotate'}
              </button>
            </div>

            <svg ref={svgRef} viewBox="0 0 400 400" className="orbit-svg">
              <defs>
                <radialGradient id="earth" cx="35%" cy="30%">
                  <stop offset="0%" stopColor="#2f5fa8" />
                  <stop offset="60%" stopColor="#14336b" />
                  <stop offset="100%" stopColor="#081a3d" />
                </radialGradient>
              </defs>
              {ranked.map((e, i) => {
                const o = ORBITS[i % ORBITS.length]
                const sel = e.id === selectedId
                const col = e.tier === 'Urgent' ? '#ef4444' : e.tier === 'Review' ? '#f59e0b' : '#38bdf8'
                const d = `M${200 - o.rx},200 a${o.rx},${o.ry} 0 1,0 ${2 * o.rx},0 a${o.rx},${o.ry} 0 1,0 ${-2 * o.rx},0`
                return (
                  <g key={e.id} transform={`rotate(${o.rot} 200 200)`}>
                    <path d={d} fill="none" stroke={sel ? col : '#2a4a8a'} strokeOpacity={sel ? 0.9 : 0.5} strokeWidth="1" />
                    <circle r={sel ? 7 : 5} fill={col} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(e.id)}>
                      <animateMotion dur={`${o.dur}s`} repeatCount="indefinite" path={d} begin={`-${(i * 3.7) % o.dur}s`} />
                    </circle>
                  </g>
                )
              })}
              <circle cx="200" cy="200" r="62" fill="url(#earth)" stroke="#27478a" strokeWidth="2" />
            </svg>

            <div className="legend">
              <span><i className="dot urgent" /> Urgent</span>
              <span><i className="dot review" /> Review</span>
              <span><i className="dot watch" /> Watch</span>
              <span className="link">ECI Frame</span>
            </div>
          </div>

          {selected && (
            <div className="panel report">
              <div className="panel-head">
                <h2>🧠 AI Explainable Risk Report</h2>
                <span className={`badge ${selected.tier.toLowerCase()}`}>{selected.tier.toUpperCase()} RISK</span>
              </div>

              <div className="box">
                <small className="muted">PRIMARY ASSET VS SECONDARY</small>
                <h3>{selected.asset}</h3>
                <span className="link">⊕ Target: {selected.sec} (#{selected.secId})</span>
                <div className="chips">
                  <span className="chip2">Rank #{rank} of {ranked.length}</span>
                  <span className="chip2">Priority {selected.score}/100</span>
                  <span className={`chip2 conf-${selected.conf.toLowerCase()}`}>Tracking confidence: {selected.conf}</span>
                </div>
              </div>

              <div className="metrics">
                <div className="box"><small>Prob (P_c)</small><b className={selected.tier === 'Urgent' ? 'red' : ''}>{fmtPc(selected.pc)}</b></div>
                <div className="box"><small>Miss Dist</small><b>{selected.miss.toFixed(1)} m</b></div>
                <div className="box"><small>Closing Vel</small><b>{selected.vel} km/s</b></div>
              </div>

              <div className="box">
                <small className="muted">Pc UNCERTAINTY RANGE</small>
                <p className="mono">{fmtPc(range[0])} — <b>{fmtPc(selected.pc)}</b> — {fmtPc(range[1])}</p>
                <small className="muted">
                  Based on {selected.sigma} m position uncertainty (1σ), {selected.rad} m combined hard-body radius, TLE age {selected.tleAge} h.
                </small>
              </div>

              <div className="box">
                <small className="muted">WHY THIS RANK? (score breakdown)</small>
                {f.f.map((x) => (
                  <div className="factor" key={x.name}>
                    <div className="split"><span>{x.name} <span className="muted">({x.w}%)</span></span><span className="mono small">{x.note}</span></div>
                    <div className="bar"><i style={{ width: `${Math.round(x.v * 100)}%` }} /></div>
                  </div>
                ))}
              </div>

              <div className="box">
                <div className="split">
                  <small className="muted">AI EXPLANATION &amp; COVARIANCE</small>
                  <small className="link">VOLUME: {selected.vol} m³</small>
                </div>
                <p>{explain(selected, selected.tier)}</p>
              </div>

              <div className="box maneuver">
                <small className="link">🛡 MANEUVER OPTIONS (TCA minus {countdown(selected.tca, now)})</small>
                <table className="opts">
                  <thead><tr><th>Option</th><th>Δv</th><th>Est. new miss</th><th></th></tr></thead>
                  <tbody>
                    {options.map((o) => (
                      <tr key={o.name}>
                        <td>{o.name}</td>
                        <td className="mono">{o.dv.toFixed(2)} m/s</td>
                        <td className="mono">{Math.round(selected.miss + o.gain).toLocaleString()} m</td>
                        <td><span className="small muted">{o.tag}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <small className="muted">Demo estimates only. Final burns need operator and flight-dynamics approval.</small>
              </div>

              <div className="actions">
                <button className="btn primary wide" onClick={() => planBurn(selected)}>
                  {burns[selected.id] ? `✔ Burn planned: ${burns[selected.id]} m/s` : '🖩 Compute Burn Δv'}
                </button>
                <button className="btn ghost" onClick={() => dismiss(selected)}>Dismiss / Watch</button>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <div className={`stat ${color}`}>
      <small>{label}</small>
      <b>{value}</b>
      <span>{sub}</span>
    </div>
  )
}