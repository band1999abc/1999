import './_group.css';

// Sample data — representative mock tracks
const TRACKS = [
  { name: 'Hollow Blue', releaseDate: '2024-11-03', plays: 3241, listeners: 618, d1: 184, d7: 692, d30: 1840, trend: 'up' },
  { name: 'Vertigo Line',  releaseDate: '2024-07-14', plays: 2187, listeners: 441, d1: 97,  d7: 389, d30: 1102, trend: 'neu' },
  { name: 'Pale Circuit',  releaseDate: '2024-03-22', plays: 1954, listeners: 374, d1: 143, d7: 511, d30: 987,  trend: 'up' },
  { name: 'Ebb & Static',  releaseDate: '2023-12-01', plays: 4108, listeners: 792, d1: 261, d7: 890, d30: 2403, trend: 'down' },
  { name: 'Outer Shelf',   releaseDate: '2023-08-19', plays: 1122, listeners: 235, d1: 58,  d7: 201, d30: 673,  trend: 'neu' },
];

function daysSince(dateStr: string) {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / 86400000);
}

function fmt(n: number) { return n.toLocaleString(); }

export function TrackList() {
  return (
    <div className="ri-root">
      <p className="ri-page-title">Release Impact</p>

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 24 }}>
        <div className="ri-card">
          <div className="ri-card-value">5</div>
          <div className="ri-card-label">Tracks tracked</div>
        </div>
        <div className="ri-card">
          <div className="ri-card-value">12,612</div>
          <div className="ri-card-label">Total plays</div>
        </div>
      </div>

      {/* Sort/filter row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="ri-section-label" style={{ border: 'none', paddingBottom: 0, marginBottom: 0 }}>
          楽曲 — {TRACKS.length}
        </div>
        <div className="ri-toggle-group">
          <button className="ri-toggle-btn is-active">Release</button>
          <button className="ri-toggle-btn">Plays</button>
          <button className="ri-toggle-btn">7d</button>
        </div>
      </div>

      {/* Track list */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {TRACKS.map(t => {
          const days = daysSince(t.releaseDate);
          const isNew = days <= 30;
          return (
            <div
              key={t.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                padding: '14px 0',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                alignItems: 'start',
              }}
            >
              {/* Left: name + meta */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                  <span style={{
                    color: 'var(--text-dark)',
                    fontSize: 14,
                    letterSpacing: '0.01em',
                  }}>{t.name}</span>
                  {isNew && (
                    <span style={{
                      background: 'var(--accent)',
                      color: '#fff',
                      fontSize: 8,
                      letterSpacing: '0.1em',
                      padding: '2px 5px',
                      textTransform: 'uppercase',
                    }}>NEW</span>
                  )}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.03em' }}>
                  {t.releaseDate} · {days}日経過
                </div>
                {/* 初動 mini pills */}
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  {[
                    { label: '24h', val: t.d1 },
                    { label: '7d',  val: t.d7 },
                    { label: '30d', val: t.d30 },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}>
                      <div style={{ color: 'var(--text-dark)', fontSize: 12, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
                        {fmt(s.val)}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: total + trend */}
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  color: 'var(--text-dark)',
                  fontSize: 20,
                  fontWeight: 300,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                }}>
                  {fmt(t.plays)}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.03em', marginTop: 2 }}>
                  plays
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className={`ri-delta ri-delta--${t.trend}`}>
                    {t.trend === 'up' ? '↑' : t.trend === 'down' ? '↓' : '–'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.04em', marginTop: 20, textAlign: 'center' }}>
        タップで詳細を表示
      </div>
    </div>
  );
}
