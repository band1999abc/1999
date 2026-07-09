/**
 * analytics-visitors.js — Visitors Analytics panel  v1
 *
 * Self-registers as window._AA_PANELS.visitors.
 * Called by analytics-overview.js on tab switch with (events, firstDate).
 *
 * Sections:
 *   Overview  — 7 KPI cards (all-time)
 *   推移      — 3-series line chart (Visitors / New / Returning) with period selector
 *   期間別    — Today / Yesterday / Week / Month / All Time breakdown table
 *   Device    — iPhone / Android / PC / Tablet proportion bars
 *   Browser   — Safari / Chrome / Edge / Firefox / Other proportion bars
 *   Returning — 1st / 2nd / 3+ visit distribution bars
 *   Time      — Hourly access bar chart (JST)
 *   Country   — Country-ranked list
 */
;(function () {
    'use strict';

    /* ── State ─────────────────────────────────────────────────────────────── */

    var S = {
        events:    [],
        firstDate: null,
        period:    '30d',   // chart period selector
    };

    /* ── Date helpers ───────────────────────────────────────────────────────── */

    var JST_MS = 9 * 3600 * 1000;

    function nowJSTms()  { return Date.now() + JST_MS; }
    function toDateStr(ts) {
        return new Date(new Date(ts).getTime() + JST_MS).toISOString().slice(0, 10);
    }
    function parseDate(s) { return new Date(s + 'T00:00:00Z'); }
    function addDays(d, n) {
        var r = new Date(d.getTime());
        r.setUTCDate(r.getUTCDate() + n);
        return r;
    }
    function toISO(d) { return d.toISOString().slice(0, 10); }

    var TODAY       = toISO(new Date(nowJSTms()));
    var YESTERDAY   = toISO(addDays(parseDate(TODAY), -1));
    var WEEK_START  = (function () {
        var dow   = new Date(nowJSTms()).getUTCDay();
        var toMon = dow === 0 ? 6 : dow - 1;
        return toISO(addDays(parseDate(TODAY), -toMon));
    }());
    var MONTH_START = TODAY.slice(0, 8) + '01';

    /* ── Helpers ────────────────────────────────────────────────────────────── */

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtNum(n)  { return (typeof n === 'number') ? n.toLocaleString() : '—'; }
    function fmtPct(n)  { return (n === null || n === undefined) ? '—' : Math.round(n * 100) + '%'; }
    function fmtDur(ms) {
        if (!ms || ms < 0) return '—';
        var s = Math.round(ms / 1000);
        if (s < 60) return s + 's';
        return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    }
    function $id(id) { return document.getElementById(id); }

    /* ── Metric helpers ─────────────────────────────────────────────────────── */

    /** Filter events to [from, to] by JST date. */
    function byDate(events, from, to) {
        return events.filter(function (e) {
            var d = toDateStr(e.ts);
            return d >= from && d <= to;
        });
    }

    /**
     * KPI for a set of events.
     * A visitor is "new" if ANY of their events has is_new_visitor === true —
     * this faithfully reflects the first-visit flag the client sets in localStorage.
     */
    function kpiFor(events) {
        if (!events.length) return { visitors: 0, newV: 0, returning: 0, rate: null };
        var seenNew = {}, seenRet = {};
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (e.is_new_visitor) seenNew[e.visitor_id] = true;
            else                  seenRet[e.visitor_id] = true;
        }
        // A visitor marked new even once counts as new; otherwise returning
        var newKeys = Object.keys(seenNew);
        var retKeys = Object.keys(seenRet).filter(function (v) { return !seenNew[v]; });
        var total   = newKeys.length + retKeys.length;
        return {
            visitors:  total,
            newV:      newKeys.length,
            returning: retKeys.length,
            rate:      total > 0 ? retKeys.length / total : null,
        };
    }

    /** Unique visitors with an event in the last N minutes. */
    function recentOnline(events, minutes) {
        var cutoff = Date.now() - minutes * 60 * 1000;
        var seen = {};
        for (var i = 0; i < events.length; i++) {
            if (new Date(events[i].ts).getTime() >= cutoff) seen[events[i].visitor_id] = true;
        }
        return Object.keys(seen).length;
    }

    /** Average session duration in ms (max_ts − min_ts per session). */
    function avgSessionDuration(events) {
        var sess = {};
        for (var i = 0; i < events.length; i++) {
            var t  = new Date(events[i].ts).getTime();
            var id = events[i].session_id;
            if (!sess[id]) sess[id] = { mn: t, mx: t };
            else { if (t < sess[id].mn) sess[id].mn = t; if (t > sess[id].mx) sess[id].mx = t; }
        }
        var ids = Object.keys(sess);
        if (!ids.length) return null;
        var total = 0;
        for (var j = 0; j < ids.length; j++) total += sess[ids[j]].mx - sess[ids[j]].mn;
        return total / ids.length;
    }

    /** Average unique pages per session. */
    function pagesPerVisit(events) {
        var sess = {};
        for (var i = 0; i < events.length; i++) {
            var id = events[i].session_id;
            if (!sess[id]) sess[id] = {};
            sess[id][events[i].page] = true;
        }
        var ids = Object.keys(sess);
        if (!ids.length) return null;
        var total = 0;
        for (var j = 0; j < ids.length; j++) total += Object.keys(sess[ids[j]]).length;
        return total / ids.length;
    }

    /** Count events by a string field, de-duplicated per visitor_id. */
    function fieldCounts(events, field) {
        var last = {};                // last value seen per visitor
        for (var i = 0; i < events.length; i++) {
            var val = events[i][field] || 'unknown';
            last[events[i].visitor_id] = val;
        }
        var counts = {};
        Object.keys(last).forEach(function (v) {
            var k = last[v];
            counts[k] = (counts[k] || 0) + 1;
        });
        return counts;
    }

    /**
     * Returning distribution: count how many visitors have 1 / 2 / 3+ sessions.
     *
     * CONTRACT: always pass S.events (full, unfiltered dataset).
     * This function counts lifetime sessions per visitor; passing a date-filtered
     * subset would silently undercount returning visitors and distort the chart.
     */
    function returningDistribution(events) {
        var visitorSess = {};
        for (var i = 0; i < events.length; i++) {
            var v = events[i].visitor_id;
            var s = events[i].session_id;
            if (!visitorSess[v]) visitorSess[v] = {};
            visitorSess[v][s] = true;
        }
        var first = 0, second = 0, third = 0;
        Object.keys(visitorSess).forEach(function (v) {
            var n = Object.keys(visitorSess[v]).length;
            if      (n === 1) first++;
            else if (n === 2) second++;
            else              third++;
        });
        return { first: first, second: second, third: third };
    }

    /** Count events by UTC+9 hour (0-23). */
    function hourlyCounts(events) {
        var counts = new Array(24).fill(0);
        for (var i = 0; i < events.length; i++) {
            var h = new Date(new Date(events[i].ts).getTime() + JST_MS).getUTCHours();
            counts[h]++;
        }
        return counts;
    }

    /** Country counts, de-duped per visitor, sorted desc. */
    function countryCounts(events) {
        var counts = fieldCounts(events, 'country');
        var rows = Object.keys(counts).map(function (k) { return { code: k, count: counts[k] }; });
        rows.sort(function (a, b) { return b.count - a.count; });
        return rows;
    }

    /* ── Daily series for chart ─────────────────────────────────────────────── */

    function buildDailySeries() {
        var fp    = S.firstDate ? S.firstDate : TODAY;
        var today = parseDate(TODAY);
        var start;
        if      (S.period === '7d')  start = addDays(today, -6);
        else if (S.period === '30d') start = addDays(today, -29);
        else if (S.period === '90d') start = addDays(today, -89);
        else                         start = parseDate(fp);

        // Build ordered day list
        var days = [];
        var cur  = new Date(start);
        while (cur <= today) { days.push(toISO(cur)); cur = addDays(cur, 1); }

        // Bucket: day → set of visitor_ids (total / new / returning)
        var dV = {}, dN = {}, dR = {};
        days.forEach(function (d) { dV[d] = {}; dN[d] = {}; dR[d] = {}; });

        for (var i = 0; i < S.events.length; i++) {
            var e = S.events[i];
            var d = toDateStr(e.ts);
            if (!dV[d]) continue;
            dV[d][e.visitor_id] = true;
            if (e.is_new_visitor) {
                dN[d][e.visitor_id] = true;
                delete dR[d][e.visitor_id]; // New 確定 → Returning から除外
            } else if (!dN[d][e.visitor_id]) {
                dR[d][e.visitor_id] = true;  // まだ New に分類されていない場合のみ
            }
        }

        return {
            days:      days,
            visitors:  days.map(function (d) { return Object.keys(dV[d]).length; }),
            newV:      days.map(function (d) { return Object.keys(dN[d]).length; }),
            returning: days.map(function (d) { return Object.keys(dR[d]).length; }),
        };
    }

    /* ── Section: Overview KPIs ─────────────────────────────────────────────── */

    function renderOverview() {
        var k      = kpiFor(S.events);
        var online = recentOnline(S.events, 5);
        var dur    = avgSessionDuration(S.events);
        var ppv    = pagesPerVisit(S.events);

        var map = {
            'av-kpi-visitors':  fmtNum(k.visitors),
            'av-kpi-new':       fmtNum(k.newV),
            'av-kpi-returning': fmtNum(k.returning),
            'av-kpi-rate':      fmtPct(k.rate),
            'av-kpi-online':    fmtNum(online),
            'av-kpi-duration':  fmtDur(dur),
            'av-kpi-ppv':       ppv !== null ? (Math.round(ppv * 10) / 10).toString() : '—',
        };
        Object.keys(map).forEach(function (id) {
            var el = $id(id);
            if (el) el.textContent = map[id];
        });

        var note = $id('av-since-note');
        if (note && S.firstDate) note.textContent = S.firstDate + ' ～';
    }

    /* ── Section: Chart ─────────────────────────────────────────────────────── */

    var SERIES_META = [
        { key: 'visitors',  color: '#8a6a42', label: 'Visitors'  },
        { key: 'newV',      color: '#5b7fa6', label: 'New'       },
        { key: 'returning', color: '#4a7c59', label: 'Returning' },
    ];

    function renderChart() {
        var svg = $id('av-chart');
        if (!svg) return;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        var data = buildDailySeries();
        var days = data.days;
        var n    = days.length;
        if (!n) return;

        var W = 440, H = 180, PL = 28, PR = 10, PT = 12, PB = 28;
        var cw = W - PL - PR, ch = H - PT - PB;
        var ns = 'http://www.w3.org/2000/svg';

        var allVals = data.visitors.concat(data.newV, data.returning);
        var mx = Math.max.apply(null, allVals);
        if (mx === 0) mx = 1;

        function px(i) { return PL + (n > 1 ? i / (n - 1) : 0.5) * cw; }
        function py(v) { return PT + ch - (v / mx) * ch; }

        // Y-axis grid lines + labels
        [0, 0.25, 0.5, 0.75, 1].forEach(function (frac) {
            var y   = PT + ch * (1 - frac);
            var val = Math.round(mx * frac);
            var gl  = document.createElementNS(ns, 'line');
            gl.setAttribute('x1', String(PL)); gl.setAttribute('x2', String(W - PR));
            gl.setAttribute('y1', String(y));  gl.setAttribute('y2', String(y));
            gl.setAttribute('stroke', '#e8e0d8'); gl.setAttribute('stroke-width', '0.5');
            svg.appendChild(gl);
            if (frac > 0) {
                var lbl = document.createElementNS(ns, 'text');
                lbl.setAttribute('x', String(PL - 4));
                lbl.setAttribute('y', String(y + 3));
                lbl.setAttribute('text-anchor', 'end');
                lbl.setAttribute('fill', '#bbb');
                lbl.setAttribute('font-size', '8');
                lbl.textContent = String(val);
                svg.appendChild(lbl);
            }
        });

        // X-axis date labels (up to 5 evenly spaced)
        var xIdxs = n <= 1 ? [0] : [0, Math.round((n-1)/4), Math.round((n-1)/2), Math.round(3*(n-1)/4), n-1];
        xIdxs.forEach(function (i) {
            var txt = document.createElementNS(ns, 'text');
            txt.setAttribute('x', String(px(i)));
            txt.setAttribute('y', String(H - 4));
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('fill', '#bbb');
            txt.setAttribute('font-size', '8');
            txt.textContent = days[i] ? days[i].slice(5) : '';
            svg.appendChild(txt);
        });

        // Draw series lines
        SERIES_META.forEach(function (s) {
            var vals = data[s.key];
            if (!vals || !vals.length) return;
            var pts = vals.map(function (v, i) { return px(i) + ',' + py(v); }).join(' ');
            var poly = document.createElementNS(ns, 'polyline');
            poly.setAttribute('points', pts);
            poly.setAttribute('fill',            'none');
            poly.setAttribute('stroke',          s.color);
            poly.setAttribute('stroke-width',    '1.5');
            poly.setAttribute('stroke-linejoin', 'round');
            poly.setAttribute('stroke-linecap',  'round');
            svg.appendChild(poly);
        });
    }

    function renderChartLegend() {
        var el = $id('av-chart-legend');
        if (!el) return;
        el.innerHTML = SERIES_META.map(function (s) {
            return '<div class="av-legend-item">' +
                '<svg width="16" height="3" viewBox="0 0 16 3" style="flex-shrink:0">' +
                '<line x1="0" y1="1.5" x2="16" y2="1.5" stroke="' + s.color + '" stroke-width="2"/>' +
                '</svg>' +
                '<span>' + esc(s.label) + '</span>' +
                '</div>';
        }).join('');
    }

    /* ── Section: Visitor Detail table ─────────────────────────────────────── */

    function renderDetail() {
        var el = $id('av-detail-body');
        if (!el) return;
        var rows = [
            { label: '今日',    ev: byDate(S.events, TODAY,       TODAY)       },
            { label: '昨日',    ev: byDate(S.events, YESTERDAY,   YESTERDAY)   },
            { label: '今週',    ev: byDate(S.events, WEEK_START,  TODAY)       },
            { label: '今月',    ev: byDate(S.events, MONTH_START, TODAY)       },
            { label: '全期間',  ev: S.events                                   },
        ];
        el.innerHTML = rows.map(function (r) {
            var k = kpiFor(r.ev);
            return '<tr>' +
                '<td class="av-dt-period">' + esc(r.label) + '</td>' +
                '<td>' + fmtNum(k.visitors)  + '</td>' +
                '<td>' + fmtNum(k.newV)      + '</td>' +
                '<td>' + fmtNum(k.returning) + '</td>' +
                '<td class="av-dt-rate">' + fmtPct(k.rate) + '</td>' +
                '</tr>';
        }).join('');
    }

    /* ── Section: Proportion bars (Device / Browser / Returning) ────────────── */

    function renderBars(containerId, items) {
        var el = $id(containerId);
        if (!el) return;
        var total = items.reduce(function (s, it) { return s + it.count; }, 0);
        if (!total) { el.innerHTML = '<div class="av-empty">データなし</div>'; return; }
        el.innerHTML = items.map(function (it) {
            var pct = Math.round(it.count / total * 100);
            return '<div class="av-bar-row">' +
                '<div class="av-bar-label">' + esc(it.label) + '</div>' +
                '<div class="av-bar-track"><div class="av-bar-fill" style="width:' + pct + '%"></div></div>' +
                '<div class="av-bar-pct">' + pct + '%</div>' +
                '</div>';
        }).join('');
    }

    var DEVICE_LABELS  = { iphone: 'iPhone', android: 'Android', pc: 'PC', tablet: 'Tablet', unknown: 'Unknown' };
    var BROWSER_LABELS = { safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', other: 'その他', unknown: 'Unknown' };

    function renderDevice() {
        var counts = fieldCounts(S.events, 'device');
        var order  = ['iphone', 'android', 'pc', 'tablet', 'unknown'];
        var items  = order
            .filter(function (k) { return counts[k]; })
            .map(function (k) { return { label: DEVICE_LABELS[k] || k, count: counts[k] }; });
        // Unknown last, rest sorted by count
        var known = items.filter(function (i) { return i.label !== 'Unknown'; })
                        .sort(function (a, b) { return b.count - a.count; });
        var unk   = items.filter(function (i) { return i.label === 'Unknown'; });
        renderBars('av-device-bars', known.concat(unk));
    }

    function renderBrowser() {
        var counts = fieldCounts(S.events, 'browser');
        var items  = Object.keys(counts).map(function (k) {
            return { label: BROWSER_LABELS[k] || k, count: counts[k] };
        });
        var known = items.filter(function (i) { return i.label !== 'Unknown'; })
                        .sort(function (a, b) { return b.count - a.count; });
        var unk   = items.filter(function (i) { return i.label === 'Unknown'; });
        renderBars('av-browser-bars', known.concat(unk));
    }

    function renderReturning() {
        var dist  = returningDistribution(S.events);
        var items = [
            { label: '初回訪問', count: dist.first  },
            { label: '2回目',   count: dist.second },
            { label: '3回以上', count: dist.third  },
        ];
        renderBars('av-returning-bars', items);
    }

    /* ── Section: Time (hourly bar chart) ───────────────────────────────────── */

    function renderTime() {
        var wrap = $id('av-time-wrap');
        if (!wrap) return;
        wrap.innerHTML = '';

        var counts = hourlyCounts(S.events);
        var mx     = Math.max.apply(null, counts);
        if (!mx) { wrap.innerHTML = '<div class="av-empty">データなし</div>'; return; }

        var W = 440, H = 110, PL = 4, PR = 4, PT = 18, PB = 18;
        var cw = W - PL - PR, ch = H - PT - PB;
        var bw = cw / 24;
        var ns = 'http://www.w3.org/2000/svg';

        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.style.cssText = 'display:block;width:100%;height:auto;overflow:visible';

        // Peak hour
        var peak = 0;
        for (var h = 1; h < 24; h++) { if (counts[h] > counts[peak]) peak = h; }

        for (var hh = 0; hh < 24; hh++) {
            var bh    = counts[hh] > 0 ? Math.max((counts[hh] / mx) * ch, 2) : 0;
            var bx    = PL + hh * bw + bw * 0.12;
            var bwIn  = bw * 0.76;
            var rect  = document.createElementNS(ns, 'rect');
            rect.setAttribute('x',      String(bx));
            rect.setAttribute('y',      String(PT + ch - bh));
            rect.setAttribute('width',  String(bwIn));
            rect.setAttribute('height', String(bh));
            rect.setAttribute('fill',   hh === peak ? '#8a6a42' : '#c8b89a');
            rect.setAttribute('rx',     '2');
            svg.appendChild(rect);

            if (hh % 6 === 0) {
                var xt = document.createElementNS(ns, 'text');
                xt.setAttribute('x',            String(PL + hh * bw + bw / 2));
                xt.setAttribute('y',            String(H - 2));
                xt.setAttribute('text-anchor',  'middle');
                xt.setAttribute('fill',         '#bbb');
                xt.setAttribute('font-size',    '9');
                xt.textContent = hh + ':00';
                svg.appendChild(xt);
            }
        }

        // Peak label
        var annX  = PL + peak * bw + bw / 2;
        var annBH = (counts[peak] / mx) * ch;
        var ann   = document.createElementNS(ns, 'text');
        ann.setAttribute('x',            String(annX));
        ann.setAttribute('y',            String(PT + ch - annBH - 5));
        ann.setAttribute('text-anchor',  'middle');
        ann.setAttribute('fill',         '#8a6a42');
        ann.setAttribute('font-size',    '9');
        ann.textContent = peak + ':00';
        svg.appendChild(ann);

        wrap.appendChild(svg);
    }

    /* ── Section: Country ───────────────────────────────────────────────────── */

    // Simple ISO 3166-1 α-2 → display name mapping
    var COUNTRY_NAMES = {
        JP: 'Japan', US: 'United States', GB: 'United Kingdom',
        KR: 'South Korea', CN: 'China', TW: 'Taiwan',
        AU: 'Australia', CA: 'Canada', DE: 'Germany',
        FR: 'France', SG: 'Singapore', HK: 'Hong Kong',
        NL: 'Netherlands', BR: 'Brazil', IN: 'India',
        Unknown: 'Unknown', unknown: 'Unknown',
    };

    function renderCountry() {
        var el   = $id('av-country-list');
        if (!el) return;
        var rows = countryCounts(S.events).slice(0, 12);
        if (!rows.length) { el.innerHTML = '<div class="av-empty">データなし</div>'; return; }
        var total = rows.reduce(function (s, r) { return s + r.count; }, 0);
        var maxC  = rows[0].count;
        el.innerHTML = rows.map(function (r, i) {
            var name   = COUNTRY_NAMES[r.code] || r.code;
            var pct    = Math.round(r.count / total * 100);
            var barPct = Math.round(r.count / maxC * 100);
            return '<div class="av-country-row">' +
                '<div class="av-country-rank">' + (i + 1) + '</div>' +
                '<div class="av-country-main">' +
                  '<div class="av-country-name">' + esc(name) + '</div>' +
                  '<div class="av-bar-track av-country-bar">' +
                    '<div class="av-bar-fill" style="width:' + barPct + '%"></div>' +
                  '</div>' +
                '</div>' +
                '<div class="av-country-right">' +
                  '<div class="av-country-count">' + fmtNum(r.count) + '</div>' +
                  '<div class="av-country-pct">'  + pct + '%</div>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    /* ── Controls ───────────────────────────────────────────────────────────── */

    var _ctrlsReady = false;

    function initControls() {
        if (_ctrlsReady) return;
        _ctrlsReady = true;

        var btns = document.querySelectorAll('.av-period-btn');
        Array.prototype.forEach.call(btns, function (btn) {
            btn.addEventListener('click', function () {
                S.period = this.getAttribute('data-period');
                Array.prototype.forEach.call(btns, function (b) { b.classList.remove('is-active'); });
                this.classList.add('is-active');
                renderChart();
            });
        });
    }

    /* ── Full render ────────────────────────────────────────────────────────── */

    function renderAll() {
        renderOverview();
        renderChart();
        renderChartLegend();
        renderDetail();
        renderDevice();
        renderBrowser();
        renderReturning();
        renderTime();
        renderCountry();
    }

    /* ── Entry point ────────────────────────────────────────────────────────── */

    function render(events, firstDate) {
        S.events    = events    || [];
        S.firstDate = firstDate || null;
        initControls();
        renderAll();
    }

    /* ── Register ───────────────────────────────────────────────────────────── */
    if (!window._AA_PANELS) window._AA_PANELS = {};
    window._AA_PANELS.visitors = render;

}());
