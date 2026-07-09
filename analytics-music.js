/**
 * analytics-music.js — Music Analytics panel  v2
 *
 * Self-registers with window._AA_PANELS.music.
 * Receives raw analytics events from analytics-overview.js.
 *
 * Panels: Overview → track list (sortable) → track detail
 *   Detail: cumulative/daily chart + comparison + milestones +
 *           release impact + track insights
 * List footer: achievements + list-level insights
 */
;(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────

    var S = {
        events:    [],
        firstDate: null,
        lives:     [],
        diaries:   [],
        tracks:    [],
        track:     null,       // selected track name
        cmpTrack:  null,       // comparison track name
        period:    'all',      // '7d' | '30d' | '90d' | 'all'
        mode:      'cumulative', // 'cumulative' | 'daily'
        sort:      'plays',    // 'plays' | 'release' | 'alpha'
    };

    // ── Date helpers ──────────────────────────────────────────────────────────

    var JST_MS = 9 * 3600 * 1000;

    function todayJST()      { return new Date(Date.now() + JST_MS).toISOString().slice(0, 10); }
    function addDays(d, n)   { var dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
    function evDate(e)       { return new Date(new Date(e.ts).getTime() + JST_MS).toISOString().slice(0, 10); }
    function weekStartJST()  { var dow = new Date(Date.now() + JST_MS).getUTCDay(); return addDays(todayJST(), -(dow === 0 ? 6 : dow - 1)); }
    function fmtDate(d)      { if (!d) return '—'; var p = d.split('-'); return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日'; }

    // ── Formatting ────────────────────────────────────────────────────────────

    function fmtN(n)  { return n === 0 ? '0' : Number(n).toLocaleString('ja-JP'); }
    function fmtSt(n) { return n > 0 ? fmtN(n) : '—'; }
    function esc(s)   {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ── Track aggregation ─────────────────────────────────────────────────────

    function getMusicPlays(events) {
        return events.filter(function (e) { return e.event === 'music_play'; });
    }

    function getTrackName(e) {
        return (e.props && typeof e.props.track === 'string' && e.props.track.trim())
            ? e.props.track.trim() : '(不明)';
    }

    /**
     * Build full track objects from all events.
     * Computes: total, today, week, month, listeners, retRate,
     *           firstPlay, lastPlay, milestones, releaseImpact, stabilityRate
     */
    function aggregateTracks(events) {
        var plays = getMusicPlays(events).slice().sort(function (a, b) {
            return a.ts < b.ts ? -1 : 1;
        });

        var today = todayJST(), ws = weekStartJST(), ms = today.slice(0, 8) + '01';
        var map = Object.create(null);

        for (var i = 0; i < plays.length; i++) {
            var e = plays[i], nm = getTrackName(e), d = evDate(e);
            if (!map[nm]) map[nm] = {
                total: 0, today: 0, week: 0, month: 0,
                firstPlay: d, lastPlay: d,
                vis: Object.create(null),
                plays: [],
            };
            var t = map[nm];
            t.total++;
            if (d === today) t.today++;
            if (d >= ws)     t.week++;
            if (d >= ms)     t.month++;
            if (!t.vis[e.visitor_id]) t.vis[e.visitor_id] = Object.create(null);
            t.vis[e.visitor_id][e.session_id] = 1;
            if (d < t.firstPlay) t.firstPlay = d;
            if (d > t.lastPlay)  t.lastPlay  = d;
            t.plays.push(e);
        }

        return Object.keys(map).map(function (nm) {
            var t = map[nm];

            // Returning: visitors with 2+ distinct sessions
            var visKeys = Object.keys(t.vis);
            var returning = visKeys.filter(function (v) {
                return Object.keys(t.vis[v]).length >= 2;
            }).length;
            var retRate = visKeys.length ? Math.round(returning / visKeys.length * 100) : 0;

            // Milestones: date of N-th play
            var milestones = {};
            [100, 500, 1000, 5000, 10000].forEach(function (n) {
                milestones[n] = t.plays[n - 1] ? evDate(t.plays[n - 1]) : null;
            });

            // Release impact (within N ms of first play)
            var firstTs = new Date(t.plays[0].ts).getTime();
            function impact(ms2) {
                var w = t.plays.filter(function (e) {
                    return new Date(e.ts).getTime() - firstTs <= ms2;
                });
                return {
                    plays:     w.length,
                    listeners: Object.keys(w.reduce(function (acc, e) {
                        acc[e.visitor_id] = 1; return acc;
                    }, Object.create(null))).length,
                };
            }
            var releaseImpact = {
                h24: impact(86400000),
                d7:  impact(7  * 86400000),
                d30: impact(30 * 86400000),
            };

            // Stability: plays after day 30 / total
            var after30 = t.plays.filter(function (e) {
                return new Date(e.ts).getTime() - firstTs > 30 * 86400000;
            }).length;
            var stabilityRate = t.total ? Math.round(after30 / t.total * 100) : 0;

            return {
                name: nm, total: t.total, today: t.today, week: t.week, month: t.month,
                listeners: visKeys.length, retRate: retRate,
                firstPlay: t.firstPlay, lastPlay: t.lastPlay,
                milestones: milestones, releaseImpact: releaseImpact,
                stabilityRate: stabilityRate,
                plays: t.plays,
            };
        }).sort(function (a, b) { return b.total - a.total; });
    }

    /** Build day-by-day play counts for one track over [startDate, today] */
    function dailyCounts(events, name, startDate) {
        var today = todayJST();
        var plays = getMusicPlays(events).filter(function (e) {
            return getTrackName(e) === name;
        });
        var mapD = Object.create(null);
        plays.forEach(function (e) {
            var d = evDate(e);
            if (d >= startDate && d <= today) mapD[d] = (mapD[d] || 0) + 1;
        });
        var result = [], cur = startDate;
        while (cur <= today) {
            result.push({ date: cur, count: mapD[cur] || 0 });
            cur = addDays(cur, 1);
        }
        return result;
    }

    // ── Period helpers ────────────────────────────────────────────────────────

    function periodStart(period, firstPlay) {
        var today = todayJST();
        if (period === '7d')  return addDays(today, -6);
        if (period === '30d') return addDays(today, -29);
        if (period === '90d') return addDays(today, -89);
        return firstPlay || today;
    }

    // ── SVG chart ─────────────────────────────────────────────────────────────
    // Supports up to 2 series (for comparison mode)

    var VW = 440, VH = 180;
    var PL = 44, PR = 8, PT = 14, PB = 38;
    var PW = VW - PL - PR, PH = VH - PT - PB;

    function mkSvg(tag, attrs) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (attrs) for (var k in attrs)
            if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
        return el;
    }

    function niceTicks(maxV) {
        if (maxV <= 0) return [0, 1];
        var cands = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
        var raw  = maxV / 4;
        var step = cands.filter(function (s) { return s >= raw; })[0] || cands[cands.length - 1];
        var ticks = [];
        for (var v = 0; v <= maxV * 1.15; v += step) { ticks.push(v); if (ticks.length > 6) break; }
        return ticks;
    }

    function fmtTick(v) {
        if (v >= 10000) return Math.round(v / 1000) + 'k';
        if (v >= 1000)  return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(v);
    }

    /**
     * @param {Array}  series  — [{ data:[{date,count}], cls:'am-chart-line'|'am-chart-line-2' }]
     * @param {string} mode    — 'cumulative' | 'daily'
     * @param {Array}  liveMrk — [{date}]
     * @param {Array}  diaryMrk— [{date}]
     */
    function drawChart(series, mode, liveMrk, diaryMrk) {
        var svg = document.getElementById('am-chart');
        if (!svg) return;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        var n = series.length ? series[0].data.length : 0;
        if (!n) { _chartEmpty(svg, '再生データなし'); return; }

        // Gradient def (primary series area fill)
        var defs = mkSvg('defs');
        var grad = mkSvg('linearGradient', { id: 'am-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
        grad.appendChild(mkSvg('stop', { offset: '0%',   class: 'am-grad-top' }));
        grad.appendChild(mkSvg('stop', { offset: '100%', class: 'am-grad-bot' }));
        defs.appendChild(grad); svg.appendChild(defs);

        // Compute values per series
        var allVals = series.map(function (s) {
            var cum = 0;
            return mode === 'cumulative'
                ? s.data.map(function (d) { cum += d.count; return cum; })
                : s.data.map(function (d) { return d.count; });
        });

        var maxY = 1;
        allVals.forEach(function (vals) { vals.forEach(function (v) { if (v > maxY) maxY = v; }); });
        var dates = series[0].data.map(function (d) { return d.date; });

        function xAt(i) { return PL + (n <= 1 ? PW / 2 : (i / (n - 1)) * PW); }
        function yAt(v) { return PT + PH - (v / maxY) * PH; }

        // Background rect
        svg.appendChild(mkSvg('rect', { x: PL, y: PT, width: PW, height: PH, class: 'am-chart-bg' }));

        // Grid + Y labels
        niceTicks(maxY).forEach(function (tv) {
            var ty = yAt(tv);
            svg.appendChild(mkSvg('line', { x1: PL, y1: ty, x2: PL + PW, y2: ty, class: 'am-chart-grid' }));
            var yt = mkSvg('text', {
                x: PL - 6, y: ty, class: 'am-chart-axis',
                'text-anchor': 'end', 'dominant-baseline': 'middle',
            });
            yt.textContent = fmtTick(tv);
            svg.appendChild(yt);
        });

        // X-axis labels
        var xStep = n <= 7 ? 1 : n <= 31 ? 7 : n <= 91 ? 14 : Math.ceil(n / 6);
        var lastIdx = -Infinity;
        for (var xi = 0; xi < n; xi += xStep) {
            var xt = mkSvg('text', { x: xAt(xi), y: PT + PH + 16, class: 'am-chart-axis', 'text-anchor': 'middle' });
            xt.textContent = dates[xi].slice(5);
            svg.appendChild(xt); lastIdx = xi;
        }
        if (lastIdx < n - 1) {
            var xl = mkSvg('text', { x: xAt(n - 1), y: PT + PH + 16, class: 'am-chart-axis', 'text-anchor': 'middle' });
            xl.textContent = dates[n - 1].slice(5);
            svg.appendChild(xl);
        }

        // Event markers (diary behind live)
        diaryMrk.forEach(function (d) {
            var idx = dates.indexOf(d.date); if (idx < 0) return;
            svg.appendChild(mkSvg('line', { x1: xAt(idx), y1: PT, x2: xAt(idx), y2: PT + PH, class: 'am-marker-diary' }));
        });
        liveMrk.forEach(function (l) {
            var idx = dates.indexOf(l.date); if (idx < 0) return;
            svg.appendChild(mkSvg('line', { x1: xAt(idx), y1: PT, x2: xAt(idx), y2: PT + PH, class: 'am-marker-live' }));
        });

        // Draw each series
        series.forEach(function (s, si) {
            var vals   = allVals[si];
            var isCmp  = series.length > 1;
            var lineCls = si === 0 ? 'am-chart-line' : 'am-chart-line-2';

            if (n > 1) {
                // Area fill
                var pts = [PL + ',' + (PT + PH)];
                vals.forEach(function (v, i) { pts.push(xAt(i) + ',' + yAt(v)); });
                pts.push(xAt(n - 1) + ',' + (PT + PH));
                svg.appendChild(mkSvg('polygon', {
                    points: pts.join(' '),
                    class:  si === 0 ? 'am-chart-area' : '',
                    fill:   si === 0 ? (isCmp ? 'url(#am-grad)' : 'url(#am-grad)')
                                     : 'rgba(91,138,170,0.08)',
                    'fill-opacity': si === 0 && isCmp ? '0.6' : '1',
                }));

                // Line
                svg.appendChild(mkSvg('polyline', {
                    points: vals.map(function (v, i) { return xAt(i) + ',' + yAt(v); }).join(' '),
                    class: lineCls, fill: 'none',
                }));
            }

            // Dots (sparse data)
            if (n <= 60) {
                vals.forEach(function (v, i) {
                    if (mode === 'daily' && v === 0) return;
                    svg.appendChild(mkSvg('circle', {
                        cx: xAt(i), cy: yAt(v), r: 2.5,
                        class: si === 0 ? 'am-chart-dot' : 'am-chart-dot-2',
                    }));
                });
            }
        });
    }

    function _chartEmpty(svg, msg) {
        var t = mkSvg('text', {
            x: VW / 2, y: VH / 2, class: 'am-chart-axis',
            'text-anchor': 'middle', 'dominant-baseline': 'middle',
        });
        t.textContent = msg; svg.appendChild(t);
    }

    // ── Overview (top of list view) ───────────────────────────────────────────

    function renderOverview() {
        var el = document.getElementById('am-overview');
        if (!el) return;
        var all  = getMusicPlays(S.events);
        var totalPlays = all.length;
        var uniq = Object.keys(all.reduce(function (a, e) { a[e.visitor_id] = 1; return a; }, {})).length;
        el.innerHTML =
            ovCard('▶',  fmtN(totalPlays),    '総再生数') +
            ovCard('👤', fmtN(uniq),           'ユニークリスナー') +
            ovCard('💿', fmtN(S.tracks.length), '楽曲数');
    }

    function ovCard(icon, val, label) {
        return '<div class="am-ov-card">'
             + '<span class="am-ov-icon">' + icon + '</span>'
             + '<div class="am-ov-val">' + esc(val) + '</div>'
             + '<div class="am-ov-lbl">' + esc(label) + '</div></div>';
    }

    // ── Track list ────────────────────────────────────────────────────────────

    function sortedTracks() {
        var t = S.tracks.slice();
        if (S.sort === 'release') t.sort(function (a, b) { return a.firstPlay.localeCompare(b.firstPlay); });
        else if (S.sort === 'alpha') t.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
        return t; // default 'plays': already sorted by total desc
    }

    function renderList() {
        var tracks = sortedTracks();
        var cntEl  = document.getElementById('am-list-count');
        if (cntEl) cntEl.textContent = tracks.length + ' tracks';

        document.querySelectorAll('.am-sort-btn').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset.sort === S.sort);
        });

        var el = document.getElementById('am-tracks');
        if (!el) return;

        if (!tracks.length) {
            el.innerHTML = '<p class="aa-empty" style="padding-top:16px">まだ再生データがありません</p>';
            return;
        }

        var h = '<div class="am-track-list">';
        tracks.forEach(function (t) {
            h += '<div class="am-track-row" data-track="' + esc(t.name) + '">'
               + '<div class="am-track-name">' + esc(t.name) + '</div>'
               + '<div class="am-track-stat am-track-stat--main">' + fmtN(t.total) + '</div>'
               + '<div class="am-track-stat">' + fmtSt(t.week) + '</div>'
               + '<div class="am-track-stat">' + fmtN(t.listeners) + '</div>'
               + '<div class="am-track-stat">' + (t.retRate ? t.retRate + '%' : '—') + '</div>'
               + '</div>';
        });
        h += '</div>';
        el.innerHTML = h;

        el.querySelectorAll('.am-track-row').forEach(function (row) {
            row.addEventListener('click', function () { selectTrack(row.dataset.track); });
        });
    }

    // ── List-level: achievements + insights ───────────────────────────────────

    function renderAchievements() {
        var el = document.getElementById('am-achievements');
        if (!el || !S.tracks.length) { if (el) el.innerHTML = ''; return; }

        var byPlays  = S.tracks[0];
        var byLoyal  = S.tracks.slice().sort(function (a, b) { return b.retRate - a.retRate; })[0];
        var byGrowth = S.tracks.slice()
            .filter(function (t) { return t.month > 0; })
            .sort(function (a, b) { return (b.month / Math.max(1, b.total)) - (a.month / Math.max(1, a.total)); })[0];

        var items = [
            { icon: '🏆', label: '最多再生',       track: byPlays.name,  val: fmtN(byPlays.total) + ' Plays' },
            byLoyal  && byLoyal.retRate  >= 20 ? { icon: '❤️',  label: 'リピーター率 No.1', track: byLoyal.name,  val: byLoyal.retRate + '% Returning' }  : null,
            byGrowth                           ? { icon: '🚀',  label: '今月最も伸びた曲',  track: byGrowth.name, val: fmtN(byGrowth.month) + ' 今月再生' } : null,
        ].filter(Boolean);

        el.innerHTML = '<div class="am-sec-title">Achievements</div>'
            + '<div class="am-ach-row">'
            + items.map(function (it) {
                return '<div class="am-ach-card">'
                     + '<span class="am-ach-icon">' + it.icon + '</span>'
                     + '<div class="am-ach-label">' + esc(it.label) + '</div>'
                     + '<div class="am-ach-track">' + esc(it.track) + '</div>'
                     + '<div class="am-ach-val">'   + esc(it.val)   + '</div>'
                     + '</div>';
            }).join('')
            + '</div>';
    }

    function renderListInsights() {
        var el = document.getElementById('am-list-insights');
        if (!el || !S.tracks.length) { if (el) el.innerHTML = ''; return; }

        var ins = [];

        var top = S.tracks[0];
        ins.push({ icon: '🎵', text: '「' + top.name + '」が最も多く再生されています（' + fmtN(top.total) + '回）。' });

        var sustained = S.tracks.filter(function (t) { return t.stabilityRate >= 50 && t.total >= 20; });
        if (sustained.length)
            ins.push({ icon: '📈', text: '「' + sustained[0].name + '」は公開30日以降も安定して再生されています。' });

        var loyal = S.tracks.slice().sort(function (a, b) { return b.retRate - a.retRate; })[0];
        if (loyal && loyal.retRate >= 30)
            ins.push({ icon: '❤️', text: '「' + loyal.name + '」はリピーターが多く（Returning ' + loyal.retRate + '%）、ファンに継続的に愛されています。' });

        el.innerHTML = '<div class="am-sec-title">Insights</div>'
            + '<ul class="am-ins-list">'
            + ins.slice(0, 3).map(function (it) {
                return '<li class="am-ins-item">'
                     + '<span class="am-ins-icon">' + it.icon + '</span>'
                     + '<span class="am-ins-text">' + esc(it.text) + '</span></li>';
            }).join('')
            + '</ul>';
    }

    // ── Detail view ───────────────────────────────────────────────────────────

    function selectTrack(name) {
        S.track = name; S.period = 'all'; S.mode = 'cumulative'; S.cmpTrack = null;
        document.getElementById('am-list').hidden   = true;
        document.getElementById('am-detail').hidden = false;
        hideCmpPicker();
        renderDetail();
    }

    function renderDetail() {
        var name  = S.track;
        var track = S.tracks.find(function (t) { return t.name === name; });
        if (!track) return;

        // Hero
        var titleEl = document.getElementById('am-track-title');
        var metaEl  = document.getElementById('am-track-meta');
        if (titleEl) titleEl.textContent = name;
        if (metaEl)  metaEl.textContent  =
            fmtN(track.total) + ' plays total  ·  初回再生 ' + track.firstPlay;

        // Key stats
        renderKVStats(track);

        // Sync button states
        syncBtns('.am-toggle-btn', 'mode',   S.mode);
        syncBtns('.am-period-btn', 'period', S.period);

        // Compare controls
        var cmpLabel = document.getElementById('am-cmp-label');
        var cmpClear = document.getElementById('am-cmp-clear');
        if (cmpLabel) cmpLabel.textContent = S.cmpTrack ? 'vs「' + S.cmpTrack + '」' : '';
        if (cmpClear) cmpClear.hidden = !S.cmpTrack;

        // Compute chart series
        var fp1   = track.firstPlay;
        var start = periodStart(S.period, fp1);
        if (start < fp1) start = fp1;

        var series = [{ data: dailyCounts(S.events, name, start), cls: 'am-chart-line' }];
        var effectiveStart = start;  // actual chart start (updated below for comparison)

        if (S.cmpTrack) {
            var cmpObj = S.tracks.find(function (t) { return t.name === S.cmpTrack; });
            if (cmpObj) {
                var fp2 = cmpObj.firstPlay;
                var unifiedStart = fp1 < fp2 ? fp1 : fp2;
                var clampedStart = periodStart(S.period, unifiedStart);
                if (clampedStart < unifiedStart) clampedStart = unifiedStart;
                effectiveStart = clampedStart;
                series[0].data = dailyCounts(S.events, name, clampedStart);
                series.push({ data: dailyCounts(S.events, S.cmpTrack, clampedStart), cls: 'am-chart-line-2' });
            }
        }

        var today    = todayJST();
        var liveMrk  = S.lives.filter(function (l) { return l.date >= effectiveStart && l.date <= today; });
        var diaryMrk = S.diaries.filter(function (d) { return d.date >= effectiveStart && d.date <= today; });

        drawChart(series, S.mode, liveMrk, diaryMrk);
        renderLegend(liveMrk, diaryMrk);

        // Additional sections
        renderMilestones(track);
        renderReleaseImpact(track);
        renderTrackInsights(track);
        renderComparison(track);
    }

    function renderKVStats(track) {
        var el = document.getElementById('am-detail-stats');
        if (!el) return;
        var stats = [
            { val: fmtN(track.total),     lbl: '累計再生数' },
            { val: fmtSt(track.today),    lbl: '今日' },
            { val: fmtSt(track.week),     lbl: '今週' },
            { val: fmtSt(track.month),    lbl: '今月' },
            { val: fmtN(track.listeners), lbl: 'ユニークリスナー' },
            { val: track.retRate ? track.retRate + '%' : '—', lbl: 'Returning 率' },
        ];
        el.innerHTML = '<div class="am-kv-grid">'
            + stats.map(function (s) {
                return '<div class="am-kv-card">'
                     + '<div class="am-kv-val">' + esc(s.val) + '</div>'
                     + '<div class="am-kv-lbl">' + esc(s.lbl) + '</div></div>';
            }).join('')
            + '</div>';
    }

    function renderMilestones(track) {
        var el = document.getElementById('am-milestones');
        if (!el) return;
        var ms = track.milestones;
        el.innerHTML = '<div class="am-sec-title">Milestones</div>'
            + '<div class="am-ms-strip">'
            + [100, 500, 1000, 5000, 10000].map(function (n) {
                var dt   = ms[n] || null;
                var done = !!dt;
                return '<div class="am-ms-badge' + (done ? ' am-ms-badge--done' : '') + '">'
                     + '<div class="am-ms-count">' + fmtN(n) + '</div>'
                     + '<div class="am-ms-unit">Plays</div>'
                     + '<div class="am-ms-date">' + (dt ? fmtDate(dt) : 'まだ') + '</div>'
                     + '</div>';
            }).join('')
            + '</div>';
    }

    function renderReleaseImpact(track) {
        var el = document.getElementById('am-release-impact');
        if (!el) return;
        var ri = track.releaseImpact;
        el.innerHTML = '<div class="am-sec-title">Release Impact</div>'
            + '<div class="am-ri-strip">'
            + [['h24', '公開24時間'], ['d7', '公開7日'], ['d30', '公開30日']].map(function (w) {
                var d = ri[w[0]] || {};
                return '<div class="am-ri-block">'
                     + '<div class="am-ri-period">' + w[1] + '</div>'
                     + '<div class="am-ri-plays">'  + fmtN(d.plays) + '<small>再生</small></div>'
                     + '<div class="am-ri-lst">'    + fmtN(d.listeners) + '<small>リスナー</small></div>'
                     + '</div>';
            }).join('')
            + '</div>';
    }

    function renderTrackInsights(track) {
        var el = document.getElementById('am-track-insights');
        if (!el) return;
        var ins = [];

        if (track.stabilityRate >= 50 && track.total >= 20)
            ins.push('公開30日以降も安定して再生されています（継続再生率 ' + track.stabilityRate + '%）。');

        if (track.retRate >= 40)
            ins.push('リピーターが多く（Returning ' + track.retRate + '%）、ファンに継続的に愛されています。');

        if (track.releaseImpact.h24.plays >= 10)
            ins.push('公開24時間で ' + fmtN(track.releaseImpact.h24.plays) + ' 回再生され、リリース時のインパクトが大きかった曲です。');

        var spikeCount = S.lives.filter(function (l) {
            var next = addDays(l.date, 1);
            return track.plays.filter(function (e) { return evDate(e) === next; }).length >= 3;
        }).length;
        if (spikeCount > 0)
            ins.push('ライブ翌日に再生数が伸びています。');

        if (!ins.length) { el.innerHTML = ''; return; }

        el.innerHTML = '<div class="am-sec-title">Insights</div>'
            + '<ul class="am-ins-list">'
            + ins.map(function (text) {
                return '<li class="am-ins-item">'
                     + '<span class="am-ins-icon">💡</span>'
                     + '<span class="am-ins-text">' + esc(text) + '</span></li>';
            }).join('')
            + '</ul>';
    }

    function renderComparison(track) {
        var el = document.getElementById('am-comparison');
        if (!el) return;
        if (!S.cmpTrack) { el.innerHTML = ''; return; }

        var cmp = S.tracks.find(function (t) { return t.name === S.cmpTrack; });
        if (!cmp) { el.innerHTML = ''; return; }

        function row(label, v1, v2) {
            var n1 = parseFloat(String(v1).replace(/[^0-9.]/g, '')) || 0;
            var n2 = parseFloat(String(v2).replace(/[^0-9.]/g, '')) || 0;
            var best = n1 >= n2 ? 'left' : 'right';
            return '<div class="am-cmp-tbl-row">'
                 + '<div class="am-cmp-v' + (best === 'left'  ? ' am-cmp-v--best' : '') + '">' + esc(v1) + '</div>'
                 + '<div class="am-cmp-lbl2">' + esc(label) + '</div>'
                 + '<div class="am-cmp-v' + (best === 'right' ? ' am-cmp-v--best' : '') + '">' + esc(v2) + '</div>'
                 + '</div>';
        }

        el.innerHTML = '<div class="am-sec-title">Comparison</div>'
            + '<div class="am-cmp-heads">'
            + '<span class="am-cmp-head am-cmp-head--1">' + esc(track.name) + '</span>'
            + '<span class="am-cmp-vs">vs</span>'
            + '<span class="am-cmp-head am-cmp-head--2">' + esc(cmp.name) + '</span>'
            + '</div>'
            + '<div class="am-cmp-tbl">'
            + row('累計再生数',        fmtN(track.total),                         fmtN(cmp.total))
            + row('ユニークリスナー',  fmtN(track.listeners),                     fmtN(cmp.listeners))
            + row('Returning 率',      track.retRate + '%',                        cmp.retRate + '%')
            + row('公開30日 再生数',   fmtN(track.releaseImpact.d30.plays),       fmtN(cmp.releaseImpact.d30.plays))
            + row('今週 再生数',       fmtSt(track.week),                         fmtSt(cmp.week))
            + '</div>';
    }

    // ── Compare picker ────────────────────────────────────────────────────────

    function showCmpPicker() {
        var el = document.getElementById('am-cmp-picker');
        if (!el) return;
        var others = S.tracks.filter(function (t) { return t.name !== S.track; });
        if (!others.length) {
            el.innerHTML = '<p class="aa-empty" style="padding:8px 0">他の楽曲がありません</p>';
            el.hidden = false; return;
        }
        el.innerHTML = '<div class="am-cmp-picker-list">'
            + others.map(function (t) {
                var active = t.name === S.cmpTrack ? ' is-active' : '';
                return '<button class="am-cmp-picker-row' + active + '" data-cmp-track="' + esc(t.name) + '" type="button">'
                     + esc(t.name) + '<span class="am-cmp-picker-stat">' + fmtN(t.total) + ' plays</span></button>';
            }).join('')
            + '</div>';
        el.hidden = false;
    }

    function hideCmpPicker() {
        var el = document.getElementById('am-cmp-picker');
        if (el) { el.hidden = true; el.innerHTML = ''; }
    }

    // ── Legend ────────────────────────────────────────────────────────────────

    function renderLegend(lives, diaries) {
        var el = document.getElementById('am-legend');
        if (!el) return;
        var h = '';
        if (S.cmpTrack) {
            h += '<span class="am-legend-item"><span class="am-legend-dot am-legend-dot--1"></span>'
               + '<span class="am-legend-label">' + esc(S.track) + '</span></span>';
            h += '<span class="am-legend-item"><span class="am-legend-dot am-legend-dot--2"></span>'
               + '<span class="am-legend-label">' + esc(S.cmpTrack) + '</span></span>';
        }
        if (lives.length)
            h += '<span class="am-legend-item"><svg class="am-legend-sw" viewBox="0 0 24 10"><line x1="0" y1="5" x2="24" y2="5" class="am-marker-live"/></svg>'
               + '<span class="am-legend-label">Live (' + lives.length + ')</span></span>';
        if (diaries.length)
            h += '<span class="am-legend-item"><svg class="am-legend-sw" viewBox="0 0 24 10"><line x1="0" y1="5" x2="24" y2="5" class="am-marker-diary"/></svg>'
               + '<span class="am-legend-label">Diary (' + diaries.length + ')</span></span>';
        el.innerHTML = h;
    }

    // ── Controls ──────────────────────────────────────────────────────────────

    function syncBtns(sel, dataProp, val) {
        document.querySelectorAll(sel).forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset[dataProp] === val);
        });
    }

    var _ctrlsReady = false;
    function initControls() {
        if (_ctrlsReady) return;
        _ctrlsReady = true;

        // Back to list
        var back = document.getElementById('am-back');
        if (back) back.addEventListener('click', function () {
            S.track = null; S.cmpTrack = null;
            document.getElementById('am-list').hidden   = false;
            document.getElementById('am-detail').hidden = true;
        });

        // Mode toggle
        document.querySelectorAll('.am-toggle-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { S.mode = btn.dataset.mode; renderDetail(); });
        });

        // Period buttons
        document.querySelectorAll('.am-period-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { S.period = btn.dataset.period; renderDetail(); });
        });

        // Sort buttons (delegated from bar)
        // Release Impact → button: navigate to Release panel from Music list
        var relBtn = document.getElementById('am-release-btn');
        if (relBtn) relBtn.addEventListener('click', function () {
            if (window._AA_showPanel) window._AA_showPanel('release');
        });

        var sortBar = document.getElementById('am-sort-bar');
        if (sortBar) sortBar.addEventListener('click', function (e) {
            var btn = e.target.closest('.am-sort-btn');
            if (btn) { S.sort = btn.dataset.sort; renderList(); }
        });

        // Compare toggle button
        var cmpBtn = document.getElementById('am-cmp-btn');
        if (cmpBtn) cmpBtn.addEventListener('click', function () {
            var picker = document.getElementById('am-cmp-picker');
            if (picker && !picker.hidden) hideCmpPicker();
            else showCmpPicker();
        });

        // Compare picker (delegated)
        var cmpPicker = document.getElementById('am-cmp-picker');
        if (cmpPicker) cmpPicker.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-cmp-track]');
            if (!btn) return;
            S.cmpTrack = btn.dataset.cmpTrack;
            hideCmpPicker();
            renderDetail();
        });

        // Clear comparison
        var cmpClear = document.getElementById('am-cmp-clear');
        if (cmpClear) cmpClear.addEventListener('click', function () {
            S.cmpTrack = null;
            hideCmpPicker();
            renderDetail();
        });
    }

    // ── Meta (live + diary for event markers) ─────────────────────────────────

    var _metaLoaded = false;
    function loadMeta(cb) {
        if (_metaLoaded) { cb(); return; }
        var auth = window._adminAuthFetch;
        if (!auth) { cb(); return; }
        Promise.all([
            auth('/api/live').then(function (r) { return r.json(); }).catch(function () { return []; }),
            auth('/api/diary').then(function (r) { return r.json(); }).catch(function () { return []; }),
        ]).then(function (res) {
            S.lives = (Array.isArray(res[0]) ? res[0] : [])
                .filter(function (l) { return l.date; })
                .map(function (l) { return { date: l.date.slice(0, 10), label: l.venue || 'Live' }; })
                .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            S.diaries = (Array.isArray(res[1]) ? res[1] : [])
                .filter(function (d) { return d.date; })
                .map(function (d) { return { date: d.date.slice(0, 10), label: d.title || 'Diary' }; })
                .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            _metaLoaded = true; cb();
        });
    }

    // ── Public entry point ────────────────────────────────────────────────────

    function render(events, firstDate) {
        S.events    = Array.isArray(events) ? events : [];
        S.firstDate = firstDate;
        S.tracks    = aggregateTracks(S.events);

        initControls();

        // Always start at list view when panel is (re-)opened
        S.track = null; S.cmpTrack = null;
        var listEl   = document.getElementById('am-list');
        var detailEl = document.getElementById('am-detail');
        if (listEl)   listEl.hidden   = false;
        if (detailEl) detailEl.hidden = true;

        renderOverview();
        renderList();
        renderAchievements();
        renderListInsights();

        loadMeta(function () { if (S.track) renderDetail(); });
    }

    // ── Register with panel loader registry ───────────────────────────────────

    if (window._AA_PANELS) window._AA_PANELS.music = render;

}());
