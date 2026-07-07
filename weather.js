/**
 * weather.js
 * Fetches current weather from /api/weather (server-side IP geolocation).
 * No browser Geolocation API needed — zero permission dialogs.
 * All effects are silent-fallback: failed fetch or unknown condition → no change.
 */
(function () {
    'use strict';

    /* ── Condition map ──────────────────────────────────────────── */
    const CONDITIONS = {
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

    /* ── Cached DOM reference ───────────────────────────────────── */
    const weatherTextEl = document.getElementById('weather-text');

    /* ── Weather text: fade in or crossfade ─────────────────────── */
    function setWeatherText(text) {
        if (!weatherTextEl) return;

        if (!weatherTextEl.classList.contains('visible')) {
            weatherTextEl.textContent = text;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    weatherTextEl.classList.add('visible');
                });
            });
        } else {
            // Already visible — crossfade: out → swap → in
            weatherTextEl.classList.remove('visible');
            setTimeout(function () {
                weatherTextEl.textContent = text;
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        weatherTextEl.classList.add('visible');
                    });
                });
            }, 450); // slightly longer than the 0.4s CSS transition
        }
    }

    /* ── Dispatch event for script.js to pick up ────────────────── */
    function dispatchWeatherReady(condition, temp) {
        window.dispatchEvent(new CustomEvent('weatherReady', {
            detail: { condition: condition, temp: temp },
        }));
    }

    /* ── Shared canvas particle engine ──────────────────────────── */
    function startParticles(type) {
        const canvas = document.getElementById('weather-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        function resize() {
            canvas.width  = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize, { passive: true });

        // Build particle array depending on type
        const particles = [];
        if (type === 'rain') {
            for (let i = 0; i < 55; i++) {
                particles.push({
                    x:       Math.random() * canvas.width,
                    y:       Math.random() * canvas.height,
                    len:     Math.random() * 18 + 10,
                    speed:   Math.random() * 3  + 2,
                    opacity: Math.random() * 0.30 + 0.18,
                });
            }
        } else {
            // snow
            for (let i = 0; i < 25; i++) {
                particles.push({
                    x:       Math.random() * canvas.width,
                    y:       Math.random() * canvas.height,
                    r:       Math.random() * 3 + 1.5,
                    speed:   Math.random() * 0.8 + 0.3,
                    drift:   (Math.random() - 0.5) * 0.5,
                    opacity: Math.random() * 0.40 + 0.25,
                });
            }
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            for (let j = 0; j < particles.length; j++) {
                const p = particles[j];

                if (type === 'rain') {
                    ctx.strokeStyle = 'rgba(150,170,205,' + p.opacity + ')';
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x + p.len * 0.28, p.y + p.len);
                    ctx.stroke();
                    p.y += p.speed;
                    p.x += p.speed * 0.22;
                    if (p.y > canvas.height) {
                        p.y = -p.len;
                        p.x = Math.random() * canvas.width;
                    }
                } else {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(210,225,245,' + p.opacity + ')';
                    ctx.fill();
                    p.y += p.speed;
                    p.x += p.drift;
                    if (p.y > canvas.height + p.r) {
                        p.y = -p.r;
                        p.x = Math.random() * canvas.width;
                    }
                }
            }

            requestAnimationFrame(draw);
        }

        canvas.style.display = 'block';
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                canvas.style.opacity = '1'; // triggers CSS 0.5s fade-in
            });
        });
        draw();
    }

    /* ── Apply weather to DOM ───────────────────────────────────── */
    function applyWeather(condition, temp) {
        const info = CONDITIONS[condition];
        if (!info) { dispatchWeatherReady(null, null); return; }

        document.body.classList.add(info.cls);
        setWeatherText(info.text);
        dispatchWeatherReady(condition, temp);

        if (info.cls === 'weather-rain') startParticles('rain');
        if (info.cls === 'weather-snow') startParticles('snow');
    }

    /* ── Entry point (guarded against duplicate calls) ──────────── */
    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        // Dev override: ?weather=Clear|Clouds|Rain|Snow|Mist
        const debugParam = new URLSearchParams(window.location.search).get('weather');
        if (debugParam) { applyWeather(debugParam, null); return; }

        // Show gentle loading text while API resolves
        setWeatherText('Checking today\u2019s sky\u2026');

        const t0 = performance.now();
        fetch('/api/weather')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                const ms = Math.round(performance.now() - t0);
                console.log('[weather] fetch: ' + ms + 'ms  condition: ' + (data && data.condition));
                if (data && data.condition) {
                    applyWeather(data.condition, data.temp != null ? data.temp : null);
                } else {
                    if (weatherTextEl) weatherTextEl.classList.remove('visible');
                    dispatchWeatherReady(null, null);
                }
            })
            .catch(function () {
                if (weatherTextEl) weatherTextEl.classList.remove('visible');
                dispatchWeatherReady(null, null);
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
