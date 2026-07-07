export function ShipporiMincho() {
  return <FontCard
    fontName="Shippori Mincho B1 — 静かな明朝体"
    titleStyle={{ fontFamily: '"Shippori Mincho B1", "Shippori Mincho", serif', fontWeight: 700, letterSpacing: '0.04em' }}
  />;
}

function FontCard({ fontName, titleStyle }: { fontName: string; titleStyle: React.CSSProperties }) {
  const navItems = ['Music', 'Live', 'Diary', 'Members', 'Contact'];
  return (
    <div style={{ minHeight: '100vh', background: '#e8e3d9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '380px', background: '#f7f2ea', borderRadius: '28px', padding: '36px 32px 28px', boxShadow: '0 2px 24px rgba(0,0,0,0.06)', position: 'relative', overflow: 'hidden' }}>
        <img src="/__mockup/images/whale.png" alt="" style={{ position: 'absolute', right: '-10px', top: '80px', width: '260px', opacity: 0.09, pointerEvents: 'none', userSelect: 'none' }} />

        <h1 style={{ ...titleStyle, fontSize: '64px', margin: '0 0 32px', color: '#111', lineHeight: 1 }}>1999</h1>

        <p style={{ fontSize: '13px', color: '#999', textAlign: 'center', margin: '0 0 8px', letterSpacing: '0.03em' }}>Take a break.</p>
        <p style={{ fontSize: '15px', color: '#555', textAlign: 'center', margin: '0 0 32px', letterSpacing: '0.04em' }}>もう少しで終わりますね。</p>

        <nav style={{ marginTop: '12px' }}>
          {navItems.map((item) => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 0', borderBottom: '1px solid #e2ddd4', color: '#444', fontSize: '15px', letterSpacing: '0.02em' }}>
              {item}
            </div>
          ))}
        </nav>

        <p style={{ marginTop: '20px', fontSize: '11px', color: '#bbb', letterSpacing: '0.04em', textAlign: 'center' }}>{fontName}</p>
      </div>
    </div>
  );
}
