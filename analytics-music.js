/**
 * analytics-music.js — Music Analytics panel  v1
 *
 * Self-registers with the analytics panel loader registry exposed by
 * analytics-overview.js as window._AA_PANELS.
 *
 * Panels: track list → track detail (cumulative/daily chart + event markers)
 */
;(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────

    var S = {
        events:    [],
        firstDate: null,
        lives:     [],      // [{ date, label }] — from /api/live
        diaries:   [],      // [{ date, label }] — from /api/diary
        tracks:    [],      // aggregated track objects
        track:     null,    // selected track name (null = list view)
        period:    'all',   // '7d' | '30d' | '90d' | 'all'
        mode:      'cumulative', // 'cumulative' | 'daily'
    };

    // ── Date helpers ──────────────────────────────────────────────────────────

    var JST_MS = 9 * 3600 * 1000;

    function todayJST() {
        return new Date(Date.now() + JST_MS).toISOString().slice(0, 10);
    }

    function addDays(dateStr, n) {
        var d = new Date(dateStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }

    /** Extract JST date string from an event's UTC timestamp */
    function evDate(e) {
        return new Date(new Date(e.ts).getTime() + JST_MS).toISOString().slice(0, 10);
    }

    // ── Formatting ────────────────────────────────────────────────────────────

    function fmtN(n)   { return n === 0 ? '0' : Number(n).toLocaleString('ja-JP'); }
    function fmtSt(n)  { return n > 0 ? fmtN(n) : '—'; }
    function esc(s)    {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Period helpers ────────────────────────────────────────────────────────

    function periodStart(period, firstPlay) {
        var today = todayJST();
        if (period === '7d')  return addDays(today, -6);
        if (period === '30d') return addDays(today, -29);
        if (period === '90d') return addDays(today, -89);
        return firstPlay || today;
    }

    function weekStartJST() {
        var dow = new Date(Date.now() + JST_MS).getUTCDay(); // 0=Sun
        return addDays(todayJST(), -(dow === 0 ? 6 : dow - 1));
    }

    // ── Track data ────────────────────────────────────────────────────────────

    function getMusicPlays(events) {
        return events.filter(function (e) { return e.event === 'music_play'; });
    }

    function getTrackName(e) {
        return (e.props && typeof e.props.track === 'string' && e.props.track.trim())
            ? e.props.track.trim()
            : '(不明)';
    }

    /** Aggregate all events → array of track objects, sorted by total desc */
    function aggregateTracks(events) {
        var plays = getMusicPlays(events);
        var today = todayJST();
        var ws    = weekStartJST();
        var ms    = today.slice(0, 8) + '01';

        var map = Object.create(null);
        for (var i = 0; i < plays.length; i++) {
            var e  = plays[i];
            var nm = getTrackName(e);
            var d  = evDate(e);
            if (!map[nm]) {
                map[nm] = { total: 0, today: 0, week: 0, month: 0,
                            vis: Object.create(null), firstPlay: d };
            }
            var t = map[nm];
            t.total++;
            if (d === today) t.today++;
            if (d >= ws)     t.week++;
            if (d >= ms)     t.month++;
            t.vis[e.visitor_id] = 1;
            if (d < t.firstPlay) t.firstPlay = d;
        }

        return Object.keys(map).map(function (nm) {
            var t = map[nm];
            return {
                name:      nm,
                total:     t.total,
                today:     t.today,
                week:      t.week,
                month:     t.month,
                listeners: Object.keys(t.vis).length,
                firstPlay: t.firstPlay,
            };
        }).sort(function (a, b) { return b.total - a.total; });
    }

    /** Build day-by-day play counts for one track over [startDate, today] */
    function dailyCounts(events, name, startDate) {
        var today = todayJST();
        var plays = getMusicPlays(events).filter(function (e) {
            return getTrackName(e) === name;
        });
        var map = Object.create(null);
        for (var i = 0; i < plays.length; i++) {
            var d = evDate(plays[i]);
            if (d >= startDate && d <= today) map[d] = (map[d] || 0) + 1;
        }
        var result = [], cur = startDate;
        while (cur <= today) {
            result.push({ date: cur, count: map[cur] || 0 });
            cur = addDays(cur, 1);
        }
        return result;
    }

    // ── SVG chart ─────────────────────────────────────────────────────────────

    // ViewBox dimensions and plot area margins
    var VW = 440, VH = 180;
    var PL = 44, PR = 8, PT = 14, PB = 38;
    var PW = VW - PL - PR;
    var PH = VH - PT - PB;

    function mkSvg(tag, attrs) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (attrs) {
            for (var k in attrs) {
                if (Object.prototype.hasOwnProperty.call(attrs, k)) {
                    el.setAttribute(k, attrs[k]);
                }
            }
        }
        return el;
    }

    /** Choose nice round tick values that span 0 → maxV */
    function niceTicks(maxV) {
        if (maxV <= 0) return [0, 1];
        var candidates = [1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,20000,50000];
        var raw  = maxV / 4;
        var step = candidates.filter(function (s) { return s >= raw; })[0]
                   || candidates[candidates.length - 1];
        var ticks = [];
        for (var v = 0; v <= maxV * 1.15; v += step) {
            ticks.push(v);
            if (ticks.length > 6) break;
        }
        return ticks;
    }

    function fmtTick(v) {
        if (v >= 10000) return Math.round(v / 1000) + 'k';
        if (v >= 1000)  return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(v);
    }

    function drawChart(daily, mode, liveMarkers, diaryMarkers) {
        var svg = document.getElementById('am-chart');
        if (!svg) return;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        var n = daily.length;
        if (n === 0) { _chartEmpty(svg, '再生データなし'); return; }

        // ── Gradient definition ───────────────────────────────────────────
        var defs = mkSvg('defs');
        var grad = mkSvg('linearGradient', { id: 'am-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
        grad.appendChild(mkSvg('stop', { offset: '0%',   class: 'am-grad-top' }));
        grad.appendChild(mkSvg('stop', { offset: '100%', class: 'am-grad-bot' }));
        defs.appendChild(grad);
        svg.appendChild(defs);

        // ── Compute series ────────────────────────────────────────────────
        var values, cum = 0;
        if (mode === 'cumulative') {
            values = daily.map(function (d) { cum += d.count; return cum; });
        } else {
            values = daily.map(function (d) { return d.count; });
        }
        var maxY = Math.max.apply(null, values);
        if (maxY === 0) maxY = 1;

        var dates = daily.map(function (d) { return d.date; });

        // Coordinate helpers
        function xAt(i) {
            return PL + (n <= 1 ? PW / 2 : (i / (n - 1)) * PW);
        }
        function yAt(v) {
            return PT + PH - (v / maxY) * PH;
        }

        // ── Background rect ───────────────────────────────────────────────
        svg.appendChild(mkSvg('rect', {
            x: PL, y: PT, width: PW, height: PH, class: 'am-chart-bg',
        }));

        // ── Y-axis grid + labels ──────────────────────────────────────────
        var ticks = niceTicks(maxY);
        for (var ti = 0; ti < ticks.length; ti++) {
            var tv = ticks[ti], ty = yAt(tv);
            svg.appendChild(mkSvg('line', {
                x1: PL, y1: ty, x2: PL + PW, y2: ty, class: 'am-chart-grid',
            }));
            var yt = mkSvg('text', {
                x: PL - 6, y: ty, class: 'am-chart-axis',
                'text-anchor': 'end', 'dominant-baseline': 'middle',
            });
            yt.textContent = fmtTick(tv);
            svg.appendChild(yt);
        }

        // ── X-axis date labels ────────────────────────────────────────────
        var xStep = n <= 7 ? 1 : n <= 31 ? 7 : n <= 91 ? 14 : Math.ceil(n / 6);
        var lastLabelIdx = -Infinity;
        for (var xi = 0; xi < n; xi += xStep) {
            var xt = mkSvg('text', {
                x: xAt(xi), y: PT + PH + 16, class: 'am-chart-axis', 'text-anchor': 'middle',
            });
            xt.textContent = dates[xi].slice(5); // MM-DD
            svg.appendChild(xt);
            lastLabelIdx = xi;
        }
        // Always show the last date label if it wasn't already shown
        if (lastLabelIdx < n - 1) {
            var xLast = mkSvg('text', {
                x: xAt(n - 1), y: PT + PH + 16, class: 'am-chart-axis', 'text-anchor': 'middle',
            });
            xLast.textContent = dates[n - 1].slice(5);
            svg.appendChild(xLast);
        }

        // ── Event markers (Diary — dashed, behind Live) ───────────────────
        for (var di = 0; di < diaryMarkers.length; di++) {
            var didx = dates.indexOf(diaryMarkers[di].date);
            if (didx < 0) continue;
            svg.appendChild(mkSvg('line', {
                x1: xAt(didx), y1: PT, x2: xAt(didx), y2: PT + PH,
                class: 'am-marker-diary',
            }));
        }

        // ── Event markers (Live — solid) ──────────────────────────────────
        for (var li = 0; li < liveMarkers.length; li++) {
            var lidx = dates.indexOf(liveMarkers[li].date);
            if (lidx < 0) continue;
            svg.appendChild(mkSvg('line', {
                x1: xAt(lidx), y1: PT, x2: xAt(lidx), y2: PT + PH,
                class: 'am-marker-live',
            }));
        }

        // ── Area fill (gradient polygon) ──────────────────────────────────
        if (n > 1) {
            var aptParts = [PL + ',' + (PT + PH)];
            for (var ai = 0; ai < n; ai++) {
                aptParts.push(xAt(ai) + ',' + yAt(values[ai]));
            }
            aptParts.push(xAt(n - 1) + ',' + (PT + PH));
            svg.appendChild(mkSvg('polygon', {
                points: aptParts.join(' '),
                class:  'am-chart-area',
                fill:   'url(#am-grad)',
            }));
        }

        // ── Data line ─────────────────────────────────────────────────────
        if (n > 1) {
            var linePts = values.map(function (v, i) {
                return xAt(i) + ',' + yAt(v);
            }).join(' ');
            svg.appendChild(mkSvg('polyline', {
                points: linePts, class: 'am-chart-line', fill: 'none',
            }));
        }

        // ── Dots (shown when sparse) ──────────────────────────────────────
        if (n <= 60) {
            for (var pi = 0; pi < n; pi++) {
                if (mode === 'daily' && values[pi] === 0) continue;
                svg.appendChild(mkSvg('circle', {
                    cx: xAt(pi), cy: yAt(values[pi]), r: 2.5, class: 'am-chart-dot',
                }));
            }
        }
    }

    function _chartEmpty(svg, msg) {
        var t = mkSvg('text', {
            x: VW / 2, y: VH / 2, class: 'am-chart-axis',
            'text-anchor': 'middle', 'dominant-baseline': 'middle',
        });
        t.textContent = msg;
        svg.appendChild(t);
    }

    // ── Track list ────────────────────────────────────────────────────────────

    function renderList() {
        var el    = document.getElementById('am-tracks');
        var cntEl = document.getElementById('am-list-count');
        if (!el) return;

        var tracks = S.tracks;
        if (cntEl) cntEl.textContent = tracks.length + ' tracks';

        if (!tracks.length) {
            el.innerHTML = '<p class="aa-empty" style="padding-top:16px">まだ再生データがありません</p>';
            return;
        }

        var h = '<div class="am-track-list">';
        for (var i = 0; i < tracks.length; i++) {
            var t = tracks[i];
            h += '<div class="am-track-row" data-track="' + esc(t.name) + '">'
               + '<div class="am-track-name">' + esc(t.name) + '</div>'
               + '<div class="am-track-stat am-track-stat--main">' + fmtN(t.total) + '</div>'
               + '<div class="am-track-stat">' + fmtSt(t.today) + '</div>'
               + '<div class="am-track-stat">' + fmtSt(t.week) + '</div>'
               + '<div class="am-track-stat">' + fmtSt(t.month) + '</div>'
               + '<div class="am-track-stat">' + fmtN(t.listeners) + '</div>'
               + '</div>';
        }
        h += '</div>';
        el.innerHTML = h;

        el.querySelectorAll('.am-track-row').forEach(function (row) {
            row.addEventListener('click', function () {
                selectTrack(row.dataset.track);
            });
        });
    }

    // ── Detail view ───────────────────────────────────────────────────────────

    function selectTrack(name) {
        S.track  = name;
        S.period = 'all';
        S.mode   = 'cumulative';
        document.getElementById('am-list').hidden   = true;
        document.getElementById('am-detail').hidden = false;
        renderDetail();
    }

    function renderDetail() {
        var name   = S.track;
        var events = S.events;

        // Collect plays for this track
        var plays = getMusicPlays(events).filter(function (e) {
            return getTrackName(e) === name;
        });
        var fp    = plays.reduce(function (min, e) {
            var d = evDate(e);
            return d < min ? d : min;
        }, todayJST());
        var total = plays.length;

        // Period start (clamped to first play date)
        var start = periodStart(S.period, fp);
        if (start < fp) start = fp;

        // Update hero
        var titleEl = document.getElementById('am-track-title');
        var metaEl  = document.getElementById('am-track-meta');
        if (titleEl) titleEl.textContent = name;
        if (metaEl)  metaEl.textContent  =
            fmtN(total) + ' plays total  ·  初回再生 ' + fp;

        // Sync button states
        syncBtns('.am-toggle-btn', 'mode',   S.mode);
        syncBtns('.am-period-btn', 'period', S.period);

        // Build chart data
        var daily    = dailyCounts(events, name, start);
        var today    = todayJST();
        var liveMrk  = S.lives.filter(function (l) {
            return l.date >= start && l.date <= today;
        });
        var diaryMrk = S.diaries.filter(function (d) {
            return d.date >= start && d.date <= today;
        });

        drawChart(daily, S.mode, liveMrk, diaryMrk);
        renderLegend(liveMrk, diaryMrk);
        renderPeriodStats(plays, start);
    }

    function syncBtns(selector, dataProp, val) {
        document.querySelectorAll(selector).forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset[dataProp] === val);
        });
    }

    function renderLegend(lives, diaries) {
        var el = document.getElementById('am-legend');
        if (!el) return;
        var h = '';
        if (lives.length) {
            h += '<span class="am-legend-item">'
               + '<svg class="am-legend-sw" viewBox="0 0 24 10">'
               + '<line x1="0" y1="5" x2="24" y2="5" class="am-marker-live"/></svg>'
               + '<span class="am-legend-label">Live (' + lives.length + ')</span>'
               + '</span>';
        }
        if (diaries.length) {
            h += '<span class="am-legend-item">'
               + '<svg class="am-legend-sw" viewBox="0 0 24 10">'
               + '<line x1="0" y1="5" x2="24" y2="5" class="am-marker-diary"/></svg>'
               + '<span class="am-legend-label">Diary (' + diaries.length + ')</span>'
               + '</span>';
        }
        el.innerHTML = h;
    }

    function renderPeriodStats(plays, startDate) {
        var el = document.getElementById('am-detail-stats');
        if (!el) return;
        var today = todayJST();
        var inPeriod = plays.filter(function (e) {
            var d = evDate(e);
            return d >= startDate && d <= today;
        });
        var vis = Object.create(null);
        inPeriod.forEach(function (e) { vis[e.visitor_id] = 1; });
        el.innerHTML =
            '<div class="am-stat">'
          + '<div class="am-stat-val">' + fmtN(inPeriod.length) + '</div>'
          + '<div class="am-stat-lab">この期間の再生数</div>'
          + '</div>'
          + '<div class="am-stat">'
          + '<div class="am-stat-val">' + fmtN(Object.keys(vis).length) + '</div>'
          + '<div class="am-stat-lab">ユニークリスナー</div>'
          + '</div>';
    }

    // ── Meta fetch (live + diary for event markers) ───────────────────────────

    var _metaLoaded = false;

    function loadMeta(cb) {
        if (_metaLoaded) { cb(); return; }
        var auth = window._adminAuthFetch;
        if (!auth) { cb(); return; }

        Promise.all([
            auth('/api/live').then(function (r) { return r.json(); }).catch(function () { return []; }),
            auth('/api/diary').then(function (r) { return r.json(); }).catch(function () { return []; }),
        ]).then(function (results) {
            var rawLives   = Array.isArray(results[0]) ? results[0] : [];
            var rawDiaries = Array.isArray(results[1]) ? results[1] : [];

            S.lives = rawLives
                .filter(function (l) { return l.date; })
                .map(function (l) { return { date: l.date, label: l.venue || 'Live' }; })
                .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

            S.diaries = rawDiaries
                .filter(function (d) { return d.date; })
                .map(function (d) { return { date: d.date, label: d.title || 'Diary' }; })
                .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

            _metaLoaded = true;
            cb();
        });
    }

    // ── Controls ──────────────────────────────────────────────────────────────

    var _ctrlsReady = false;

    function initControls() {
        if (_ctrlsReady) return;
        _ctrlsReady = true;

        // Back to list
        var back = document.getElementById('am-back');
        if (back) {
            back.addEventListener('click', function () {
                S.track = null;
                document.getElementById('am-list').hidden   = false;
                document.getElementById('am-detail').hidden = true;
            });
        }

        // Mode toggle (cumulative / daily)
        document.querySelectorAll('.am-toggle-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                S.mode = btn.dataset.mode;
                renderDetail();
            });
        });

        // Period buttons
        document.querySelectorAll('.am-period-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                S.period = btn.dataset.period;
                renderDetail();
            });
        });
    }

    // ── Public entry point (called from PANEL_LOADERS) ────────────────────────

    function render(events, firstDate) {
        S.events    = Array.isArray(events) ? events : [];
        S.firstDate = firstDate;
        S.tracks    = aggregateTracks(S.events);

        initControls();

        // Always start at list view when panel is opened
        S.track = null;
        var listEl   = document.getElementById('am-list');
        var detailEl = document.getElementById('am-detail');
        if (listEl)   listEl.hidden   = false;
        if (detailEl) detailEl.hidden = true;

        renderList();

        // Load live/diary for event markers (non-blocking — re-renders detail if needed)
        loadMeta(function () {
            if (S.track) renderDetail();
        });
    }

    // ── Register with panel loader registry ───────────────────────────────────

    if (window._AA_PANELS) {
        window._AA_PANELS.music = render;
    }

}());
