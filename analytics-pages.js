/**
 * analytics-pages.js
 * Pages Analytics panel for After Hours admin.
 *
 * Registers as window._AA_PANELS.pages = render(events, firstDate).
 * CSS prefix: .ap-*
 *
 * Architecture note: getPageData() is the single data-extraction layer.
 * To add Visitor Flow or Goal analysis, pass getPageData()'s returned
 * { sessions, transitions, topPaths, pages } into new render functions
 * without re-computing sessions.  The `transitions` map ("from|||to" → count)
 * is already the correct input for a future Sankey diagram.
 */
(function () {
    'use strict';

    /* ── module state ───────────────────────────────────────────── */
    var S = {
        events:    [],
        firstDate: null,
        period:    '30d'
    };

    /* ── page display-name map ──────────────────────────────────── */
    var PAGE_NAMES = {
        '/':        'Home',
        '/music':   'Music',
        '/diary':   'Diary',
        '/live':    'Live',
        '/contact': 'Contact'
    };

    /* ── utilities ──────────────────────────────────────────────── */
    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** Strip query string from a pathname and normalise trailing slash. */
    function normPage(p) {
        return (p || '/').replace(/\?.*$/, '').replace(/\/$/, '') || '/';
    }

    /** Human-readable page label.  Falls back to capitalised path segment. */
    function pageName(p) {
        if (PAGE_NAMES[p]) return PAGE_NAMES[p];
        var seg = p.replace(/^\//, '').replace(/-/g, ' ');
        return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : 'Home';
    }

    function fmtDur(ms) {
        if (!ms) return '—';
        var s = Math.round(ms / 1000);
        if (s < 60) return s + 's';
        return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
    }

    function fmtNum(n) {
        return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    }

    /* ── core data extraction ───────────────────────────────────── */
    /**
     * getPageData(events)
     *
     * Returns:
     *   pages         – sorted array of page stat objects (by views desc)
     *   sessions      – raw session map { sid → sorted events[] }
     *   transitions   – { "from|||to" → count }  ← Sankey-ready
     *   topPaths      – [{ path: string[], count }] top 8 journeys
     *   totalViews    – total page_view event count
     *   uniqueVisitors– unique visitor_ids with page_view events
     *   avgDurMs      – mean session duration in ms
     *   avgPages      – mean page_view count per session (string, 1dp)
     *
     * Extension hooks:
     *   Pass an optional `filter` object (e.g. { goal: '/music' }) to
     *   scope analysis — add filtering inside this function.
     */
    function getPageData(events /*, filter */) {
        /* 1. Raw page_view counts — used for Page Views KPI and Popular ranking.
              These are NOT deduplicated: every page_view event counts once.
              Entry/exit/transitions use deduped session paths to avoid
              counting SPA re-renders as navigation steps. */
        var rawViews = {};
        var pvVids   = {};
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (e.event !== 'page_view') continue;
            var rp = normPage(e.page);
            rawViews[rp] = (rawViews[rp] || 0) + 1;
            pvVids[e.visitor_id] = true;
        }
        var totalRawViews = Object.keys(rawViews).reduce(function (s, p) { return s + rawViews[p]; }, 0);

        /* 2. Group all events by session_id and sort chronologically */
        var sessions = {};
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (!sessions[e.session_id]) sessions[e.session_id] = [];
            sessions[e.session_id].push(e);
        }
        var sids = Object.keys(sessions);
        sids.forEach(function (sid) {
            sessions[sid].sort(function (a, b) {
                return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
            });
        });

        /* 3. Per-page accumulators for navigation analysis */
        var pageStats = {};   // page → { visitors:{}, entries, exits, totalTimeMs, timeCount }
        var transitions = {}; // "from|||to" → count  (Sankey-ready)
        var pathCounts  = {}; // serialised path → count (top-paths)
        var normalizedPaths = []; // [{ path: string[], vid, sid }] — for Goal/Flow

        function ensure(p) {
            if (!pageStats[p]) {
                pageStats[p] = { visitors: {}, entries: 0, exits: 0,
                                 totalTimeMs: 0, timeCount: 0 };
            }
        }

        var sessDurations = [];
        var totalPVSess   = 0;

        sids.forEach(function (sid) {
            var evs = sessions[sid];
            var vid = evs[0].visitor_id;
            var pvs = evs.filter(function (e) { return e.event === 'page_view'; });
            if (!pvs.length) return;
            totalPVSess++;

            /* Deduplicated page path — removes consecutive repeats (SPA noise).
               Used only for navigation analysis, NOT for view counts. */
            var path = [];
            pvs.forEach(function (e) {
                var p = normPage(e.page);
                if (!path.length || path[path.length - 1] !== p) path.push(p);
            });

            var entry = path[0];
            var exit_ = path[path.length - 1];

            /* Unique visitors per page */
            path.forEach(function (p) {
                ensure(p);
                pageStats[p].visitors[vid] = true;
            });

            /* Entry / exit counts */
            ensure(entry); pageStats[entry].entries++;
            ensure(exit_); pageStats[exit_].exits++;

            /* Transitions between consecutive distinct pages */
            for (var j = 0; j < path.length - 1; j++) {
                var key = path[j] + '|||' + path[j + 1];
                transitions[key] = (transitions[key] || 0) + 1;
            }

            /* Path frequency (2+ step journeys only) */
            if (path.length >= 2) {
                var pstr = path.join('→');
                pathCounts[pstr] = (pathCounts[pstr] || 0) + 1;
            }

            /* Normalized paths — returned for future Goal/Visitor Flow analysis */
            normalizedPaths.push({ path: path, vid: vid, sid: sid });

            /* Time-on-page: gap to next *any* event, same session, < 30 min.
               NOTE: the final event in a session has no trailing event, so the
               last page of every session contributes nothing to avgTimeMs.
               Pages that are exclusively terminal will show avgTimeMs = 0 → "—". */
            for (var j = 0; j < evs.length - 1; j++) {
                var curP  = normPage(evs[j].page);
                var gapMs = new Date(evs[j + 1].ts).getTime() - new Date(evs[j].ts).getTime();
                if (gapMs > 0 && gapMs < 1800000) {
                    ensure(curP);
                    pageStats[curP].totalTimeMs += gapMs;
                    pageStats[curP].timeCount++;
                }
            }

            /* Session duration (bounded at 60 min to exclude idle tabs) */
            if (evs.length >= 2) {
                var tss = evs.map(function (e) { return new Date(e.ts).getTime(); });
                var dur = Math.max.apply(null, tss) - Math.min.apply(null, tss);
                if (dur > 0 && dur < 3600000) sessDurations.push(dur);
            }
        });

        /* 4. Build sorted page list
              views    = raw page_view event count (not deduped)
              visitors = unique visitor_ids from deduped session paths
              exitRate = exits (deduped path terminal) / rawViews (standard definition) */
        var allPages = Object.keys(rawViews);
        // Also include any pages that appear only via other events (edge case)
        Object.keys(pageStats).forEach(function (p) {
            if (allPages.indexOf(p) === -1) allPages.push(p);
        });

        var pages = allPages.map(function (p) {
            var s = pageStats[p] || { visitors: {}, entries: 0, exits: 0, totalTimeMs: 0, timeCount: 0 };
            var rv = rawViews[p] || 0;
            return {
                page:      p,
                name:      pageName(p),
                views:     rv,
                visitors:  Object.keys(s.visitors).length,
                entries:   s.entries,
                exits:     s.exits,
                exitRate:  rv ? Math.round(s.exits / rv * 100) : 0,
                avgTimeMs: s.timeCount ? Math.round(s.totalTimeMs / s.timeCount) : 0
            };
        });
        pages.sort(function (a, b) { return b.views - a.views; });

        /* 5. Top paths */
        var topPaths = Object.keys(pathCounts)
            .map(function (k) { return { path: k.split('→'), count: pathCounts[k] }; })
            .sort(function (a, b) { return b.count - a.count; })
            .slice(0, 8);

        /* 6. Summary stats */
        var avgDurMs = sessDurations.length
            ? Math.round(sessDurations.reduce(function (s, n) { return s + n; }, 0) / sessDurations.length)
            : 0;

        /* avgPages = raw page_view events / sessions-with-page-views
                    (standard "pages per session" using raw event counts) */
        var avgPages = totalPVSess ? (totalRawViews / totalPVSess).toFixed(1) : '0';

        return {
            pages:           pages,
            sessions:        sessions,         // ← available for Visitor Flow
            transitions:     transitions,      // ← Sankey-ready
            normalizedPaths: normalizedPaths,  // ← Goal/Flow analysis input
            topPaths:        topPaths,
            totalViews:      totalRawViews,    // raw page_view event count
            uniqueVisitors:  Object.keys(pvVids).length,
            avgDurMs:        avgDurMs,
            avgPages:        avgPages
        };
    }

    /* ── daily page-view series ─────────────────────────────────── */
    function getDailySeries() {
        var TODAY = new Date();
        TODAY.setHours(0, 0, 0, 0);

        var days  = S.period === '7d' ? 7 : S.period === '30d' ? 30 : S.period === '90d' ? 90 : null;
        var start = days
            ? new Date(TODAY.getTime() - (days - 1) * 86400000)
            : (S.firstDate ? new Date(S.firstDate) : TODAY);

        var map = {};
        S.events.forEach(function (e) {
            if (e.event !== 'page_view') return;
            var d  = e.ts.slice(0, 10);
            var dt = new Date(d);
            if (dt >= start) map[d] = (map[d] || 0) + 1;
        });

        var pts = [];
        var cur = new Date(start);
        while (cur <= TODAY) {
            var k = cur.toISOString().slice(0, 10);
            pts.push({ date: k, val: map[k] || 0 });
            cur = new Date(cur.getTime() + 86400000);
        }
        return pts;
    }

    /* ── SVG chart builder ──────────────────────────────────────── */
    function buildSVG(pts) {
        var W = 600, H = 120;
        var PAD = { t: 8, r: 8, b: 28, l: 36 };
        var IW  = W - PAD.l - PAD.r;
        var IH  = H - PAD.t - PAD.b;
        var max = Math.max.apply(null, pts.map(function (p) { return p.val; })) || 1;

        function cx(i) { return PAD.l + (pts.length < 2 ? IW / 2 : i / (pts.length - 1) * IW); }
        function cy(v)  { return PAD.t + IH - (v / max * IH); }

        var line = '', area = '';
        pts.forEach(function (p, i) {
            var x = cx(i).toFixed(1), y = cy(p.val).toFixed(1);
            line += (i === 0 ? 'M' : 'L') + x + ',' + y;
            area += (i === 0 ? 'M' + x + ',' + (PAD.t + IH).toFixed(1) + 'L' : 'L') + x + ',' + y;
        });
        if (pts.length) {
            area += 'L' + cx(pts.length - 1).toFixed(1) + ',' + (PAD.t + IH).toFixed(1) + 'Z';
        }

        /* Date labels — ~5 spread evenly */
        var step   = Math.max(1, Math.floor(pts.length / 5));
        var labels = pts.map(function (p, i) {
            if (i % step !== 0 && i !== pts.length - 1) return '';
            return '<text class="ap-svg-label" x="' + cx(i).toFixed(1) + '" y="' + (H - 6) + '">'
                + p.date.slice(5) + '</text>';
        }).join('');

        /* Y gridlines */
        var grids = '';
        for (var gi = 0; gi <= 3; gi++) {
            var gv = Math.round(max * gi / 3);
            var gy = cy(gv).toFixed(1);
            grids += '<line class="ap-svg-grid" x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + gy + '" y2="' + gy + '"/>';
            grids += '<text class="ap-svg-ylabel" x="' + (PAD.l - 4) + '" y="' + (parseFloat(gy) + 4).toFixed(1) + '">' + gv + '</text>';
        }

        return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ap-svg" aria-hidden="true">'
            + '<defs><linearGradient id="apGrad" x1="0" y1="0" x2="0" y2="1">'
            + '<stop offset="0%" stop-color="var(--accent)" stop-opacity=".22"/>'
            + '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>'
            + '</linearGradient></defs>'
            + grids
            + '<path class="ap-svg-area" d="' + area + '" fill="url(#apGrad)"/>'
            + '<path class="ap-svg-line" d="' + line + '"/>'
            + labels
            + '</svg>';
    }

    /* ── renderers ──────────────────────────────────────────────── */

    function renderOverview(data) {
        var el = function (id) { return document.getElementById(id); };
        el('ap-kpi-views').textContent    = fmtNum(data.totalViews);
        el('ap-kpi-visitors').textContent = fmtNum(data.uniqueVisitors);
        el('ap-kpi-duration').textContent = fmtDur(data.avgDurMs);
        el('ap-kpi-pages').textContent    = data.avgPages;
    }

    function renderTimeline() {
        var wrap = document.getElementById('ap-chart-wrap');
        if (!wrap) return;
        var pts = getDailySeries();
        wrap.innerHTML = buildSVG(pts);
    }

    /** Shared ranked bar-list renderer. */
    function renderRankList(elId, items, valKey, labelFn) {
        var el = document.getElementById(elId);
        if (!el) return;
        var max = items.length ? items[0][valKey] : 1;
        if (!items.length) { el.innerHTML = '<p class="ap-empty">データなし</p>'; return; }
        el.innerHTML = items.map(function (item) {
            var barW = max ? Math.round(item[valKey] / max * 100) : 0;
            return '<div class="ap-rank-row">'
                + '<span class="ap-rank-name">' + esc(item.name) + '</span>'
                + '<span class="ap-rank-bar-wrap"><span class="ap-rank-bar" style="width:' + barW + '%"></span></span>'
                + '<span class="ap-rank-val">' + item[valKey] + '</span>'
                + (labelFn ? '<span class="ap-rank-extra">' + esc(labelFn(item)) + '</span>' : '')
                + '</div>';
        }).join('');
    }

    function renderPopular(data) {
        var el = document.getElementById('ap-popular-list');
        if (!el) return;
        var items = data.pages.slice(0, 10);
        var max   = items.length ? items[0].views : 1;
        if (!items.length) { el.innerHTML = '<p class="ap-empty">データなし</p>'; return; }

        el.innerHTML = '<div class="ap-rank-header">'
            + '<span class="ap-rank-name">Page</span>'
            + '<span class="ap-rank-bar-wrap"></span>'
            + '<span class="ap-rank-val">Views</span>'
            + '<span class="ap-rank-extra">Avg Time</span>'
            + '<span class="ap-rank-exit">Exit%</span>'
            + '</div>'
            + items.map(function (p) {
                var barW = max ? Math.round(p.views / max * 100) : 0;
                return '<div class="ap-rank-row">'
                    + '<span class="ap-rank-name">' + esc(p.name) + '</span>'
                    + '<span class="ap-rank-bar-wrap"><span class="ap-rank-bar" style="width:' + barW + '%"></span></span>'
                    + '<span class="ap-rank-val">' + p.views + '</span>'
                    + '<span class="ap-rank-extra ap-rank-time">' + fmtDur(p.avgTimeMs) + '</span>'
                    + '<span class="ap-rank-exit">' + p.exitRate + '%</span>'
                    + '</div>';
            }).join('');
    }

    function renderEntry(data) {
        var items = data.pages.slice()
            .sort(function (a, b) { return b.entries - a.entries; })
            .slice(0, 8)
            .map(function (p) { return { name: p.name, views: p.entries }; });
        renderRankList('ap-entry-list', items, 'views', null);
    }

    function renderExit(data) {
        var items = data.pages.slice()
            .sort(function (a, b) { return b.exits - a.exits; })
            .slice(0, 8)
            .map(function (p) { return { name: p.name, views: p.exits }; });
        renderRankList('ap-exit-list', items, 'views', null);
    }

    /**
     * renderNavigation(data)
     *
     * Two sub-sections:
     *   Top Paths  — most frequent multi-step session journeys
     *   Next Step  — for each top page, where do visitors go next
     *
     * Future: replace Top Paths with a Sankey using data.transitions.
     * Future: Goal analysis — highlight a target page and compute
     *         conversion rate from each entry page using data.sessions.
     */
    function renderNavigation(data) {
        var el = document.getElementById('ap-nav-wrap');
        if (!el) return;

        /* ── Top Paths ─────────────────────────────────────────── */
        var pathsHtml = data.topPaths.length
            ? data.topPaths.map(function (tp) {
                var steps = tp.path.map(function (p) {
                    return '<span class="ap-flow-step">' + esc(pageName(p)) + '</span>';
                }).join('<span class="ap-flow-arrow">→</span>');
                return '<div class="ap-flow-row">'
                    + '<span class="ap-flow-path">' + steps + '</span>'
                    + '<span class="ap-flow-count">×' + tp.count + '</span>'
                    + '</div>';
            }).join('')
            : '<p class="ap-empty">2ページ以上の訪問データなし</p>';

        /* ── Next Step (top 5 pages) ───────────────────────────── */
        var nextHtml = data.pages.slice(0, 5).map(function (page) {
            var p    = page.page;
            var outs = Object.keys(data.transitions)
                .filter(function (k) { return k.split('|||')[0] === p; })
                .map(function (k) {
                    return { to: k.split('|||')[1], count: data.transitions[k] };
                })
                .sort(function (a, b) { return b.count - a.count; });

            var totalOut = outs.reduce(function (s, o) { return s + o.count; }, 0) + page.exits;

            var destRows = outs.slice(0, 3).map(function (o) {
                var pct = totalOut ? Math.round(o.count / totalOut * 100) : 0;
                return '<div class="ap-next-row">'
                    + '<span class="ap-next-dest">→ ' + esc(pageName(o.to)) + '</span>'
                    + '<span class="ap-next-bar-wrap"><span class="ap-next-bar" style="width:' + pct + '%"></span></span>'
                    + '<span class="ap-next-pct">' + pct + '%</span>'
                    + '</div>';
            }).join('');

            var exitPct = totalOut ? Math.round(page.exits / totalOut * 100) : 100;
            destRows += '<div class="ap-next-row ap-next-row--exit">'
                + '<span class="ap-next-dest ap-next-dest--exit">→ Exit</span>'
                + '<span class="ap-next-bar-wrap"><span class="ap-next-bar ap-next-bar--exit" style="width:' + exitPct + '%"></span></span>'
                + '<span class="ap-next-pct">' + exitPct + '%</span>'
                + '</div>';

            return '<div class="ap-next-block">'
                + '<div class="ap-next-from">' + esc(page.name) + '</div>'
                + destRows
                + '</div>';
        }).join('');

        el.innerHTML =
            '<p class="ap-nav-sub-label">Top Paths</p>'
            + '<div class="ap-flow">' + pathsHtml + '</div>'
            + '<p class="ap-nav-sub-label" style="margin-top:28px">Next Step</p>'
            + '<div class="ap-next-grid">' + nextHtml + '</div>';
    }

    /* ── controls ───────────────────────────────────────────────── */
    function initControls() {
        var btns = document.querySelectorAll('#aa-panel-pages .ap-period-btn');
        btns.forEach(function (btn) {
            // Remove stale listeners by replacing the node clone
            var fresh = btn.cloneNode(true);
            btn.parentNode.replaceChild(fresh, btn);
            fresh.addEventListener('click', function () {
                document.querySelectorAll('#aa-panel-pages .ap-period-btn').forEach(function (b) {
                    b.classList.remove('is-active');
                });
                fresh.classList.add('is-active');
                S.period = fresh.dataset.period;
                renderTimeline();
            });
        });
    }

    function renderAll() {
        var data = getPageData(S.events);
        renderOverview(data);
        renderTimeline();
        renderPopular(data);
        renderEntry(data);
        renderExit(data);
        renderNavigation(data);
    }

    /* ── public entry point ─────────────────────────────────────── */
    function render(events, firstDate) {
        S.events    = events    || [];
        S.firstDate = firstDate || null;
        initControls();
        renderAll();
    }

    window._AA_PANELS         = window._AA_PANELS || {};
    window._AA_PANELS.pages   = render;
}());
