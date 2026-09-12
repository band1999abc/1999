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
        Clear:        { text: "Outside, it\u2019s sunny.",   cls: 'weather-sunny', category: 'sunny' },
        Clouds:       { text: "Outside, it\u2019s cloudy.",  cls: 'weather-cloudy', category: 'cloudy' },
        Rain:         { text: "Outside, it\u2019s raining.", cls: 'weather-rain', category: 'rainy' },
        Drizzle:      { text: "Outside, it\u2019s raining.", cls: 'weather-rain', category: 'rainy' },
        Thunderstorm: { text: "Outside, it\u2019s raining.", cls: 'weather-rain', category: 'rainy' },
        Squall:       { text: "Outside, it\u2019s raining.", cls: 'weather-rain', category: 'rainy' },
        Snow:         { text: "Outside, it\u2019s snowing.", cls: 'weather-snow', category: 'snowy' },
        Mist:         { text: "There\u2019s fog outside.",   cls: 'weather-foggy', category: 'foggy' },
        Fog:          { text: "There\u2019s fog outside.",   cls: 'weather-foggy', category: 'foggy' },
        Haze:         { text: "There\u2019s fog outside.",   cls: 'weather-foggy', category: 'foggy' },
        Smoke:        { text: "There\u2019s fog outside.",   cls: 'weather-foggy', category: 'foggy' },
        Dust:         { text: "There\u2019s fog outside.",   cls: 'weather-foggy', category: 'foggy' },
        Sand:         { text: "There\u2019s fog outside.",   cls: 'weather-foggy', category: 'foggy' },
        Ash:          { text: "There\u2019s fog outside.",   cls: 'weather-foggy', category: 'foggy' },
        Tornado:      { text: "Outside, it\u2019s raining.", cls: 'weather-rain', category: 'rainy' },
    };
    const WEATHER_CATEGORIES = [
        'sunny',
        'partly_cloudy',
        'mostly_cloudy',
        'cloudy',
        'rainy',
        'snowy',
        'foggy',
    ];

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

    function readWeatherPhrases(payload) {
        let records = [];
        if (Array.isArray(payload)) {
            records = payload;
        } else if (payload && Array.isArray(payload.phrases)) {
            records = payload.phrases;
        } else if (payload && Array.isArray(payload.data)) {
            records = payload.data;
        } else if (payload && payload.data && Array.isArray(payload.data.phrases)) {
            records = payload.data.phrases;
        }

        const phrases = {};
        WEATHER_CATEGORIES.forEach(function (category) {
            phrases[category] = [];
        });

        records.forEach(function (phrase) {
            if (!phrase || WEATHER_CATEGORIES.indexOf(phrase.category) < 0) return;
            const enabled = phrase.enabled === true || phrase.enabled === 1 || phrase.enabled === 'true';
            if (!enabled || typeof phrase.text !== 'string' || !phrase.text.trim()) return;
            phrases[phrase.category].push(phrase.text.trim());
        });
        return phrases;
    }

    function fetchWeatherPhrases() {
        return fetch('/api/weather-phrases')
            .then(function (r) {
                if (!r.ok) throw new Error('weather phrases request failed');
                return r.json();
            })
            .then(readWeatherPhrases)
            .catch(function () {
                // Phrase management is optional for the public page.
                return {};
            });
    }

    function phraseFor(category, phrases) {
        const choices = phrases && Array.isArray(phrases[category]) ? phrases[category] : null;
        if (!choices || !choices.length) return null;
        const storageKey = 'weatherPhrase:' + category;
        try {
            const selected = sessionStorage.getItem(storageKey);
            if (selected && choices.indexOf(selected) >= 0) return selected;
            const next = choices[Math.floor(Math.random() * choices.length)];
            sessionStorage.setItem(storageKey, next);
            return next;
        } catch {
            return choices[Math.floor(Math.random() * choices.length)];
        }
    }

    function cloudDisplay(clouds) {
        if (clouds <= 30) {
            return { text: "Outside, it\u2019s sunny.", cls: 'weather-sunny', condition: 'Clear', category: 'sunny' };
        }
        if (clouds <= 60) {
            return { text: "Outside, it\u2019s partly cloudy.", cls: 'weather-sunny', condition: 'Clear', category: 'partly_cloudy' };
        }
        if (clouds <= 80) {
            return { text: "Outside, it\u2019s mostly cloudy.", cls: 'weather-cloudy', condition: 'Clouds', category: 'mostly_cloudy' };
        }
        return { text: "Outside, it\u2019s cloudy.", cls: 'weather-cloudy', condition: 'Clouds', category: 'cloudy' };
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
    function applyWeather(condition, temp, clouds, phrases) {
        const validClouds = typeof clouds === 'number' && isFinite(clouds) && clouds >= 0 && clouds <= 100;
        const cloudInfo = (condition === 'Clear' || condition === 'Clouds') && validClouds
            ? cloudDisplay(clouds)
            : null;
        const info = cloudInfo || CONDITIONS[condition];
        if (!info) { dispatchWeatherReady(null, null); return; }

        document.body.classList.add(info.cls);
        setWeatherText(phraseFor(info.category, phrases) || info.text);
        dispatchWeatherReady(cloudInfo ? cloudInfo.condition : condition, temp);

        if (info.cls === 'weather-rain') startParticles('rain');
        if (info.cls === 'weather-snow') startParticles('snow');
    }

    /* ── Entry point (guarded against duplicate calls) ──────────── */
    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        // Dev override: ?weather=Clear|Clouds|Rain|Snow|Mist
        // Clouds can include a display-test value: ?weather=Clouds&clouds=50
        const debugParam = new URLSearchParams(window.location.search).get('weather');
        if (debugParam) {
            const debugCloudsRaw = new URLSearchParams(window.location.search).get('clouds');
            const debugClouds = debugCloudsRaw !== null && debugCloudsRaw.trim() !== ''
                ? Number(debugCloudsRaw)
                : null;
            fetchWeatherPhrases().then(function (phrases) {
                applyWeather(debugParam, null, debugClouds, phrases);
            });
            return;
        }

        // Show gentle loading text while API resolves
        setWeatherText('Checking today\u2019s sky\u2026');

        const t0 = performance.now();
        const weatherRequest = fetch('/api/weather')
            .then(function (r) { return r.json(); });
        Promise.all([weatherRequest, fetchWeatherPhrases()])
            .then(function (results) {
                const data = results[0];
                const phrases = results[1];
                const ms = Math.round(performance.now() - t0);
                console.log('[weather] fetch: ' + ms + 'ms  condition: ' + (data && data.condition));
                if (data && data.condition) {
                    applyWeather(
                        data.condition,
                        data.temp != null ? data.temp : null,
                        data.clouds != null ? data.clouds : null,
                        phrases
                    );
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
