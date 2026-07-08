import './_group.css';

// ── Mock data for "Hollow Blue" ─────────────────────────────────────────────
const TRACK = {
  name: 'Hollow Blue',
  releaseDate: '2024-11-03',
  totalPlays: 3241,
  listeners: 618,
  returningRate: 0.42,
};

const HATSUDO = [
  { period: '24時間', plays: 184, visitors: 162, returning: 22 },
  { period: '7日間',  plays: 692, visitors: 487, returning: 205 },
  { period: '30日間', plays: 1840,visitors: 891, returning: 421 },
];

const ANALYSIS = [
  { label: 'ライブ前後の再生数増加率', value: '+68%',  note: '直近ライブ前後 ±3日で比較' },
  { label: 'Diary公開後の変化',         value: '+31%',  note: 'Diary公開後 24h 平均' },
  { label: 'Returning Visitor率',       value: '42.3%', note: '全期間' },
  { label: '平均再生時間',               value: '—',     note: '取得できません' },
];

// ── Simple SVG sparkline with event markers ─────────────────────────────────
function Sparkline() {
  // 60-day cumulative data (fake but realistic)
  const raw = [
    184,276,340,410,470,510,545,580,620,660,
    692,720,755,790,820,850,880,910,940,968,
    1010,1060,1100,1140,1170,1200,1225,1260,1290,1310,
    1340,1360,1390,1415,1440,1470,1490,1510,1530,1545,
    1570,1600,1630,1668,1700,1735,1760,1790,1820,1840,
    1880,1920,1970,2020,2080,2150,2220,2290,2340,3241,
  ];

  const W = 440, H = 160;
  const PL = 8, PR = 8, PT = 10, PB = 28;
  const cw = W - PL - PR;
  const ch = H - PT - PB;

  const min = 0;
  const max = raw[raw.length - 1];
  const n = raw.length;

  function px(i: number) { return PL + (i / (n - 1)) * cw; }
  function py(v: number) { return PT + ch - ((v - min) / (max - min)) * ch; }

  const pts = raw.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const areaPath = `M${PL},${PT + ch} ` +
    raw.map((v, i) => `L${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ') +
    ` L${PL + cw},${PT + ch} Z`;

  // Event markers: Live at day 8, Diary at day 22, release at day 0
  const events = [
    { day: 0,  type: 'release', label: 'Release' },
    { day: 8,  type: 'live',    label: 'Live' },
    { day: 22, type: 'diary',   label: 'Diary' },
    { day: 45, type: 'live',    label: 'Live' },
  ];

  // X-axis labels
  const xLabels = [0, 15, 30, 45, 59].map(i => ({
    x: px(i),
    label: `+${i}d`,
  }));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <defs>
          <linearGradient id="ri-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#8a6a42" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#8a6a42" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path d={areaPath} fill="url(#ri-grad)" />

        {/* Line */}
        <polyline
          points={pts}
          fill="none"
          stroke="#8a6a42"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Event markers */}
        {events.map((ev, i) => {
          const x = px(ev.day);
          const col = ev.type === 'live' ? '#8a6a42'
                    : ev.type === 'diary' ? '#aaa'
                    : '#4a7c59';
          const dash = ev.type === 'diary' ? '3,3' : ev.type === 'release' ? '2,2' : undefined;
          return (
            <g key={i}>
              <line
                x1={x} y1={PT} x2={x} y2={PT + ch}
                stroke={col}
                strokeWidth="1"
                strokeDasharray={dash}
                opacity="0.7"
              />
              <text
                x={x + 2}
                y={PT - 2}
                fill={col}
                fontSize="7"
                letterSpacing="0.06em"
                style={{ textTransform: 'uppercase' }}
              >
                {ev.label}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={H - 2}
            fill="#999"
            fontSize="8"
            textAnchor="middle"
            letterSpacing="0.04em"
          >
            {l.label}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        {[
          { col: '#4a7c59', label: 'Release', dash: true },
          { col: '#8a6a42', label: 'Live', dash: false },
          { col: '#aaa',    label: 'Diary', dash: true },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="16" height="8">
              <line
                x1="0" y1="4" x2="16" y2="4"
                stroke={l.col}
                strokeWidth="1.5"
                strokeDasharray={l.dash ? '3,2' : undefined}
              />
            </svg>
            <span style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {l.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrackDetail() {
  const days = Math.floor((Date.now() - new Date(TRACK.releaseDate).getTime()) / 86400000);

  return (
    <div className="ri-root">
      <button className="ri-back">← Release Impact</button>

      {/* Hero */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          color: 'var(--text-dark)',
          fontSize: 28,
          fontWeight: 300,
          letterSpacing: '-0.01em',
          lineHeight: 1.1,
          margin: '0 0 6px',
        }}>
          {TRACK.name}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.04em', margin: 0 }}>
          {TRACK.releaseDate} リリース · {days}日経過
        </p>
      </div>

      {/* 概要 */}
      <div className="ri-section-label">概要</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 24 }}>
        <div className="ri-card">
          <div className="ri-card-value">{TRACK.totalPlays.toLocaleString()}</div>
          <div className="ri-card-label">Total plays</div>
        </div>
        <div className="ri-card">
          <div className="ri-card-value">{TRACK.listeners.toLocaleString()}</div>
          <div className="ri-card-label">Unique listeners</div>
        </div>
        <div className="ri-card">
          <div className="ri-card-value">{(TRACK.returningRate * 100).toFixed(1)}%</div>
          <div className="ri-card-label">Returning visitor率</div>
        </div>
        <div className="ri-card">
          <div className="ri-card-value">—</div>
          <div className="ri-card-label">平均再生時間</div>
        </div>
      </div>

      {/* 初動 */}
      <div className="ri-section-label">初動</div>
      <table className="ri-table" style={{ marginBottom: 24 }}>
        <thead>
          <tr>
            <th></th>
            <th>Plays</th>
            <th>Visitors</th>
            <th>Returning</th>
          </tr>
        </thead>
        <tbody>
          {HATSUDO.map(row => (
            <tr key={row.period}>
              <td>{row.period}</td>
              <td className="ri-td--main">{row.plays.toLocaleString()}</td>
              <td>{row.visitors.toLocaleString()}</td>
              <td>{row.returning.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 推移 */}
      <div className="ri-section-label">推移 — 累計再生数</div>
      <div style={{ marginBottom: 24, marginTop: 10 }}>
        <Sparkline />
      </div>

      {/* 分析 */}
      <div className="ri-section-label">分析</div>
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {ANALYSIS.map(row => (
          <div key={row.label} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: '11px 0',
            borderBottom: '1px solid var(--border)',
            gap: 10,
          }}>
            <div>
              <div style={{ color: 'var(--text-dark)', fontSize: 12, letterSpacing: '0.01em' }}>
                {row.label}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.03em', marginTop: 2 }}>
                {row.note}
              </div>
            </div>
            <div style={{
              color: row.value.startsWith('+') ? '#4a7c59'
                   : row.value === '—' ? 'var(--text-muted)'
                   : 'var(--text-dark)',
              fontSize: 16,
              fontWeight: 300,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.01em',
              flexShrink: 0,
            }}>
              {row.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
