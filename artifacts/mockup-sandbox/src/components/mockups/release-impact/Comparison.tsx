import './_group.css';

// ── Mock data ─────────────────────────────────────────────────────────────
const RANK_7D = [
  { name: 'Hollow Blue',  plays: 692,  delta: '+68%' },
  { name: 'Pale Circuit', plays: 511,  delta: '+31%' },
  { name: 'Ebb & Static', plays: 890,  delta: '—'    },
  { name: 'Vertigo Line', plays: 389,  delta: '+12%' },
  { name: 'Outer Shelf',  plays: 201,  delta: '—'    },
];

const RANK_30D = [
  { name: 'Ebb & Static',  plays: 2403, delta: '—'    },
  { name: 'Hollow Blue',   plays: 1840, delta: '+68%' },
  { name: 'Pale Circuit',  plays: 987,  delta: '+31%' },
  { name: 'Vertigo Line',  plays: 1102, delta: '—'    },
  { name: 'Outer Shelf',   plays: 673,  delta: '—'    },
];

const TOP_GROWTH = [
  { name: 'Hollow Blue',  growth: '+68%', note: '直近ライブ前後比' },
  { name: 'Pale Circuit', growth: '+31%', note: 'Diary公開後比' },
  { name: 'Vertigo Line', growth: '+12%', note: '先週比' },
];

const TOP_NOW = [
  { name: 'Ebb & Static', plays: 47, note: '過去24時間' },
  { name: 'Hollow Blue',  plays: 38, note: '過去24時間' },
  { name: 'Pale Circuit', plays: 21, note: '過去24時間' },
];

function RankTable({
  rows,
  valueLabel,
  showDelta,
}: {
  rows: { name: string; plays?: number; growth?: string; delta?: string; note?: string }[];
  valueLabel: string;
  showDelta?: boolean;
}) {
  return (
    <table className="ri-table" style={{ marginBottom: 4 }}>
      <thead>
        <tr>
          <th style={{ minWidth: 14, paddingRight: 8 }}>#</th>
          <th style={{ textAlign: 'left' }}>Track</th>
          <th>{valueLabel}</th>
          {showDelta && <th>vs Live</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.name}>
            <td style={{ color: 'var(--text-muted)', fontSize: 11, paddingRight: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {i + 1}
            </td>
            <td>
              <div>{r.name}</div>
              {r.note && (
                <div style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.03em', marginTop: 2 }}>
                  {r.note}
                </div>
              )}
            </td>
            <td className="ri-td--main">
              {r.plays !== undefined ? r.plays.toLocaleString() : r.growth}
            </td>
            {showDelta && (
              <td className={`ri-delta ri-delta--${r.delta?.startsWith('+') ? 'up' : 'neu'}`}
                style={{ textAlign: 'right', fontSize: 11 }}>
                {r.delta}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Comparison() {
  return (
    <div className="ri-root">
      <p className="ri-page-title">比較 — Release Impact</p>

      {/* 7-day ranking */}
      <div className="ri-section-label" style={{ marginTop: 0 }}>公開7日間ランキング</div>
      <RankTable rows={RANK_7D} valueLabel="Plays" showDelta />

      <hr className="ri-divider" />

      {/* 30-day ranking */}
      <div className="ri-section-label">公開30日間ランキング</div>
      <RankTable rows={RANK_30D} valueLabel="Plays" showDelta />

      <hr className="ri-divider" />

      {/* Most growth */}
      <div className="ri-section-label">最も伸びた楽曲</div>
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {TOP_GROWTH.map((r, i) => (
          <div key={r.name} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 0',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {i + 1}
              </span>
              <div>
                <div style={{ color: 'var(--text-dark)', fontSize: 13, letterSpacing: '0.01em' }}>{r.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.03em', marginTop: 2 }}>{r.note}</div>
              </div>
            </div>
            <span style={{ color: '#4a7c59', fontSize: 16, fontWeight: 300, letterSpacing: '-0.01em' }}>
              {r.growth}
            </span>
          </div>
        ))}
      </div>

      <hr className="ri-divider" />

      {/* Currently most played */}
      <div className="ri-section-label">現在最も再生されている楽曲</div>
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {TOP_NOW.map((r, i) => (
          <div key={r.name} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 0',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {i + 1}
              </span>
              <div>
                <div style={{ color: 'var(--text-dark)', fontSize: 13, letterSpacing: '0.01em' }}>{r.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.03em', marginTop: 2 }}>{r.note}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--text-dark)', fontSize: 18, fontWeight: 300, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                {r.plays}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase' }}>plays</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28, padding: '14px 0', borderTop: '1px solid var(--border)' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.06em', textAlign: 'center', margin: 0, textTransform: 'uppercase' }}>
          各楽曲をタップで Release Impact 詳細へ
        </p>
      </div>
    </div>
  );
}
