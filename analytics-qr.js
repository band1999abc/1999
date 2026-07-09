/**
 * analytics-qr.js — QR Analytics panel  v1
 *
 * Self-registers as window._AA_PANELS.qr.
 * Called by analytics-overview.js on tab switch with (events, firstDate).
 *
 * ── Definitions ──────────────────────────────────────────────────────────────
 *   QR Session  — any session_id that contains a `qr_scan` event
 *   QR Visitor  — any visitor_id with at least one QR session
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *   Overview        — 6 KPI cards (scans, visitors, returning, music, diary, live)
 *   Conversion      — 5-step funnel: QR Scan → Home → Music → 全て再生* → Returning
 *   Timeline        — Daily QR scan chart + Live event markers (period selector)
 *   Music           — First song per QR session, ranked TOP 10
 *   Pages           — QR landing-page distribution
 *   Returning       — 翌日 / 7日以内 / 30日以内 re-visit rates
 *   Time            — Hourly scan distribution (JST)
 *   Device          — Device breakdown
 *
 * ── Future expansion hooks ───────────────────────────────────────────────────
 *   qr_scan props.edition → per-edition filter (QRカードEdition別分析)
 *   qr_scan props.live_id → per-live filter (ライブ別分析)
 *   music_complete event  → populate "全て再生" funnel step (*requires new tracker)
 *   Date range filter     → 季節別分析
 */
;(function () {
    'use strict';

    /* ── State ─────────────────────────────────────────────────────────────── */

    var S = {
        events:    [],
        firstDate: null,
        lives:     [],      // [{ date, label }] — Live events for timeline markers
        period:    '30d',   // timeline chart period
        _meta:     false,   // meta fetch done
    };

    /* ── Date helpers ───────────────────────────────────────────────────────── */

    var JST_MS = 9 * 3600 * 1000;
    function nowJSTms()    { return Date.now() + JST_MS; }
    function toDateStr(ts) {
        return new Date(new Date(ts).getTime() + JST_MS).toISOString().slice(0, 10);
    }
    function parseDate(s)  { return new Date(s + 'T00:00:00Z'); }
    function addDays(d, n) {
        var r = new Date(d.getTime());
        r.setUTCDate(r.getUTCDate() + n);
        return r;
    }
    function toISO(d) { return d.toISOString().slice(0, 10); }

    var TODAY = toISO(new Date(nowJSTms()));

    /* ── Utility helpers ────────────────────────────────────────────────────── */

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtNum(n)  { return (typeof n === 'number') ? n.toLocaleString() : '—'; }
    function fmtPct(n)  { return (n === null || n === undefined) ? '—' : Math.round(n * 100) + '%'; }
    function $id(id)    { return document.getElementById(id); }

    /* ── SVG helper ─────────────────────────────────────────────────────────── */

    var NS = 'http://www.w3.org/2000/svg';
    function mk(tag, attrs) {
        var el = document.createElementNS(NS, tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
        }
        return el;
    }

    /* ── QR data extraction ─────────────────────────────────────────────────── */

    /**
     * Extract QR-relevant datasets from the full event list.
     *
     * Returns:
     *   qrSessions   Map<session_id → earliest qr_scan event>
     *   qrEvents     All events whose session_id is in qrSessions
     *   visitorFirst Map<visitor_id → earliest qr_scan event across all their sessions>
     *
     * Future extension: add an optional filter argument here to scope by
     * props.edition or props.live_id without touching any other code.
     */
    function getQRData(events) {
        // 1. Identify QR sessions (any session with ≥1 qr_scan event)
        var qrSessions = {};
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (e.event !== 'qr_scan') continue;
            var cur = qrSessions[e.session_id];
            if (!cur || e.ts < cur.ts) qrSessions[e.session_id] = e;
        }

        // 2. Collect all events in QR sessions
        var qrEvents = [];
        for (var j = 0; j < events.length; j++) {
            if (qrSessions[events[j].session_id]) qrEvents.push(events[j]);
        }

        // 3. First QR scan per visitor (across all their QR sessions)
        var visitorFirst = {};
        Object.keys(qrSessions).forEach(function (sid) {
            var e  = qrSessions[sid];
            var vf = visitorFirst[e.visitor_id];
            if (!vf || e.ts < vf.ts) visitorFirst[e.visitor_id] = e;
        });

        return { qrSessions: qrSessions, qrEvents: qrEvents, visitorFirst: visitorFirst };
    }

    /* ── Section: Overview ──────────────────────────────────────────────────── */

    function renderOverview(qr) {
        var scans    = Object.keys(qr.qrSessions).length;
        var visitors = Object.keys(qr.visitorFirst).length;

        // "Returning Visitors" = QR visitors who had already visited the site
        // before their first QR scan (is_new_visitor = false on the qr_scan event)
        var returning = 0;
        Object.keys(qr.visitorFirst).forEach(function (vid) {
            if (!qr.visitorFirst[vid].is_new_visitor) returning++;
        });

        var music = 0, diary = 0, live = 0;
        for (var i = 0; i < qr.qrEvents.length; i++) {
            var ev = qr.qrEvents[i].event;
            if      (ev === 'music_play') music++;
            else if (ev === 'diary_view') diary++;
            else if (ev === 'live_view')  live++;
        }

        var map = {
            'aq-kpi-scans':     fmtNum(scans),
            'aq-kpi-visitors':  fmtNum(visitors),
            'aq-kpi-returning': fmtNum(returning),
            'aq-kpi-music':     fmtNum(music),
            'aq-kpi-diary':     fmtNum(diary),
            'aq-kpi-live':      fmtNum(live),
        };
        Object.keys(map).forEach(function (id) {
            var el = $id(id);
            if (el) el.textContent = map[id];
        });

        var note = $id('aq-since-note');
        if (note && S.firstDate) note.textContent = S.firstDate + ' ～';
    }

    /* ── Section: Conversion Funnel ─────────────────────────────────────────── */

    /**
     * Build a per-visitor index of QR session_ids.
     * Used by returning-detection to exclude in-session events.
     */
    function qrSidsByVisitor(qr) {
        var out = {};
        Object.keys(qr.qrSessions).forEach(function (sid) {
            var vid = qr.qrSessions[sid].visitor_id;
            if (!out[vid]) out[vid] = {};
            out[vid][sid] = true;
        });
        return out;
    }

    function computeQRReturningCount(qr) {
        // A visitor "returned" if they had any event that is:
        //   (a) AFTER their first QR scan timestamp, AND
        //   (b) in a session_id NOT belonging to any of their QR sessions
        // This excludes normal in-session activity after the QR scan.
        var vids = Object.keys(qr.visitorFirst);
        if (!vids.length) return 0;

        var sidMap = qrSidsByVisitor(qr);

        var byVisitor = {};
        for (var i = 0; i < S.events.length; i++) {
            var e = S.events[i];
            if (!byVisitor[e.visitor_id]) byVisitor[e.visitor_id] = [];
            byVisitor[e.visitor_id].push({ ts: e.ts, sid: e.session_id });
        }

        var count = 0;
        vids.forEach(function (vid) {
            var firstTs = qr.visitorFirst[vid].ts;
            var qrSids  = sidMap[vid] || {};
            var evs     = byVisitor[vid] || [];
            for (var j = 0; j < evs.length; j++) {
                if (evs[j].ts > firstTs && !qrSids[evs[j].sid]) { count++; break; }
            }
        });
        return count;
    }

    function renderFunnel(qr) {
        var el = $id('aq-funnel');
        if (!el) return;

        var sessionCount = Object.keys(qr.qrSessions).length;
        var visitorCount = Object.keys(qr.visitorFirst).length;

        // Step 2: Home — QR sessions with at least one event on '/'
        var homeSess = {};
        for (var i = 0; i < qr.qrEvents.length; i++) {
            var page = qr.qrEvents[i].page;
            if (page === '/' || page === '') homeSess[qr.qrEvents[i].session_id] = true;
        }

        // Step 3: Music — QR sessions with music_play
        var musicSess = {};
        for (var j = 0; j < qr.qrEvents.length; j++) {
            if (qr.qrEvents[j].event === 'music_play') musicSess[qr.qrEvents[j].session_id] = true;
        }

        // Step 5: Returning (visitor-based)
        var returningCount = computeQRReturningCount(qr);

        var steps = [
            { label: 'QR Scan',     count: sessionCount,                         base: sessionCount,  note: '' },
            { label: 'Home',        count: Object.keys(homeSess).length,         base: sessionCount,  note: '/ の閲覧' },
            { label: 'Music',       count: Object.keys(musicSess).length,        base: sessionCount,  note: '再生セッション' },
            { label: '全て再生',    count: null,                                 base: sessionCount,  note: '計測予定', future: true },
            { label: 'Returning',   count: returningCount,                       base: visitorCount,  note: '再訪問者' },
        ];

        var html = '';
        for (var k = 0; k < steps.length; k++) {
            var s      = steps[k];
            var barPct = (s.count !== null && s.base > 0) ? Math.round(s.count / s.base * 100) : 0;
            var pctStr = s.future ? '—'
                       : (s.base > 0 && s.count !== null) ? fmtPct(s.count / s.base) : '—';
            var cntStr = s.count !== null ? fmtNum(s.count) : '—';

            html += '<div class="aq-funnel-step' + (s.future ? ' aq-funnel-step--future' : '') + '">';
            html +=   '<div class="aq-funnel-left">';
            html +=     '<div class="aq-funnel-label">' + esc(s.label) + '</div>';
            if (s.note) html += '<div class="aq-funnel-note">' + esc(s.note) + '</div>';
            html +=   '</div>';
            html +=   '<div class="aq-funnel-bar-track">';
            html +=     '<div class="aq-funnel-bar-fill" style="width:' + barPct + '%"></div>';
            html +=   '</div>';
            html +=   '<div class="aq-funnel-right">';
            html +=     '<div class="aq-funnel-count">' + cntStr + '</div>';
            html +=     '<div class="aq-funnel-pct">' + pctStr + '</div>';
            html +=   '</div>';
            html += '</div>';

            if (k < steps.length - 1) {
                var prevC = steps[k].count;
                var nextC = steps[k + 1].count;
                var conv  = '—';
                if (!steps[k + 1].future && prevC !== null && nextC !== null && prevC > 0) {
                    conv = fmtPct(nextC / prevC);
                }
                html += '<div class="aq-funnel-arrow">↓ <span class="aq-funnel-conv">' + conv + '</span></div>';
            }
        }
        el.innerHTML = html;
    }

    /* ── Section: Timeline ──────────────────────────────────────────────────── */

    function buildTimelineData() {
        var fp    = S.firstDate ? S.firstDate : TODAY;
        var today = parseDate(TODAY);
        var start;
        if      (S.period === '7d')  start = addDays(today, -6);
        else if (S.period === '30d') start = addDays(today, -29);
        else if (S.period === '90d') start = addDays(today, -89);
        else                         start = parseDate(fp);

        var days = [];
        var cur  = new Date(start);
        while (cur <= today) { days.push(toISO(cur)); cur = addDays(cur, 1); }

        var counts = {};
        days.forEach(function (d) { counts[d] = 0; });

        for (var i = 0; i < S.events.length; i++) {
            if (S.events[i].event !== 'qr_scan') continue;
            var d = toDateStr(S.events[i].ts);
            if (counts[d] !== undefined) counts[d]++;
        }

        return { days: days, values: days.map(function (d) { return counts[d]; }) };
    }

    function renderTimeline() {
        var wrap = $id('aq-chart-wrap');
        if (!wrap) return;
        wrap.innerHTML = '';

        var data = buildTimelineData();
        var days = data.days;
        var vals = data.values;
        var n    = days.length;

        var W = 440, H = 160, PL = 32, PR = 10, PT = 14, PB = 26;
        var cw = W - PL - PR, ch = H - PT - PB;
        var svg = mk('svg', { viewBox: '0 0 ' + W + ' ' + H });
        svg.style.cssText = 'display:block;width:100%;height:auto;overflow:visible';

        // Gradient def
        var defs = mk('defs', {});
        var grad = mk('linearGradient', { id: 'aq-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
        [
            mk('stop', { offset: '0%',   'stop-color': '#8a6a42', 'stop-opacity': '0.28' }),
            mk('stop', { offset: '100%', 'stop-color': '#8a6a42', 'stop-opacity': '0'    }),
        ].forEach(function (s) { grad.appendChild(s); });
        defs.appendChild(grad);
        svg.appendChild(defs);

        var mx = n ? Math.max.apply(null, vals) : 0;
        if (!n || mx === 0) {
            var empty = mk('text', {
                x: W / 2, y: H / 2, 'text-anchor': 'middle',
                fill: '#bbb', 'font-size': '12',
            });
            empty.textContent = 'QR Scanデータなし';
            svg.appendChild(empty);
            wrap.appendChild(svg);
            return;
        }

        function px(i) { return PL + (n > 1 ? i / (n - 1) : 0.5) * cw; }
        function py(v) { return PT + ch - (v / mx) * ch; }

        // Y-axis grid + labels
        [0, 0.5, 1].forEach(function (frac) {
            var y  = PT + ch * (1 - frac);
            svg.appendChild(mk('line', {
                x1: PL, y1: y, x2: W - PR, y2: y,
                stroke: '#e8e0d8', 'stroke-width': '0.5',
            }));
            if (frac > 0) {
                var lbl = mk('text', {
                    x: PL - 4, y: y + 3, 'text-anchor': 'end', fill: '#bbb', 'font-size': '8',
                });
                lbl.textContent = String(Math.round(mx * frac));
                svg.appendChild(lbl);
            }
        });

        // X-axis date labels (up to 5 ticks)
        var labelIdxs = n <= 1 ? [0]
            : [0, Math.round((n-1)/4), Math.round((n-1)/2), Math.round(3*(n-1)/4), n-1];
        labelIdxs.forEach(function (i) {
            var xt = mk('text', {
                x: px(i), y: H - 4, 'text-anchor': 'middle', fill: '#bbb', 'font-size': '8',
            });
            xt.textContent = days[i] ? days[i].slice(5) : '';
            svg.appendChild(xt);
        });

        // Live event markers (dashed vertical lines)
        for (var mi = 0; mi < S.lives.length; mi++) {
            var lidx = days.indexOf(S.lives[mi].date);
            if (lidx < 0) continue;
            svg.appendChild(mk('line', {
                x1: px(lidx), y1: PT, x2: px(lidx), y2: PT + ch,
                stroke: '#8a6a42', 'stroke-width': '1',
                'stroke-dasharray': '3,3', opacity: '0.55',
            }));
        }

        // Area fill
        if (n > 1) {
            var pts = [PL + ',' + (PT + ch)];
            for (var ai = 0; ai < n; ai++) pts.push(px(ai) + ',' + py(vals[ai]));
            pts.push(px(n - 1) + ',' + (PT + ch));
            svg.appendChild(mk('polygon', { points: pts.join(' '), fill: 'url(#aq-grad)' }));
        }

        // Data line
        if (n > 1) {
            var linePts = vals.map(function (v, i) { return px(i) + ',' + py(v); }).join(' ');
            svg.appendChild(mk('polyline', {
                points: linePts, fill: 'none',
                stroke: '#8a6a42', 'stroke-width': '1.5',
                'stroke-linejoin': 'round', 'stroke-linecap': 'round',
            }));
        }

        // Dots (when ≤ 60 days)
        if (n <= 60) {
            for (var di = 0; di < n; di++) {
                if (vals[di] === 0 && n > 14) continue;
                svg.appendChild(mk('circle', { cx: px(di), cy: py(vals[di]), r: 2.5, fill: '#8a6a42' }));
            }
        }

        wrap.appendChild(svg);
    }

    /* ── Section: Music (first song per QR session, TOP 10) ─────────────────── */

    function renderMusic(qr) {
        var el = $id('aq-music-list');
        if (!el) return;

        // Find the first music_play event per QR session
        var sessionFirst = {};
        for (var i = 0; i < qr.qrEvents.length; i++) {
            var e = qr.qrEvents[i];
            if (e.event !== 'music_play') continue;
            var track = (e.props && e.props.track) ? String(e.props.track) : 'Unknown';
            var cur   = sessionFirst[e.session_id];
            if (!cur || e.ts < cur.ts) sessionFirst[e.session_id] = { track: track, ts: e.ts };
        }

        var counts = {};
        Object.keys(sessionFirst).forEach(function (sid) {
            var t = sessionFirst[sid].track;
            counts[t] = (counts[t] || 0) + 1;
        });

        var ranked = Object.keys(counts)
            .map(function (t) { return { name: t, count: counts[t] }; })
            .sort(function (a, b) { return b.count - a.count; })
            .slice(0, 10);

        if (!ranked.length) { el.innerHTML = '<div class="aq-empty">データなし</div>'; return; }

        var total = Object.keys(sessionFirst).length;
        var maxC  = ranked[0].count;

        el.innerHTML = ranked.map(function (r, i) {
            var pct    = total > 0 ? Math.round(r.count / total * 100) : 0;
            var barPct = maxC  > 0 ? Math.round(r.count / maxC  * 100) : 0;
            return '<div class="aq-rank-row">' +
                '<div class="aq-rank-num">' + (i + 1) + '</div>' +
                '<div class="aq-rank-info">' +
                  '<div class="aq-rank-name">' + esc(r.name) + '</div>' +
                  '<div class="aq-rank-bar"><div class="aq-rank-bar-fill" style="width:' + barPct + '%"></div></div>' +
                '</div>' +
                '<div class="aq-rank-right">' +
                  '<div class="aq-rank-count">' + fmtNum(r.count) + '</div>' +
                  '<div class="aq-rank-pct">'  + pct + '%</div>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    /* ── Section: Pages (QR landing-page distribution) ──────────────────────── */

    function renderPages(qr) {
        var el = $id('aq-pages-list');
        if (!el) return;

        // Landing page = page of the qr_scan event (strip query string)
        var counts = {};
        Object.keys(qr.qrSessions).forEach(function (sid) {
            var raw  = qr.qrSessions[sid].page || '/';
            var page = raw.split('?')[0] || '/';
            counts[page] = (counts[page] || 0) + 1;
        });

        var ranked = Object.keys(counts)
            .map(function (p) { return { page: p, count: counts[p] }; })
            .sort(function (a, b) { return b.count - a.count; });

        if (!ranked.length) { el.innerHTML = '<div class="aq-empty">データなし</div>'; return; }

        var total = Object.keys(qr.qrSessions).length;
        var maxC  = ranked[0].count;

        el.innerHTML = ranked.map(function (r, i) {
            var pct    = total > 0 ? Math.round(r.count / total * 100) : 0;
            var barPct = maxC  > 0 ? Math.round(r.count / maxC  * 100) : 0;
            return '<div class="aq-rank-row">' +
                '<div class="aq-rank-num">' + (i + 1) + '</div>' +
                '<div class="aq-rank-info">' +
                  '<div class="aq-rank-name aq-rank-name--mono">' + esc(r.page) + '</div>' +
                  '<div class="aq-rank-bar"><div class="aq-rank-bar-fill" style="width:' + barPct + '%"></div></div>' +
                '</div>' +
                '<div class="aq-rank-right">' +
                  '<div class="aq-rank-count">' + fmtNum(r.count) + '</div>' +
                  '<div class="aq-rank-pct">'  + pct + '%</div>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    /* ── Section: Returning rates ────────────────────────────────────────────── */

    function renderReturning(qr) {
        var el = $id('aq-returning-grid');
        if (!el) return;

        var vids  = Object.keys(qr.visitorFirst);
        var total = vids.length;

        if (!total) {
            el.innerHTML = '<div class="aq-empty" style="grid-column:1/-1">データなし</div>';
            return;
        }

        // Index all events by visitor_id — keep session_id for QR-session exclusion
        var sidMap    = qrSidsByVisitor(qr);
        var byVisitor = {};
        for (var i = 0; i < S.events.length; i++) {
            var e = S.events[i];
            if (!byVisitor[e.visitor_id]) byVisitor[e.visitor_id] = [];
            byVisitor[e.visitor_id].push({ ts: new Date(e.ts).getTime(), sid: e.session_id });
        }

        var next = 0, w7 = 0, w30 = 0;
        vids.forEach(function (vid) {
            var firstTs = new Date(qr.visitorFirst[vid].ts).getTime();
            var qrSids  = sidMap[vid] || {};
            var evs     = byVisitor[vid] || [];

            // Earliest return event: must be after first QR scan AND in a non-QR session
            var laterMs = Infinity;
            for (var j = 0; j < evs.length; j++) {
                if (evs[j].ts > firstTs && !qrSids[evs[j].sid] && evs[j].ts < laterMs) {
                    laterMs = evs[j].ts;
                }
            }
            if (laterMs === Infinity) return;
            var diffDays = (laterMs - firstTs) / 86400000;
            if (diffDays <= 1)  next++;
            if (diffDays <= 7)  w7++;
            if (diffDays <= 30) w30++;
        });

        var rates = [
            { label: '翌日再訪率',     rate: next / total, count: next  },
            { label: '7日以内再訪率',  rate: w7   / total, count: w7   },
            { label: '30日以内再訪率', rate: w30  / total, count: w30  },
        ];

        el.innerHTML = rates.map(function (r) {
            return '<div class="aa-card">' +
                '<div class="aa-value">' + fmtPct(r.rate) + '</div>' +
                '<div class="aa-card-label">' + esc(r.label) + '</div>' +
                '<div class="aq-ret-sub">' + fmtNum(r.count) + ' / ' + fmtNum(total) + '</div>' +
                '</div>';
        }).join('');
    }

    /* ── Section: Time (hourly QR scan bar chart) ────────────────────────────── */

    function renderTime(qr) {
        var wrap = $id('aq-time-wrap');
        if (!wrap) return;
        wrap.innerHTML = '';

        var counts = new Array(24).fill(0);
        for (var i = 0; i < qr.qrEvents.length; i++) {
            if (qr.qrEvents[i].event !== 'qr_scan') continue;
            var h = new Date(new Date(qr.qrEvents[i].ts).getTime() + JST_MS).getUTCHours();
            counts[h]++;
        }

        var mx = Math.max.apply(null, counts);
        if (!mx) { wrap.innerHTML = '<div class="aq-empty">データなし</div>'; return; }

        var W = 440, H = 110, PL = 4, PR = 4, PT = 18, PB = 18;
        var cw = W - PL - PR, ch = H - PT - PB;
        var bw = cw / 24;

        var svg = mk('svg', { viewBox: '0 0 ' + W + ' ' + H });
        svg.style.cssText = 'display:block;width:100%;height:auto;overflow:visible';

        var peak = 0;
        for (var hpk = 1; hpk < 24; hpk++) { if (counts[hpk] > counts[peak]) peak = hpk; }

        for (var hh = 0; hh < 24; hh++) {
            var bh = counts[hh] > 0 ? Math.max((counts[hh] / mx) * ch, 2) : 0;
            svg.appendChild(mk('rect', {
                x: PL + hh * bw + bw * 0.12, y: PT + ch - bh,
                width: bw * 0.76, height: bh,
                fill: hh === peak ? '#8a6a42' : '#c8b89a', rx: '2',
            }));
            if (hh % 6 === 0) {
                var xt = mk('text', {
                    x: PL + hh * bw + bw / 2, y: H - 2,
                    'text-anchor': 'middle', fill: '#bbb', 'font-size': '9',
                });
                xt.textContent = hh + ':00';
                svg.appendChild(xt);
            }
        }

        // Peak annotation
        var ann = mk('text', {
            x: PL + peak * bw + bw / 2,
            y: PT + ch - (counts[peak] / mx) * ch - 5,
            'text-anchor': 'middle', fill: '#8a6a42', 'font-size': '9',
        });
        ann.textContent = peak + ':00';
        svg.appendChild(ann);
        wrap.appendChild(svg);
    }

    /* ── Meta fetch (Live dates for timeline markers) ────────────────────────── */

    function loadMeta(cb) {
        if (S._meta) { cb(); return; }
        var auth = window._adminAuthFetch;
        if (!auth) { cb(); return; }
        auth('/api/live')
            .then(function (r) { return r.json(); })
            .catch(function ()  { return []; })
            .then(function (raw) {
                S.lives = (Array.isArray(raw) ? raw : [])
                    .filter(function (l) { return l.date; })
                    .map(function (l) { return { date: l.date, label: l.venue || 'Live' }; })
                    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
                S._meta = true;
                cb();
            });
    }

    /* ── Controls ───────────────────────────────────────────────────────────── */

    var _ctrlsReady = false;
    function initControls() {
        if (_ctrlsReady) return;
        _ctrlsReady = true;
        var btns = document.querySelectorAll('.aq-period-btn');
        Array.prototype.forEach.call(btns, function (btn) {
            btn.addEventListener('click', function () {
                S.period = this.getAttribute('data-period');
                Array.prototype.forEach.call(btns, function (b) { b.classList.remove('is-active'); });
                this.classList.add('is-active');
                renderTimeline();
            });
        });
    }

    /* ── Full render ────────────────────────────────────────────────────────── */

    function renderAll() {
        var qr = getQRData(S.events);
        renderOverview(qr);
        renderFunnel(qr);
        renderTimeline();
        renderMusic(qr);
        renderPages(qr);
        renderReturning(qr);
        renderTime(qr);
    }

    /* ── Entry point ────────────────────────────────────────────────────────── */

    function render(events, firstDate) {
        S.events    = Array.isArray(events) ? events : [];
        S.firstDate = firstDate || null;
        initControls();
        renderAll();
        // Re-render timeline once live markers are loaded
        loadMeta(function () { renderTimeline(); });
    }

    /* ── Register ───────────────────────────────────────────────────────────── */
    if (!window._AA_PANELS) window._AA_PANELS = {};
    window._AA_PANELS.qr = render;

}());
