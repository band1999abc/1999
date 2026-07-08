/**
 * music-analytics.js — client renderer for /afterhours/music
 *
 * All sections are rendered client-side from the /api/music-analytics payload.
 * The SVG chart is hand-rolled (no external dependencies).
 */
(function () {
    'use strict';

    /* ── State ──────────────────────────────────────────────────── */
    var _data           = null;   // full API response
    var _selectedTrack  = null;   // currently expanded song
    var _compareTrack   = null;   // second song for comparison
    var _compareMode    = false;  // toggle
    var _period         = '30d';  // chart period: '7d' '30d' '90d' 'all'
    var _sort           = 'plays'; // 'plays' 'release' 'alpha'

    /* ── Utilities ──────────────────────────────────────────────── */
    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }
    function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('ja-JP'); }
    function fmtPct(n) { return n == null ? '—' : n + '%'; }
    function fmtDate(d) {
        if (!d) return '—';
        var s = d.length >= 16 && !d.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(d) ? d + 'Z' : d;
        var dt = new Date(s);
        if (isNaN(dt.getTime())) return d.slice(0, 10);
        var j = new Date(dt.getTime() + 9 * 3600000);
        return j.getUTCFullYear() + '年' + (j.getUTCMonth()+1) + '月' + j.getUTCDate() + '日';
    }
    function fmtShort(d) {
        if (!d) return '';
        var p = d.slice(0, 10).split('-');
        return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
    }
    function addDays(dStr, n) {
        var dt = new Date(dStr + 'T00:00:00Z');
        dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
    }
    function el(id) { return document.getElementById(id); }
    function on(root, sel, ev, fn) {
        root.addEventListener(ev, function (e) {
            var t = e.target.closest(sel);
            if (t && root.contains(t)) fn(e, t);
        });
    }

    /* ── Colour constants ───────────────────────────────────────── */
    var C1 = '#8a6a42';   // accent gold — song 1
    var C2 = '#5b8aaa';   // blue-slate  — song 2

    /* ── SVG Chart ──────────────────────────────────────────────── */

    /**
     * Render a cumulative line chart into `container`.
     * @param {Element} container
     * @param {{ dates:string[], cumulative:{[track]:number[]} }} chartData
     * @param {string[]} tracks  — up to 2 tracks to draw
     * @param {string} period    — '7d' | '30d' | '90d' | 'all'
     * @param {Array}  events    — timeline events [{ date, type, icon, title }]
     */
    function drawChart(container, chartData, tracks, period, events) {
        container.innerHTML = '';
        if (!chartData || !chartData.dates || !chartData.dates.length || !tracks.length) {
            container.innerHTML = '<p class="ma-chart-empty">データがありません。</p>';
            return;
        }

        var allDates  = chartData.dates;
        var today     = allDates[allDates.length - 1];
        var cutoff;
        if      (period === '7d')  cutoff = addDays(today, -6);
        else if (period === '30d') cutoff = addDays(today, -29);
        else if (period === '90d') cutoff = addDays(today, -89);
        else                       cutoff = allDates[0];

        var startIdx = 0;
        for (var i = 0; i < allDates.length; i++) { if (allDates[i] >= cutoff) { startIdx = i; break; } }
        var dates = allDates.slice(startIdx);
        if (!dates.length) { container.innerHTML = '<p class="ma-chart-empty">この期間のデータはありません。</p>'; return; }

        // Extract series (cumulative, shifted so first point of period = 0 for relative view)
        // Keep absolute cumulative values (spec says graph should never decrease)
        var series = tracks.map(function (t) {
            var raw = (chartData.cumulative[t] || []).slice(startIdx);
            // If first value > 0, keep as-is (absolute cumulative)
            return { track: t, values: raw };
        });

        var W = container.clientWidth || 320;
        var H = 200;
        var PL = 42, PR = 12, PT = 12, PB = 34;
        var cW = W - PL - PR, cH = H - PT - PB;

        var maxY = 1;
        series.forEach(function (s) { s.values.forEach(function (v) { if (v > maxY) maxY = v; }); });

        function px(idx)  { return PL + (dates.length > 1 ? idx / (dates.length - 1) * cW : cW / 2); }
        function py(val)  { return PT + cH - (val / maxY * cH); }

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', H);
        svg.style.overflow = 'visible';

        // Grid lines (5 levels)
        var gridLevels = 4;
        for (var g = 0; g <= gridLevels; g++) {
            var gVal = maxY * g / gridLevels;
            var gy   = py(gVal);
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', PL); line.setAttribute('x2', PL + cW);
            line.setAttribute('y1', gy); line.setAttribute('y2', gy);
            line.setAttribute('stroke', 'rgba(255,255,255,0.06)');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
            if (gVal > 0) {
                var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                txt.setAttribute('x', PL - 4); txt.setAttribute('y', gy + 4);
                txt.setAttribute('text-anchor', 'end');
                txt.setAttribute('font-size', '9');
                txt.setAttribute('fill', 'rgba(255,255,255,0.35)');
                txt.textContent = gVal >= 1000 ? (gVal / 1000).toFixed(1) + 'k' : Math.round(gVal);
                svg.appendChild(txt);
            }
        }

        // X-axis labels (show up to 6 dates)
        var labelStep = Math.max(1, Math.ceil(dates.length / 6));
        dates.forEach(function (d, idx) {
            if (idx % labelStep !== 0 && idx !== dates.length - 1) return;
            var xt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            xt.setAttribute('x', px(idx));
            xt.setAttribute('y', H - 6);
            xt.setAttribute('text-anchor', idx === 0 ? 'start' : idx === dates.length - 1 ? 'end' : 'middle');
            xt.setAttribute('font-size', '9');
            xt.setAttribute('fill', 'rgba(255,255,255,0.35)');
            xt.textContent = fmtShort(d);
            svg.appendChild(xt);
        });

        // Draw series (area fill + line)
        var colours = [C1, C2];
        series.forEach(function (s, si) {
            var col = colours[si];
            if (!s.values.length) return;

            var pts = s.values.map(function (v, idx) { return px(idx) + ',' + py(v); });
            var firstX = px(0), lastX = px(s.values.length - 1);
            var baseY  = PT + cH;

            // Area fill
            var areaPath = 'M ' + firstX + ' ' + baseY + ' L ' + pts.join(' L ') + ' L ' + lastX + ' ' + baseY + ' Z';
            var area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            area.setAttribute('d', areaPath);
            area.setAttribute('fill', col);
            area.setAttribute('fill-opacity', si === 0 ? '0.12' : '0.08');
            svg.appendChild(area);

            // Line
            var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', pts.join(' '));
            polyline.setAttribute('fill', 'none');
            polyline.setAttribute('stroke', col);
            polyline.setAttribute('stroke-width', '2');
            polyline.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(polyline);

            // End dot
            var lastV = s.values[s.values.length - 1];
            var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', px(s.values.length - 1));
            dot.setAttribute('cy', py(lastV));
            dot.setAttribute('r', '3.5');
            dot.setAttribute('fill', col);
            svg.appendChild(dot);
        });

        // Event markers (timeline events within date range)
        if (events && events.length) {
            events.forEach(function (ev) {
                var idx = dates.indexOf(ev.date);
                if (idx < 0) return;
                var mx = px(idx);
                var mline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                mline.setAttribute('x1', mx); mline.setAttribute('x2', mx);
                mline.setAttribute('y1', PT); mline.setAttribute('y2', PT + cH);
                mline.setAttribute('stroke', ev.type === 'release' ? C1 : 'rgba(255,255,255,0.25)');
                mline.setAttribute('stroke-width', '1');
                mline.setAttribute('stroke-dasharray', '3,3');
                svg.appendChild(mline);
                var mdot = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                mdot.setAttribute('x', mx);
                mdot.setAttribute('y', PT - 2);
                mdot.setAttribute('text-anchor', 'middle');
                mdot.setAttribute('font-size', '10');
                mdot.textContent = ev.icon;
                svg.appendChild(mdot);
            });
        }

        container.appendChild(svg);
    }

    /* ── Section renderers ──────────────────────────────────────── */

    function renderOverview(ov) {
        var items = [
            { label:'総楽曲数',         val: fmtNum(ov.totalSongs),       icon:'💿' },
            { label:'総再生数',          val: fmtNum(ov.totalPlays),       icon:'▶' },
            { label:'ユニークリスナー',  val: fmtNum(ov.uniqueListeners),  icon:'👤' },
            { label:'今日の再生数',      val: fmtNum(ov.playsToday),       icon:'📅' },
            { label:'今週の再生数',      val: fmtNum(ov.playsThisWeek),    icon:'📊' },
            { label:'今月の再生数',      val: fmtNum(ov.playsThisMonth),   icon:'📆' },
        ];
        return '<section class="ma-section" id="ma-overview">'
             + '<h2 class="ma-section-title">Overview</h2>'
             + '<div class="ma-stat-grid">'
             + items.map(function (it) {
                 return '<div class="ma-stat-card">'
                      + '<span class="ma-stat-icon">' + it.icon + '</span>'
                      + '<div class="ma-stat-value">' + esc(it.val) + '</div>'
                      + '<div class="ma-stat-label">' + esc(it.label) + '</div>'
                      + '</div>';
             }).join('')
             + '</div></section>';
    }

    function renderSongList(songs) {
        var sorted = songs.slice();
        if (_sort === 'plays')   sorted.sort(function (a, b) { return b.totalPlays - a.totalPlays; });
        if (_sort === 'release') sorted.sort(function (a, b) { return a.firstSeenDate.localeCompare(b.firstSeenDate); });
        if (_sort === 'alpha')   sorted.sort(function (a, b) { return a.track.localeCompare(b.track, 'ja'); });

        var sortBtns = ['plays','release','alpha'].map(function (s) {
            var labels = { plays:'人気順', release:'リリース順', alpha:'五十音順' };
            return '<button class="ma-sort-btn' + (_sort === s ? ' ma-sort-btn--active' : '') + '" data-sort="' + s + '">'
                 + labels[s] + '</button>';
        }).join('');

        var cards = sorted.map(function (s) {
            var isSelected = s.track === _selectedTrack;
            var isCmp      = s.track === _compareTrack;
            var cls = 'ma-song-card' + (isSelected ? ' ma-song-card--selected' : '') + (isCmp ? ' ma-song-card--compare' : '');
            return '<div class="' + cls + '" data-track="' + esc(s.track) + '">'
                 + '<div class="ma-song-header">'
                 + '<div class="ma-song-title">' + esc(s.track) + '</div>'
                 + '<div class="ma-song-release">' + esc(fmtShort(s.firstSeenDate)) + '</div>'
                 + '</div>'
                 + '<div class="ma-song-metrics">'
                 + '<div class="ma-song-metric"><span>' + fmtNum(s.totalPlays) + '</span><small>再生</small></div>'
                 + '<div class="ma-song-metric"><span>' + fmtNum(s.uniqueListeners) + '</span><small>リスナー</small></div>'
                 + '<div class="ma-song-metric"><span>' + fmtPct(s.retRate) + '</span><small>Returning</small></div>'
                 + '<div class="ma-song-metric"><span>' + fmtNum(s.playsThisWeek) + '</span><small>今週</small></div>'
                 + '</div>'
                 + '</div>';
        }).join('');

        return '<section class="ma-section" id="ma-songs">'
             + '<div class="ma-section-header">'
             + '<h2 class="ma-section-title">Songs</h2>'
             + '<div class="ma-sort-bar">' + sortBtns + '</div>'
             + '</div>'
             + '<div id="ma-song-list">' + cards + '</div>'
             + '</section>';
    }

    function renderSongDetail(song) {
        if (!song) return '';
        var chartTracksArr = _compareMode && _compareTrack && _compareTrack !== song.track
            ? [song.track, _compareTrack]
            : [song.track];

        var html = '<section class="ma-section ma-detail" id="ma-detail">'
            + '<div class="ma-detail-header">'
            + '<h2 class="ma-detail-title">' + esc(song.track) + '</h2>'
            + '<div class="ma-detail-sub">リリース ' + esc(fmtDate(song.firstSeenDate)) + '</div>'
            + '<button class="ma-detail-close" id="ma-close-detail">×</button>'
            + '</div>';

        // Stats grid
        var stats = [
            { label:'累計再生数',         val: fmtNum(song.totalPlays) },
            { label:'今日',               val: fmtNum(song.playsToday) },
            { label:'今週',               val: fmtNum(song.playsThisWeek) },
            { label:'今月',               val: fmtNum(song.playsThisMonth) },
            { label:'ユニークリスナー',   val: fmtNum(song.uniqueListeners) },
            { label:'Returning 率',       val: fmtPct(song.retRate) },
            { label:'平均再生時間',       val: '—' },
            { label:'平均再生完了率',     val: '—' },
        ];
        html += '<div class="ma-detail-stats">'
             + stats.map(function (st) {
                 return '<div class="ma-detail-stat"><div class="ma-detail-stat-val">' + esc(st.val) + '</div>'
                      + '<div class="ma-detail-stat-lbl">' + esc(st.label) + '</div></div>';
             }).join('')
             + '</div>';

        // Compare toggle
        html += '<div class="ma-compare-bar">'
             + '<button class="ma-cmp-btn' + (_compareMode ? ' ma-cmp-btn--active' : '') + '" id="ma-cmp-toggle">'
             + (_compareMode ? '比較モード ON' : '曲を比較する')
             + '</button>'
             + (_compareMode && _compareTrack && _compareTrack !== song.track
                 ? '<span class="ma-cmp-label">vs 「' + esc(_compareTrack) + '」</span>' : '')
             + '</div>';

        // Chart period tabs
        var periods = [['7d','7日'],['30d','30日'],['90d','90日'],['all','全期間']];
        html += '<div class="ma-period-bar">'
             + periods.map(function (p) {
                 return '<button class="ma-period-btn' + (_period === p[0] ? ' ma-period-btn--active' : '') + '" data-period="' + p[0] + '">' + p[1] + '</button>';
             }).join('')
             + '</div>';

        // Chart container
        html += '<div id="ma-chart-wrap" class="ma-chart-wrap"></div>';

        // Timeline events section
        html += '<div class="ma-detail-section-title">Timeline</div>'
             + '<ul class="ma-timeline-list" id="ma-timeline-list">'
             + (_data.timeline || [])
                 .filter(function (ev) { return !ev.track || ev.track === song.track; })
                 .slice(0, 12)
                 .map(function (ev) {
                     return '<li class="ma-tl-item">'
                          + '<span class="ma-tl-dot">' + esc(ev.icon) + '</span>'
                          + '<span class="ma-tl-title">' + esc(ev.title) + '</span>'
                          + '<span class="ma-tl-date">' + esc(fmtShort(ev.date)) + '</span>'
                          + '</li>';
                 }).join('')
             + '</ul>';

        // Milestones
        var msLevels = [100, 500, 1000, 5000, 10000];
        html += '<div class="ma-detail-section-title">Milestones</div>'
             + '<div class="ma-ms-row">'
             + msLevels.map(function (n) {
                 var dt   = song.milestones[String(n)] || null;
                 var done = !!dt;
                 return '<div class="ma-ms-item' + (done ? ' ma-ms-item--done' : '') + '">'
                      + '<div class="ma-ms-count">' + fmtNum(n) + '</div>'
                      + '<div class="ma-ms-label">Plays</div>'
                      + '<div class="ma-ms-date">' + (dt ? fmtDate(dt) : 'まだ') + '</div>'
                      + '</div>';
             }).join('')
             + '</div>';

        // Release Impact
        var ri = song.releaseImpact;
        html += '<div class="ma-detail-section-title">Release Impact</div>'
             + '<div class="ma-ri-grid">'
             + [['h24','公開24時間'],['d7','公開7日'],['d30','公開30日']].map(function (w) {
                 var d = ri[w[0]] || {};
                 return '<div class="ma-ri-card">'
                      + '<div class="ma-ri-period">' + w[1] + '</div>'
                      + '<div class="ma-ri-plays">' + fmtNum(d.plays) + '<small>再生</small></div>'
                      + '<div class="ma-ri-listeners">' + fmtNum(d.uniqueListeners) + '<small>リスナー</small></div>'
                      + '</div>';
             }).join('')
             + '</div>';

        html += '</section>';
        return html;
    }

    function renderComparison(songs) {
        if (!_compareMode || !_selectedTrack || !_compareTrack) return '';
        var s1 = songs.find(function (s) { return s.track === _selectedTrack; });
        var s2 = songs.find(function (s) { return s.track === _compareTrack; });
        if (!s1 || !s2) return '';

        function row(label, v1, v2) {
            var w1 = parseFloat(v1) || 0, w2 = parseFloat(v2) || 0;
            var best = w1 >= w2 ? 'left' : 'right';
            return '<div class="ma-cmp-row">'
                 + '<div class="ma-cmp-val' + (best === 'left' ? ' ma-cmp-val--best' : '') + '">' + esc(String(v1)) + '</div>'
                 + '<div class="ma-cmp-lbl">' + esc(label) + '</div>'
                 + '<div class="ma-cmp-val' + (best === 'right' ? ' ma-cmp-val--best' : '') + '">' + esc(String(v2)) + '</div>'
                 + '</div>';
        }

        return '<section class="ma-section" id="ma-comparison">'
             + '<h2 class="ma-section-title">Comparison</h2>'
             + '<div class="ma-cmp-tracks">'
             + '<span class="ma-cmp-track ma-cmp-track--1">' + esc(s1.track) + '</span>'
             + '<span class="ma-cmp-vs">vs</span>'
             + '<span class="ma-cmp-track ma-cmp-track--2">' + esc(s2.track) + '</span>'
             + '</div>'
             + '<div class="ma-cmp-table">'
             + row('累計再生数',        fmtNum(s1.totalPlays),       fmtNum(s2.totalPlays))
             + row('ユニークリスナー',  fmtNum(s1.uniqueListeners),  fmtNum(s2.uniqueListeners))
             + row('Returning 率',      fmtPct(s1.retRate),           fmtPct(s2.retRate))
             + row('公開30日 再生数',   fmtNum(s1.releaseImpact.d30.plays), fmtNum(s2.releaseImpact.d30.plays))
             + row('今週 再生数',       fmtNum(s1.playsThisWeek),    fmtNum(s2.playsThisWeek))
             + '</div>'
             + '<div id="ma-cmp-chart-wrap" class="ma-chart-wrap"></div>'
             + '</section>';
    }

    function renderInsights(insights) {
        if (!insights || !insights.length) return '';
        return '<section class="ma-section" id="ma-insights">'
             + '<h2 class="ma-section-title">Music Insights</h2>'
             + '<ul class="ma-ins-list">'
             + insights.map(function (ins) {
                 return '<li class="ma-ins-item">'
                      + '<span class="ma-ins-icon">' + esc(ins.icon) + '</span>'
                      + '<span class="ma-ins-text">' + esc(ins.text) + '</span>'
                      + '</li>';
             }).join('')
             + '</ul></section>';
    }

    function renderAchievements(ach) {
        if (!ach) return '';
        var items = [
            { icon:'🏆', label:'最も再生された曲',      data: ach.mostPlayed },
            { icon:'🚀', label:'最も成長が早い曲',      data: ach.fastestGrowing },
            { icon:'❤️', label:'最も Returning 率が高い曲', data: ach.mostLoyal },
            { icon:'⏱️', label:'最も長く活躍している曲', data: ach.longestActive },
        ].filter(function (it) { return it.data; });

        return '<section class="ma-section" id="ma-achievements">'
             + '<h2 class="ma-section-title">Achievements</h2>'
             + '<div class="ma-ach-grid">'
             + items.map(function (it) {
                 return '<div class="ma-ach-card">'
                      + '<div class="ma-ach-icon">' + esc(it.icon) + '</div>'
                      + '<div class="ma-ach-label">' + esc(it.label) + '</div>'
                      + '<div class="ma-ach-track">' + esc(it.data.track) + '</div>'
                      + '<div class="ma-ach-value">' + esc(fmtNum(it.data.value)) + ' ' + esc(it.data.unit) + '</div>'
                      + '</div>';
             }).join('')
             + '</div></section>';
    }

    /* ── Full page render ───────────────────────────────────────── */

    // render() only mutates innerHTML — never re-binds listeners.
    // Listeners are attached once in bindEvents() called from load().
    function render(container) {
        if (!_data) return;
        var d = _data;

        var selectedSong = _selectedTrack
            ? d.songs.find(function (s) { return s.track === _selectedTrack; }) : null;

        var html = [
            renderOverview(d.overview),
            renderSongList(d.songs),
            selectedSong ? renderSongDetail(selectedSong) : '',
            _compareMode ? renderComparison(d.songs) : '',
            renderInsights(d.insights),
            renderAchievements(d.achievements),
        ].join('');

        container.innerHTML = html || '<p class="ma-empty">データがありません。</p>';

        // Draw charts (into freshly-replaced DOM nodes)
        if (selectedSong) {
            var cmpTracks = _compareMode && _compareTrack && _compareTrack !== _selectedTrack
                ? [_selectedTrack, _compareTrack] : [_selectedTrack];
            drawChart(el('ma-chart-wrap'), d.chartData, cmpTracks, _period, d.timeline);
        }
        if (_compareMode && _selectedTrack && _compareTrack && el('ma-cmp-chart-wrap')) {
            drawChart(el('ma-cmp-chart-wrap'), d.chartData, [_selectedTrack, _compareTrack], _period, []);
        }

        // Scroll to detail on first open
        if (selectedSong && el('ma-detail')) {
            el('ma-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /* ── Event binding (called ONCE from load()) ────────────────── */

    function bindEvents(container) {
        // Song card click
        on(container, '.ma-song-card', 'click', function (e, t) {
            var track = t.dataset.track;
            if (!track) return;
            if (_compareMode && _selectedTrack) {
                if (track !== _selectedTrack) {
                    _compareTrack = track;
                    render(container);
                }
            } else {
                _selectedTrack = (_selectedTrack === track) ? null : track;
                render(container);
            }
        });

        // Sort buttons
        on(container, '.ma-sort-btn', 'click', function (e, t) {
            _sort = t.dataset.sort;
            render(container);
        });

        // Period buttons
        on(container, '.ma-period-btn', 'click', function (e, t) {
            _period = t.dataset.period;
            render(container);
        });

        // Compare toggle (inside detail panel — delegation reaches it via container)
        on(container, '#ma-cmp-toggle', 'click', function () {
            _compareMode = !_compareMode;
            if (!_compareMode) _compareTrack = null;
            render(container);
        });

        // Close detail
        on(container, '#ma-close-detail', 'click', function () {
            _selectedTrack = null;
            _compareMode   = false;
            _compareTrack  = null;
            render(container);
        });
    }

    /* ── Fetch & boot ───────────────────────────────────────────── */

    function load() {
        var loading = el('ma-loading');
        var error   = el('ma-error');
        var cont    = el('ma-container');
        var fetchFn = window._adminAuthFetch || function (u) { return fetch(u); };

        fetchFn('/api/music-analytics')
            .then(function (res) {
                if (res.status === 401) { window.location.href = '/afterhours/login'; return null; }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data) return;
                _data = data;
                if (loading) loading.hidden = true;
                render(cont);
            })
            .catch(function (err) {
                console.error('[music-analytics]', err);
                if (loading) loading.hidden = true;
                if (error)   error.hidden   = false;
            });
    }

    document.addEventListener('DOMContentLoaded', load);
}());
