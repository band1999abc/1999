/**
 * weather.js
 * Requests geolocation once, fetches current weather from /api/weather,
 * then applies a subtle body class and optional canvas animation.
 * All effects are silent-fallback: denied or failed → no change.
 */
(function () {
  'use strict';

  /* ── Condition map ──────────────────────────────────────────── */
  const CONDITIONS = {
    Clear:        { text: "Outside, it\u2019s sunny.",  cls: 'weather-sunny'  },
    Clouds:       { text: "Outside, it\u2019s cloudy.", cls: 'weather-cloudy' },
    Rain:         { text: "Outside, it\u2019s raining.", cls: 'weather-rain'  },
    Drizzle:      { text: "Outside, it\u2019s raining.", cls: 'weather-rain'  },
    Thunderstorm: { text: "Outside, it\u2019s raining.", cls: 'weather-rain'  },
    Squall:       { text: "Outside, it\u2019s raining.", cls: 'weather-rain'  },
    Snow:         { text: "Outside, it\u2019s snowing.", cls: 'weather-snow'  },
    Mist:         { text: "Outside, it\u2019s foggy.",  cls: 'weather-foggy' },
    Fog:          { text: "Outside, it\u2019s foggy.",  cls: 'weather-foggy' },
    Haze:         { text: "Outside, it\u2019s foggy.",  cls: 'weather-foggy' },
    Smoke:        { text: "Outside, it\u2019s foggy.",  cls: 'weather-foggy' },
    Dust:         { text: "Outside, it\u2019s foggy.",  cls: 'weather-foggy' },
    Sand:         { text: "Outside, it\u2019s foggy.",  cls: 'weather-foggy' },
    Ash:          { text: "Outside, it\u2019s foggy.",  cls: 'weather-foggy' },
    Tornado:      { text: "Outside, it\u2019s raining.", cls: 'weather-rain' },
  };

  /* ── Apply weather to DOM ───────────────────────────────────── */
  function applyWeather(condition) {
    const info = CONDITIONS[condition];
    if (!info) return;

    document.body.classList.add(info.cls);

    const el = document.getElementById('weather-text');
    if (el) {
      el.textContent = info.text;
      // Double rAF ensures transition fires after paint
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.classList.add('visible');
        });
      });
    }

    if (info.cls === 'weather-rain') startRain();
    if (info.cls === 'weather-snow') startSnow();
  }

  /* ── Rain canvas ────────────────────────────────────────────── */
  function startRain() {
    var canvas = document.getElementById('weather-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var raf;

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    var drops = [];
    for (var i = 0; i < 45; i++) {
      drops.push({
        x:       Math.random() * canvas.width,
        y:       Math.random() * canvas.height,
        len:     Math.random() * 14 + 8,
        speed:   Math.random() * 2  + 1.5,
        opacity: Math.random() * 0.11 + 0.03,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var j = 0; j < drops.length; j++) {
        var d = drops[j];
        ctx.strokeStyle = 'rgba(170,180,200,' + d.opacity + ')';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * 0.25, d.y + d.len);
        ctx.stroke();
        d.y += d.speed;
        d.x += d.speed * 0.2;
        if (d.y > canvas.height) {
          d.y = -d.len;
          d.x = Math.random() * canvas.width;
        }
      }
      raf = requestAnimationFrame(draw);
    }

    canvas.style.display = 'block';
    draw();
  }

  /* ── Snow canvas ────────────────────────────────────────────── */
  function startSnow() {
    var canvas = document.getElementById('weather-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var raf;

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    var flakes = [];
    for (var i = 0; i < 18; i++) {
      flakes.push({
        x:       Math.random() * canvas.width,
        y:       Math.random() * canvas.height,
        r:       Math.random() * 2 + 1,
        speed:   Math.random() * 0.6 + 0.2,
        drift:   (Math.random() - 0.5) * 0.4,
        opacity: Math.random() * 0.35 + 0.15,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var j = 0; j < flakes.length; j++) {
        var f = flakes[j];
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220,230,240,' + f.opacity + ')';
        ctx.fill();
        f.y += f.speed;
        f.x += f.drift;
        if (f.y > canvas.height + f.r) {
          f.y = -f.r;
          f.x = Math.random() * canvas.width;
        }
      }
      raf = requestAnimationFrame(draw);
    }

    canvas.style.display = 'block';
    draw();
  }

  /* ── Entry point (guarded against duplicate calls) ─────────── */
  var _initialized = false;
  function init() {
    if (_initialized) return;
    _initialized = true;

    // Dev-only: ?weather=Clear|Clouds|Rain|Snow|Mist forces a condition locally
    var debugParam = new URLSearchParams(window.location.search).get('weather');
    if (debugParam) { applyWeather(debugParam); return; }

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude;
        var lon = pos.coords.longitude;
        fetch('/api/weather?lat=' + lat + '&lon=' + lon)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.condition) applyWeather(data.condition);
          })
          .catch(function () {}); // silent fallback on network error
      },
      function () {},            // denied → no effect
      { timeout: 8000 }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
