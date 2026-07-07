/**
 * weather.js
 * Fetches current weather from /api/weather (server-side IP geolocation).
 * No browser Geolocation API needed — zero permission dialogs, fast.
 * All effects are silent-fallback: failed fetch or unknown condition → no change.
 *
 * Timing is logged to the browser console:
 *   [weather] fetch: Xms  condition: Y
 */
(function () {
  'use strict';

  /* ── Condition map ──────────────────────────────────────────── */
  var CONDITIONS = {
    Clear:        { text: "Outside, it\u2019s sunny.",   cls: 'weather-sunny'  },
    Clouds:       { text: "Outside, it\u2019s cloudy.",  cls: 'weather-cloudy' },
    Rain:         { text: "Outside, it\u2019s raining.", cls: 'weather-rain'   },
    Drizzle:      { text: "Outside, it\u2019s raining.", cls: 'weather-rain'   },
    Thunderstorm: { text: "Outside, it\u2019s raining.", cls: 'weather-rain'   },
    Squall:       { text: "Outside, it\u2019s raining.", cls: 'weather-rain'   },
    Snow:         { text: "Outside, it\u2019s snowing.", cls: 'weather-snow'   },
    Mist:         { text: "Outside, it\u2019s foggy.",   cls: 'weather-foggy'  },
    Fog:          { text: "Outside, it\u2019s foggy.",   cls: 'weather-foggy'  },
    Haze:         { text: "Outside, it\u2019s foggy.",   cls: 'weather-foggy'  },
    Smoke:        { text: "Outside, it\u2019s foggy.",   cls: 'weather-foggy'  },
    Dust:         { text: "Outside, it\u2019s foggy.",   cls: 'weather-foggy'  },
    Sand:         { text: "Outside, it\u2019s foggy.",   cls: 'weather-foggy'  },
    Ash:          { text: "Outside, it\u2019s foggy.",   cls: 'weather-foggy'  },
    Tornado:      { text: "Outside, it\u2019s raining.", cls: 'weather-rain'   },
  };

  /* ── Weather text: fade-in or crossfade ────────────────────── */
  function setWeatherText(text) {
    var el = document.getElementById('weather-text');
    if (!el) { console.log('[weather] #weather-text not found in DOM'); return; }

    if (!el.classList.contains('visible')) {
      // Not yet shown — set text and fade in directly
      el.textContent = text;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.classList.add('visible');
        });
      });
    } else {
      // Already visible (loading text) — crossfade: out → swap → in
      el.classList.remove('visible');
      setTimeout(function () {
        el.textContent = text;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            el.classList.add('visible');
          });
        });
      }, 450); // slightly longer than the 0.4s CSS transition
    }
  }

  /* ── Apply weather to DOM ───────────────────────────────────── */
  function dispatchWeatherReady(condition, temp) {
    window.dispatchEvent(new CustomEvent('weatherReady', { detail: { condition: condition, temp: temp } }));
  }

  function applyWeather(condition, temp) {
    console.log('[weather] applyWeather: condition=' + JSON.stringify(condition) + ' temp=' + temp);
    var info = CONDITIONS[condition];
    console.log('[weather] matched cls: ' + (info ? info.cls : 'NO MATCH — skipping'));
    if (!info) { dispatchWeatherReady(null, null); return; }

    document.body.classList.add(info.cls);
    console.log('[weather] body.className:', document.body.className);

    setWeatherText(info.text);
    dispatchWeatherReady(condition, temp);

    if (info.cls === 'weather-rain') { console.log('[weather] → startRain()'); startRain(); }
    if (info.cls === 'weather-snow') { console.log('[weather] → startSnow()'); startSnow(); }
  }

  /* ── Rain canvas ────────────────────────────────────────────── */
  function startRain() {
    var canvas = document.getElementById('weather-canvas');
    console.log('[weather] startRain: canvas=' + (canvas ? 'found' : 'NOT FOUND'));
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    console.log('[weather] canvas buffer: ' + canvas.width + 'x' + canvas.height);
    window.addEventListener('resize', resize, { passive: true });

    var drops = [];
    for (var i = 0; i < 55; i++) {
      drops.push({
        x:       Math.random() * canvas.width,
        y:       Math.random() * canvas.height,
        len:     Math.random() * 18 + 10,
        speed:   Math.random() * 3  + 2,
        opacity: Math.random() * 0.30 + 0.18,
      });
    }

    var _firstDraw = true;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (_firstDraw) {
        console.log('[weather] rain draw() running, drops=' + drops.length);
        _firstDraw = false;
      }
      for (var j = 0; j < drops.length; j++) {
        var d = drops[j];
        ctx.strokeStyle = 'rgba(150,170,205,' + d.opacity + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * 0.28, d.y + d.len);
        ctx.stroke();
        d.y += d.speed;
        d.x += d.speed * 0.22;
        if (d.y > canvas.height) {
          d.y = -d.len;
          d.x = Math.random() * canvas.width;
        }
      }
      requestAnimationFrame(draw);
    }

    canvas.style.display = 'block';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        canvas.style.opacity = '1'; // triggers CSS 0.5s ease fade-in
      });
    });
    console.log('[weather] canvas.style.display set to block');
    draw();
  }

  /* ── Snow canvas ────────────────────────────────────────────── */
  function startSnow() {
    var canvas = document.getElementById('weather-canvas');
    console.log('[weather] startSnow: canvas=' + (canvas ? 'found' : 'NOT FOUND'));
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    console.log('[weather] canvas buffer: ' + canvas.width + 'x' + canvas.height);
    window.addEventListener('resize', resize, { passive: true });

    var flakes = [];
    for (var i = 0; i < 25; i++) {
      flakes.push({
        x:       Math.random() * canvas.width,
        y:       Math.random() * canvas.height,
        r:       Math.random() * 3 + 1.5,
        speed:   Math.random() * 0.8 + 0.3,
        drift:   (Math.random() - 0.5) * 0.5,
        opacity: Math.random() * 0.40 + 0.25,
      });
    }

    var _firstDraw = true;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (_firstDraw) {
        console.log('[weather] snow draw() running, flakes=' + flakes.length);
        _firstDraw = false;
      }
      for (var j = 0; j < flakes.length; j++) {
        var f = flakes[j];
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(210,225,245,' + f.opacity + ')';
        ctx.fill();
        f.y += f.speed;
        f.x += f.drift;
        if (f.y > canvas.height + f.r) {
          f.y = -f.r;
          f.x = Math.random() * canvas.width;
        }
      }
      requestAnimationFrame(draw);
    }

    canvas.style.display = 'block';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        canvas.style.opacity = '1'; // triggers CSS 0.5s ease fade-in
      });
    });
    console.log('[weather] canvas.style.display set to block');
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

    // Show gentle loading text immediately while the API resolves
    setWeatherText('Checking today\u2019s sky\u2026');

    // Fetch immediately — server resolves location from client IP.
    // No browser Geolocation needed: no permission dialog, no GPS wait.
    var t0 = performance.now();
    fetch('/api/weather')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var ms = Math.round(performance.now() - t0);
        console.log('[weather] fetch: ' + ms + 'ms  condition: ' + (data && data.condition));
        if (data && data.condition) {
          applyWeather(data.condition, data.temp != null ? data.temp : null);
        } else {
          // No condition returned — gently fade out the loading text
          var el = document.getElementById('weather-text');
          if (el) el.classList.remove('visible');
          dispatchWeatherReady(null, null);
        }
      })
      .catch(function () {
        var ms = Math.round(performance.now() - t0);
        console.log('[weather] fetch failed after ' + ms + 'ms');
        var el = document.getElementById('weather-text');
        if (el) el.classList.remove('visible');
        dispatchWeatherReady(null, null);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
