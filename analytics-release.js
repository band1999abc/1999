// analytics-release.js — Release Impact panel
// IIFE self-registers as window._AA_PANELS.release
// render(events, firstDate) is called by analytics-overview.js on tab switch.

(function () {
    'use strict';

    /* ── State ──────────────────────────────────────────────────────────────── */

    var S = {
        view:        'list',        // 'list' | 'detail' | 'compare'
        track:       null,          // selected track name
        mode:        'cumulative',  // 'cumulative' | 'daily'
        period:      'all',         // '7d' | '30d' | '90d' | 'all'
        sort:        'release',     // 'release' | 'plays' | '7d'
        tracks:      {},            // { name: TrackData }
        events:      [],
        firstDate:   null,
        live:        [],
        diary:       [],
        _metaLoaded: false,
        _ctrlsReady: false,
    };

    /* ── Utilities ───────────────────────────────────────────────────────────── */

    var TODAY = (function () {
        var d   = new Date();
        var y   = d.getFullYear();
        var m   = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }());

    function toDate(ts) { return ts.slice(0, 10); }

    function parseDate(s) {
        var p = s.split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    function addDays(d, n) {
        var r = new Date(d);
        r.setDate(r.getDate() + n);
        return r;
    }

    function toISO(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function fmt(n) {
        if (n === null || n === undefined) return '—';
        return Number(n).toLocaleString('ja-JP');
    }

    function fmtPct(r) {
        if (r === null || !isFinite(r)) return '—';
        return (r * 100).toFixed(1) + '%';
    }

    function fmtDelta(r) {
        if (r === null || !isFinite(r)) return '—';
        return (r > 0 ? '+' : '') + (r * 100).toFixed(0) + '%';
    }

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ── Track aggregation ───────────────────────────────────────────────────── */

    function buildTracks(events) {
        var byTrack = {};

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (ev.event !== 'music_play') continue;
            var name = (ev.props && ev.props.track) ? ev.props.track : '(unknown)';
            if (!byTrack[name]) byTrack[name] = [];
            byTrack[name].push(ev);
        }

        var result = {};
        var names  = Object.keys(byTrack);

        for (var j = 0; j < names.length; j++) {
            var trackName = names[j];
            var arr = byTrack[trackName].sort(function (a, b) {
                return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
            });

            var firstPlay = toDate(arr[0].ts);
            var fp        = parseDate(firstPlay);
            var d1End  = toISO(addDays(fp, 1));
            var d7End  = toISO(addDays(fp, 7));
            var d30End = toISO(addDays(fp, 30));

            var td = {
                name:       trackName,
                firstPlay:  firstPlay,
                totalPlays: arr.length,
                listeners:  {},
                eventsArr:  arr,
                d1:  { plays: 0, visitors: {}, returning: 0 },
                d7:  { plays: 0, visitors: {}, returning: 0 },
                d30: { plays: 0, visitors: {}, returning: 0 },
            };

            for (var k = 0; k < arr.length; k++) {
                var e   = arr[k];
                var day = toDate(e.ts);
                var vid = e.visitor_id;

                td.listeners[vid] = true;

                if (day < d1End) {
                    td.d1.plays++;
                    td.d1.visitors[vid] = true;
                    if (!e.is_new_visitor) td.d1.returning++;
                }
                if (day < d7End) {
                    td.d7.plays++;
                    td.d7.visitors[vid] = true;
                    if (!e.is_new_visitor) td.d7.returning++;
                }
                if (day < d30End) {
                    td.d30.plays++;
                    td.d30.visitors[vid] = true;
                    if (!e.is_new_visitor) td.d30.returning++;
                }
            }

            td.listenerCount    = Object.keys(td.listeners).length;
            td.d1.visitorCount  = Object.keys(td.d1.visitors).length;
            td.d7.visitorCount  = Object.keys(td.d7.visitors).length;
            td.d30.visitorCount = Object.keys(td.d30.visitors).length;
            td.daysSince = Math.floor((Date.now() - fp.getTime()) / 86400000);

            result[trackName] = td;
        }

        S.tracks = result;
    }

    /* ── Daily counts for chart ──────────────────────────────────────────────── */

    function dailyCounts(td) {
        var fp    = parseDate(td.firstPlay);
        var today = parseDate(TODAY);

        // Use N-1 offset so the window is exactly N days inclusive (today counts as day 1)
        var start;
        if (S.period === '7d') {
            start = addDays(today, -6);
            if (start < fp) start = new Date(fp);
        } else if (S.period === '30d') {
            start = addDays(today, -29);
            if (start < fp) start = new Date(fp);
        } else if (S.period === '90d') {
            start = addDays(today, -89);
            if (start < fp) start = new Date(fp);
        } else {
            start = new Date(fp);
        }

        // Build day map
        var dayMap = {};
        var cur = new Date(start);
        while (cur <= today) {
            dayMap[toISO(cur)] = 0;
            cur = addDays(cur, 1);
        }

        for (var i = 0; i < td.eventsArr.length; i++) {
            var d = toDate(td.eventsArr[i].ts);
            if (dayMap.hasOwnProperty(d)) dayMap[d]++;
        }

        var days  = Object.keys(dayMap).sort();
        var daily = days.map(function (d) { return dayMap[d]; });

        // Offset for cumulative view when period is windowed
        var offset = 0;
        if (S.mode === 'cumulative' && S.period !== 'all') {
            var startISO = toISO(start);
            for (var k = 0; k < td.eventsArr.length; k++) {
                if (toDate(td.eventsArr[k].ts) < startISO) offset++;
            }
        }

        var cumulative = [];
        var sum = offset;
        for (var j = 0; j < daily.length; j++) {
            sum += daily[j];
            cumulative.push(sum);
        }

        return { days: days, daily: daily, cumulative: cumulative };
    }

    /* ── Analysis ────────────────────────────────────────────────────────────── */

    function computeAnalysis(td) {
        var rows = [];

        // 1. Live前後の再生数増加率
        var liveRows = S.live.map(function (lv) {
            if (!lv.date) return null;
            var b3 = toISO(addDays(parseDate(lv.date), -3));
            var a3 = toISO(addDays(parseDate(lv.date),  3));
            var before = 0, after = 0;
            for (var i = 0; i < td.eventsArr.length; i++) {
                var d = toDate(td.eventsArr[i].ts);
                if (d >= b3 && d < lv.date)  before++;   // [date−3, date)  = 3 days
                if (d >  lv.date && d <= a3) after++;    // (date,   date+3] = 3 days
            }
            return { date: lv.date, before: before, after: after };
        }).filter(Boolean);

        if (liveRows.length > 0) {
            liveRows.sort(function (a, b) { return (b.after - b.before) - (a.after - a.before); });
            var best  = liveRows[0];
            var ratio = best.before > 0 ? (best.after - best.before) / best.before : null;
            rows.push({
                label:    'ライブ前後の再生数増加率',
                value:    fmtDelta(ratio),
                note:     best.date + ' ±3日比較',
                positive: ratio !== null && ratio > 0,
            });
        } else {
            rows.push({ label: 'ライブ前後の再生数増加率', value: '—',
                        note: S.live.length ? 'この楽曲の近辺にライブなし' : 'データなし', positive: null });
        }

        // 2. Diary公開後の再生数変化
        var diaryRows = S.diary.map(function (dv) {
            if (!dv.date) return null;
            var prev = toISO(addDays(parseDate(dv.date), -1));
            var next = toISO(addDays(parseDate(dv.date),  1));
            var before = 0, after = 0;
            for (var i = 0; i < td.eventsArr.length; i++) {
                var d = toDate(td.eventsArr[i].ts);
                if (d === prev) before++;
                if (d === next) after++;
            }
            return { date: dv.date, before: before, after: after };
        }).filter(Boolean);

        if (diaryRows.length > 0) {
            diaryRows.sort(function (a, b) { return (b.after - b.before) - (a.after - a.before); });
            var bestD  = diaryRows[0];
            var ratioD = bestD.before > 0 ? (bestD.after - bestD.before) / bestD.before : null;
            rows.push({
                label:    'Diary公開後の再生数変化',
                value:    fmtDelta(ratioD),
                note:     bestD.date + ' 前後1日比較',
                positive: ratioD !== null && ratioD > 0,
            });
        } else {
            rows.push({ label: 'Diary公開後の再生数変化', value: '—',
                        note: S.diary.length ? 'この楽曲の近辺にDiaryなし' : 'データなし', positive: null });
        }

        // 3. Returning Visitor率
        var retCount = 0;
        for (var ri = 0; ri < td.eventsArr.length; ri++) {
            if (!td.eventsArr[ri].is_new_visitor) retCount++;
        }
        rows.push({
            label:    'Returning Visitor率',
            value:    fmtPct(td.totalPlays > 0 ? retCount / td.totalPlays : null),
            note:     '全期間',
            positive: null,
        });

        // 4. 平均再生時間
        rows.push({ label: '平均再生時間', value: '—', note: '取得できません', positive: null });

        return rows;
    }

    /* ── SVG chart ───────────────────────────────────────────────────────────── */

    function drawChart(td) {
        var svg = document.getElementById('ar-chart');
        if (!svg) return;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        var data   = dailyCounts(td);
        var values = S.mode === 'cumulative' ? data.cumulative : data.daily;
        var days   = data.days;

        var ns = 'http://www.w3.org/2000/svg';
        if (!values || values.length === 0) {
            var msg = document.createElementNS(ns, 'text');
            msg.setAttribute('x', '220'); msg.setAttribute('y', '90');
            msg.setAttribute('text-anchor', 'middle');
            msg.setAttribute('fill', '#999'); msg.setAttribute('font-size', '11');
            msg.textContent = 'データなし';
            svg.appendChild(msg);
            renderLegend();
            return;
        }

        var W = 440, H = 180;
        var PL = 10, PR = 10, PT = 20, PB = 28;
        var cw = W - PL - PR;
        var ch = H - PT - PB;
        var n  = values.length;
        var mx = Math.max.apply(null, values);
        if (mx === 0) mx = 1;

        function px(i) { return PL + (i / Math.max(n - 1, 1)) * cw; }
        function py(v) { return PT + ch - (v / mx) * ch; }

        // Gradient defs
        var defs = document.createElementNS(ns, 'defs');
        var grad = document.createElementNS(ns, 'linearGradient');
        grad.setAttribute('id', 'ar-grad');
        grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
        grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
        [['0%', '0.18'], ['100%', '0.02']].forEach(function (pair) {
            var s = document.createElementNS(ns, 'stop');
            s.setAttribute('offset', pair[0]);
            s.setAttribute('stop-color', '#8a6a42');
            s.setAttribute('stop-opacity', pair[1]);
            grad.appendChild(s);
        });
        defs.appendChild(grad);
        svg.appendChild(defs);

        // Area
        var areaPts = [PL + ',' + (PT + ch)];
        for (var i = 0; i < n; i++) {
            areaPts.push(px(i).toFixed(1) + ',' + py(values[i]).toFixed(1));
        }
        areaPts.push((PL + cw) + ',' + (PT + ch));
        var area = document.createElementNS(ns, 'polygon');
        area.setAttribute('points', areaPts.join(' '));
        area.setAttribute('fill', 'url(#ar-grad)');
        svg.appendChild(area);

        // Line
        var pts = values.map(function (v, i) {
            return px(i).toFixed(1) + ',' + py(v).toFixed(1);
        });
        var line = document.createElementNS(ns, 'polyline');
        line.setAttribute('points', pts.join(' '));
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', '#8a6a42');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-linejoin', 'round');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);

        // Dots (sparse data)
        if (n <= 60) {
            for (var di = 0; di < n; di++) {
                var c = document.createElementNS(ns, 'circle');
                c.setAttribute('cx', px(di).toFixed(1));
                c.setAttribute('cy', py(values[di]).toFixed(1));
                c.setAttribute('r', '2');
                c.setAttribute('fill', '#8a6a42');
                svg.appendChild(c);
            }
        }

        // Event markers
        var fp = parseDate(td.firstPlay);

        function dayIdx(dateStr) {
            if (!days.length) return -1;
            if (dateStr < days[0] || dateStr > days[days.length - 1]) return -1;
            return days.indexOf(dateStr);
        }

        function addMarker(dayStr, color, dash, label) {
            var idx = dayIdx(dayStr);
            if (idx < 0) return;
            var x = px(idx);
            var vLine = document.createElementNS(ns, 'line');
            vLine.setAttribute('x1', x.toFixed(1)); vLine.setAttribute('y1', String(PT));
            vLine.setAttribute('x2', x.toFixed(1)); vLine.setAttribute('y2', String(PT + ch));
            vLine.setAttribute('stroke', color); vLine.setAttribute('stroke-width', '1');
            vLine.setAttribute('opacity', '0.7');
            if (dash) vLine.setAttribute('stroke-dasharray', dash);
            svg.appendChild(vLine);

            var txt = document.createElementNS(ns, 'text');
            txt.setAttribute('x', (x + 2).toFixed(1));
            txt.setAttribute('y', String(PT - 3));
            txt.setAttribute('fill', color);
            txt.setAttribute('font-size', '7');
            txt.setAttribute('letter-spacing', '0.06em');
            txt.textContent = label.toUpperCase();
            svg.appendChild(txt);
        }

        addMarker(td.firstPlay, '#4a7c59', '2,3', 'Release');
        for (var lv = 0; lv < S.live.length;  lv++) { addMarker(S.live[lv].date,  '#8a6a42', null,  'Live');  }
        for (var dv = 0; dv < S.diary.length; dv++) { addMarker(S.diary[dv].date, '#aaa',    '3,3', 'Diary'); }

        // X-axis day labels
        var step = Math.max(1, Math.floor(n / 5));
        for (var xl = 0; xl < n; xl += step) {
            var daysFromRelease = Math.round((parseDate(days[xl]) - fp) / 86400000);
            var xt = document.createElementNS(ns, 'text');
            xt.setAttribute('x', px(xl).toFixed(1));
            xt.setAttribute('y', String(H - 4));
            xt.setAttribute('fill', '#999');
            xt.setAttribute('font-size', '8');
            xt.setAttribute('text-anchor', 'middle');
            xt.textContent = '+' + daysFromRelease + 'd';
            svg.appendChild(xt);
        }

        // Y-axis max label
        var ymax = document.createElementNS(ns, 'text');
        ymax.setAttribute('x', String(PL + 2));
        ymax.setAttribute('y', String(PT - 4));
        ymax.setAttribute('fill', '#bbb');
        ymax.setAttribute('font-size', '8');
        ymax.textContent = fmt(mx);
        svg.appendChild(ymax);

        renderLegend();
    }

    function renderLegend() {
        var el = document.getElementById('ar-legend');
        if (!el) return;
        el.innerHTML = '';
        var items = [
            { color: '#4a7c59', label: 'Release', dash: '2,3' },
            { color: '#8a6a42', label: 'Live',    dash: null  },
            { color: '#aaa',    label: 'Diary',   dash: '3,3' },
        ];
        var ns = 'http://www.w3.org/2000/svg';
        items.forEach(function (item) {
            var wrap = document.createElement('span');
            wrap.className = 'ar-legend-item';
            var svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('width', '16'); svg.setAttribute('height', '8');
            svg.setAttribute('aria-hidden', 'true');
            var l = document.createElementNS(ns, 'line');
            l.setAttribute('x1', '0'); l.setAttribute('y1', '4');
            l.setAttribute('x2', '16'); l.setAttribute('y2', '4');
            l.setAttribute('stroke', item.color); l.setAttribute('stroke-width', '1.5');
            if (item.dash) l.setAttribute('stroke-dasharray', item.dash);
            svg.appendChild(l);
            var span = document.createElement('span');
            span.textContent = item.label;
            wrap.appendChild(svg); wrap.appendChild(span);
            el.appendChild(wrap);
        });
    }

    /* ── List view ───────────────────────────────────────────────────────────── */

    function showList() {
        var listEl = document.getElementById('ar-list');
        var detEl  = document.getElementById('ar-detail');
        var cmpEl  = document.getElementById('ar-compare');
        if (!listEl) return;
        listEl.hidden = false;
        if (detEl) detEl.hidden = true;
        if (cmpEl) cmpEl.hidden = true;
        S.view = 'list';
        renderList();
    }

    function renderList() {
        var container = document.getElementById('ar-tracks');
        var countEl   = document.getElementById('ar-track-count');
        if (!container) return;

        var names = Object.keys(S.tracks);

        if (names.length === 0) {
            container.innerHTML = '<p class="aa-empty">music_playイベントなし</p>';
            if (countEl) countEl.textContent = '';
            return;
        }

        names.sort(function (a, b) {
            var ta = S.tracks[a], tb = S.tracks[b];
            if (S.sort === 'plays') return tb.totalPlays - ta.totalPlays;
            if (S.sort === '7d')   return tb.d7.plays   - ta.d7.plays;
            return ta.firstPlay < tb.firstPlay ? 1 : ta.firstPlay > tb.firstPlay ? -1 : 0;
        });

        if (countEl) countEl.textContent = names.length + ' tracks';

        var html = '';
        for (var i = 0; i < names.length; i++) {
            var td    = S.tracks[names[i]];
            var isNew = td.daysSince <= 30;
            html += '<div class="ar-track-row" data-track="' + esc(td.name) + '">';
            html +=   '<div class="ar-track-main">';
            html +=     '<div class="ar-track-name-row">';
            html +=       '<span class="ar-track-name">' + esc(td.name) + '</span>';
            if (isNew) html += '<span class="ar-badge-new">NEW</span>';
            html +=     '</div>';
            html +=     '<div class="ar-track-sub">' + td.firstPlay + ' · ' + td.daysSince + '日経過</div>';
            html +=     '<div class="ar-initials">';
            html +=       '<div class="ar-initial-cell"><div class="ar-initial-val">' + fmt(td.d1.plays)  + '</div><div class="ar-initial-lbl">24h</div></div>';
            html +=       '<div class="ar-initial-cell"><div class="ar-initial-val">' + fmt(td.d7.plays)  + '</div><div class="ar-initial-lbl">7d</div></div>';
            html +=       '<div class="ar-initial-cell"><div class="ar-initial-val">' + fmt(td.d30.plays) + '</div><div class="ar-initial-lbl">30d</div></div>';
            html +=     '</div>';
            html +=   '</div>';
            html +=   '<div class="ar-track-right">';
            html +=     '<div class="ar-track-total">' + fmt(td.totalPlays) + '</div>';
            html +=     '<div class="ar-track-total-lbl">plays</div>';
            html +=   '</div>';
            html += '</div>';
        }
        container.innerHTML = html;

        // Row click → detail
        var rows = container.querySelectorAll('.ar-track-row');
        for (var r = 0; r < rows.length; r++) {
            (function (row) {
                row.addEventListener('click', function () {
                    S.track = row.dataset.track;
                    showDetail();
                });
            }(rows[r]));
        }
    }

    /* ── Detail view ─────────────────────────────────────────────────────────── */

    function showDetail() {
        var listEl = document.getElementById('ar-list');
        var detEl  = document.getElementById('ar-detail');
        var cmpEl  = document.getElementById('ar-compare');
        if (!detEl) return;
        if (listEl) listEl.hidden = true;
        detEl.hidden = false;
        if (cmpEl) cmpEl.hidden = true;
        S.view = 'detail';
        renderDetail();
    }

    function renderDetail() {
        var td = S.tracks[S.track];
        if (!td) { showList(); return; }

        // Hero
        var titleEl = document.getElementById('ar-track-title');
        var metaEl  = document.getElementById('ar-track-meta');
        if (titleEl) titleEl.textContent = td.name;
        if (metaEl)  metaEl.textContent  = '初回再生日 ' + td.firstPlay + ' · ' + td.daysSince + '日経過';

        // 概要
        var grid = document.getElementById('ar-overview-grid');
        if (grid) {
            var retCount = 0;
            for (var ri = 0; ri < td.eventsArr.length; ri++) {
                if (!td.eventsArr[ri].is_new_visitor) retCount++;
            }
            var retPct = fmtPct(td.totalPlays > 0 ? retCount / td.totalPlays : null);
            grid.innerHTML =
                '<div class="aa-card"><div class="aa-value">' + fmt(td.totalPlays) + '</div><div class="aa-card-label">Total plays</div></div>' +
                '<div class="aa-card"><div class="aa-value">' + fmt(td.listenerCount) + '</div><div class="aa-card-label">Unique listeners</div></div>' +
                '<div class="aa-card"><div class="aa-value">' + retPct + '</div><div class="aa-card-label">Returning率</div></div>' +
                '<div class="aa-card"><div class="aa-value">—</div><div class="aa-card-label">平均再生時間</div></div>';
        }

        // 初動
        var tbody = document.getElementById('ar-hatsudo-body');
        if (tbody) {
            tbody.innerHTML =
                hRow('24時間', td.d1)  +
                hRow('7日間',  td.d7)  +
                hRow('30日間', td.d30);
        }

        // Chart + legend
        drawChart(td);

        // 分析
        var analysisEl = document.getElementById('ar-analysis');
        if (analysisEl) {
            var items = computeAnalysis(td);
            var html = '';
            for (var ai = 0; ai < items.length; ai++) {
                var row = items[ai];
                var cls = row.positive === true  ? 'ar-analysis-val--pos'
                        : row.positive === false ? 'ar-analysis-val--neg'
                        : '';
                html += '<div class="ar-analysis-row">' +
                    '<div class="ar-analysis-left">' +
                    '<div class="ar-analysis-label">' + esc(row.label) + '</div>' +
                    '<div class="ar-analysis-note">'  + esc(row.note)  + '</div>' +
                    '</div>' +
                    '<div class="ar-analysis-val ' + cls + '">' + esc(row.value) + '</div>' +
                    '</div>';
            }
            analysisEl.innerHTML = html;
        }
    }

    function hRow(period, d) {
        return '<tr>' +
            '<td>' + period + '</td>' +
            '<td class="ar-td-main">' + fmt(d.plays) + '</td>' +
            '<td>' + fmt(d.visitorCount) + '</td>' +
            '<td>' + fmt(d.returning) + '</td>' +
            '</tr>';
    }

    /* ── Comparison view ─────────────────────────────────────────────────────── */

    function showCompare() {
        var listEl = document.getElementById('ar-list');
        var detEl  = document.getElementById('ar-detail');
        var cmpEl  = document.getElementById('ar-compare');
        if (!cmpEl) return;
        if (listEl) listEl.hidden = true;
        if (detEl)  detEl.hidden  = true;
        cmpEl.hidden = false;
        S.view = 'compare';
        renderCompare();
    }

    function renderCompare() {
        var el = document.getElementById('ar-compare-body');
        if (!el) return;

        var names = Object.keys(S.tracks);
        if (names.length === 0) {
            el.innerHTML = '<p class="aa-empty">楽曲データなし</p>';
            return;
        }

        var today  = parseDate(TODAY);
        var cut30  = toISO(addDays(today, -30));

        var html = '';

        // 7日間ランキング
        html += '<div class="aa-section-header ar-section-gap"><span class="aa-section-label">公開7日間ランキング</span></div>';
        html += rankTable(names, '7d');

        html += '<hr class="ar-divider">';

        // 30日間ランキング
        html += '<div class="aa-section-header ar-section-gap"><span class="aa-section-label">公開30日間ランキング</span></div>';
        html += rankTable(names, '30d');

        html += '<hr class="ar-divider">';

        // 最も伸びた楽曲
        html += '<div class="aa-section-header ar-section-gap"><span class="aa-section-label">最も伸びた楽曲</span></div>';
        html += growthList(names);

        html += '<hr class="ar-divider">';

        // 現在最も再生されている
        html += '<div class="aa-section-header ar-section-gap"><span class="aa-section-label">現在最も再生されている楽曲</span></div>';
        html += recentList(names, cut30);

        el.innerHTML = html;
    }

    function rankTable(names, period) {
        var sorted = names.slice().sort(function (a, b) {
            var va = period === '7d' ? S.tracks[a].d7.plays : S.tracks[a].d30.plays;
            var vb = period === '7d' ? S.tracks[b].d7.plays : S.tracks[b].d30.plays;
            return vb - va;
        });

        var html = '<table class="ar-cmp-table"><thead><tr>' +
            '<th class="ar-cmp-rank">#</th>' +
            '<th style="text-align:left">Track</th>' +
            '<th>Plays</th><th>Listeners</th>' +
            '</tr></thead><tbody>';

        for (var i = 0; i < sorted.length; i++) {
            var td    = S.tracks[sorted[i]];
            var plays = period === '7d' ? td.d7.plays        : td.d30.plays;
            var vis   = period === '7d' ? td.d7.visitorCount : td.d30.visitorCount;
            html += '<tr>' +
                '<td class="ar-cmp-rank">' + (i + 1) + '</td>' +
                '<td class="ar-cmp-name">' + esc(td.name) + '</td>' +
                '<td class="ar-cmp-val">'  + fmt(plays) + '</td>' +
                '<td class="ar-cmp-muted">' + fmt(vis) + '</td>' +
                '</tr>';
        }
        html += '</tbody></table>';
        return html;
    }

    function growthList(names) {
        // Growth: (30d − 7d) / 7d — momentum beyond first week
        var sorted = names.slice().sort(function (a, b) {
            function g(t) {
                return t.d7.plays > 0 ? (t.d30.plays - t.d7.plays) / t.d7.plays : -Infinity;
            }
            return g(S.tracks[b]) - g(S.tracks[a]);
        });

        var html = '<div class="ar-rank-list">';
        for (var i = 0; i < sorted.length; i++) {
            var td     = S.tracks[sorted[i]];
            var growth = td.d7.plays > 0 ? (td.d30.plays - td.d7.plays) / td.d7.plays : null;
            var cls    = (growth !== null && growth > 0) ? 'ar-rank-delta--pos' : 'ar-rank-delta--neu';
            html += '<div class="ar-rank-row">' +
                '<span class="ar-rank-num">' + (i + 1) + '</span>' +
                '<div class="ar-rank-info">' +
                '<div class="ar-rank-name">' + esc(td.name) + '</div>' +
                '<div class="ar-rank-sub">7日 → 30日の伸び</div></div>' +
                '<span class="ar-rank-delta ' + cls + '">' + fmtDelta(growth) + '</span>' +
                '</div>';
        }
        html += '</div>';
        return html;
    }

    function recentList(names, cutoff) {
        function recentPlays(td) {
            var n = 0;
            for (var i = 0; i < td.eventsArr.length; i++) {
                if (toDate(td.eventsArr[i].ts) >= cutoff) n++;
            }
            return n;
        }

        var sorted = names.slice().sort(function (a, b) {
            return recentPlays(S.tracks[b]) - recentPlays(S.tracks[a]);
        });

        var html = '<div class="ar-rank-list">';
        for (var i = 0; i < sorted.length; i++) {
            var td = S.tracks[sorted[i]];
            var rp = recentPlays(td);
            html += '<div class="ar-rank-row">' +
                '<span class="ar-rank-num">' + (i + 1) + '</span>' +
                '<div class="ar-rank-info">' +
                '<div class="ar-rank-name">' + esc(td.name) + '</div>' +
                '<div class="ar-rank-sub">過去30日</div></div>' +
                '<div class="ar-rank-right">' +
                '<div class="ar-rank-plays">' + fmt(rp) + '</div>' +
                '<div class="ar-rank-plays-lbl">plays</div>' +
                '</div></div>';
        }
        html += '</div>';
        return html;
    }

    /* ── Meta fetch (live + diary) ───────────────────────────────────────────── */

    function loadMeta(callback) {
        if (S._metaLoaded) { callback(); return; }

        var done = 0;
        function check() { if (++done === 2) { S._metaLoaded = true; callback(); } }

        window._adminAuthFetch('/api/live')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var items = Array.isArray(data) ? data : (data.items || []);
                S.live = items
                    .filter(function (x) { return x.date; })
                    .map(function (x) { return { date: x.date, label: x.venue || 'Live' }; });
                check();
            })
            .catch(function () { S.live = []; check(); });

        window._adminAuthFetch('/api/diary')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var items = Array.isArray(data) ? data : (data.items || []);
                S.diary = items
                    .filter(function (x) { return x.date; })
                    .map(function (x) { return { date: x.date, label: x.title || 'Diary' }; });
                check();
            })
            .catch(function () { S.diary = []; check(); });
    }

    /* ── Controls init ───────────────────────────────────────────────────────── */

    function initControls() {
        if (S._ctrlsReady) return;
        S._ctrlsReady = true;

        // ← Music button: return to Music panel from Release list
        var toMusic = document.getElementById('ar-to-music');
        if (toMusic) toMusic.addEventListener('click', function () {
            if (window._AA_showPanel) window._AA_showPanel('music');
        });

        // Back from detail
        var backBtn = document.getElementById('ar-back');
        if (backBtn) backBtn.addEventListener('click', function () { showList(); });

        // Back from compare
        var cmpBack = document.getElementById('ar-compare-back');
        if (cmpBack) cmpBack.addEventListener('click', function () { showList(); });

        // Open compare
        var cmpBtn = document.getElementById('ar-compare-btn');
        if (cmpBtn) cmpBtn.addEventListener('click', function () { showCompare(); });

        // Sort
        var sortGroup = document.getElementById('ar-sort-group');
        if (sortGroup) {
            sortGroup.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-sort]');
                if (!btn) return;
                S.sort = btn.dataset.sort;
                sortGroup.querySelectorAll('.ar-toggle-btn').forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                });
                renderList();
            });
        }

        // Mode (cumulative / daily)
        var modeGroup = document.getElementById('ar-mode-group');
        if (modeGroup) {
            modeGroup.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-mode]');
                if (!btn) return;
                S.mode = btn.dataset.mode;
                modeGroup.querySelectorAll('.ar-toggle-btn').forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                });
                if (S.view === 'detail' && S.track) drawChart(S.tracks[S.track]);
            });
        }

        // Period
        var periodGroup = document.getElementById('ar-period-group');
        if (periodGroup) {
            periodGroup.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-period]');
                if (!btn) return;
                S.period = btn.dataset.period;
                periodGroup.querySelectorAll('.ar-period-btn').forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                });
                if (S.view === 'detail' && S.track) drawChart(S.tracks[S.track]);
            });
        }
    }

    /* ── Entry point ─────────────────────────────────────────────────────────── */

    function render(events, firstDate) {
        S.events    = events    || [];
        S.firstDate = firstDate || null;

        buildTracks(S.events);
        initControls();

        // If meta is not yet loaded, render immediately (without markers) then re-render
        // once it arrives. If already cached, loadMeta() calls back synchronously —
        // skip the pre-render to avoid a duplicate pass.
        if (!S._metaLoaded) {
            if (S.view === 'list')         renderList();
            else if (S.view === 'detail')  renderDetail();
            else if (S.view === 'compare') renderCompare();
        }

        loadMeta(function () {
            if (S.view === 'list')         renderList();
            else if (S.view === 'detail')  renderDetail();
            else if (S.view === 'compare') renderCompare();
        });
    }

    /* ── Register ────────────────────────────────────────────────────────────── */
    if (!window._AA_PANELS) window._AA_PANELS = {};
    window._AA_PANELS.release = render;

}());
