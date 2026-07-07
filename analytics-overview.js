/**
 * analytics-overview.js — After Hours Analytics Dashboard  v2
 *
 * Requires admin.js (runs first) which:
 *   • gates the page (auth-hidden → visible)
 *   • exposes window._adminAuthFetch
 *
 * Tab architecture:
 *   Each tab has a data-panel attribute matching a <div id="aa-panel-{name}">.
 *   Only panels with data-panel are clickable; aa-nav-tab--soon tabs are inert.
 *   To add a future tab: remove aa-nav-tab--soon, add data-panel, create the panel div,
 *   and register a loader function in PANEL_LOADERS below.
 */
;(function () {
    'use strict';

    // ── JST date helpers ──────────────────────────────────────────────────────

    var JST_OFFSET_MS = 9 * 3600 * 1000;

    function _jstNowMs()  { return Date.now() + JST_OFFSET_MS; }
    function _msToDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

    var TODAY       = _msToDate(_jstNowMs());
    var WEEK_START  = (function () {
        var dow   = new Date(_jstNowMs()).getUTCDay(); // 0=Sun … 6=Sat
        var toMon = (dow === 0) ? 6 : dow - 1;        // days since Monday
        return _msToDate(_jstNowMs() - toMon * 86400000);
    }());
    var MONTH_START = TODAY.slice(0, 8) + '01';                      // YYYY-MM-01
    var ALL_START   = _msToDate(_jstNowMs() - 89 * 86400000);       // 90-day window

    /** Convert UTC ISO timestamp to JST date string */
    function tsToJstDate(ts) {
        return _msToDate(new Date(ts).getTime() + JST_OFFSET_MS);
    }

    // ── Filtering ─────────────────────────────────────────────────────────────

    function byDate(events, from, to) {
        return events.filter(function (e) {
            var d = tsToJstDate(e.ts);
            return d >= from && d <= to;
        });
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    function uniqueVisitors(events) {
        var ids = Object.create(null);
        for (var i = 0; i < events.length; i++) ids[events[i].visitor_id] = 1;
        return Object.keys(ids).length;
    }

    function newVisitorCount(events) {
        var ids = Object.create(null);
        for (var i = 0; i < events.length; i++) {
            if (events[i].is_new_visitor) ids[events[i].visitor_id] = 1;
        }
        return Object.keys(ids).length;
    }

    function countByType(events, type) {
        var n = 0;
        for (var i = 0; i < events.length; i++) {
            if (events[i].event === type) n++;
        }
        return n;
    }

    function diaryViews(events) {
        var n = 0;
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (e.event === 'diary_view' ||
                (e.event === 'page_view' && e.page && e.page.indexOf('/diary') === 0)) n++;
        }
        return n;
    }

    function liveViews(events) {
        var n = 0;
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (e.event === 'live_view' ||
                (e.event === 'page_view' && e.page && e.page.indexOf('/live') === 0)) n++;
        }
        return n;
    }

    // ── Popular (top N) ───────────────────────────────────────────────────────

    function _topN(items, keyFn, n) {
        var counts = Object.create(null);
        for (var i = 0; i < items.length; i++) {
            var k = keyFn(items[i]) || '(unknown)';
            counts[k] = (counts[k] || 0) + 1;
        }
        return Object.keys(counts)
            .map(function (k) { return [k, counts[k]]; })
            .sort(function (a, b) { return b[1] - a[1]; })
            .slice(0, n);
    }

    function topTracks(events, n) {
        var plays = events.filter(function (e) { return e.event === 'music_play'; });
        return _topN(plays, function (e) {
            return (e.props && e.props.track) ? e.props.track : '(unknown)';
        }, n);
    }

    function topPages(events, n) {
        var views = events.filter(function (e) { return e.event === 'page_view'; });
        return _topN(views, function (e) { return e.page || '/'; }, n);
    }

    // ── Formatting ────────────────────────────────────────────────────────────

    function fmt(n) {
        return n === 0 ? '0' : n.toLocaleString('ja-JP');
    }

    function fmtPct(numerator, denominator) {
        if (!denominator) return '—';
        return Math.round(numerator / denominator * 100) + '%';
    }

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // ── DOM helpers ───────────────────────────────────────────────────────────

    function setVal(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = String(val);
    }

    function renderTopList(id, items) {
        var el = document.getElementById(id);
        if (!el) return;
        if (!items.length) {
            el.innerHTML = '<p class="aa-empty">データなし</p>';
            return;
        }
        var html = '<ol class="aa-top-list">';
        for (var i = 0; i < items.length; i++) {
            html += '<li class="aa-top-item">'
                + '<span class="aa-top-rank">' + (i + 1) + '</span>'
                + '<span class="aa-top-label">' + escHtml(items[i][0]) + '</span>'
                + '<span class="aa-top-count">' + fmt(items[i][1]) + '</span>'
                + '</li>';
        }
        html += '</ol>';
        el.innerHTML = html;
    }

    // ── Dashboard render ──────────────────────────────────────────────────────

    function renderDashboard(events) {
        var te = byDate(events, TODAY,       TODAY);
        var we = byDate(events, WEEK_START,  TODAY);
        var me = byDate(events, MONTH_START, TODAY);

        // TODAY
        var tv = uniqueVisitors(te);
        var tn = newVisitorCount(te);
        var tr = tv - tn;
        setVal('aa-today-visitors',    fmt(tv));
        setVal('aa-today-new',         fmt(tn));
        setVal('aa-today-returning',   fmt(tr));
        setVal('aa-today-return-rate', fmtPct(tr, tv));
        setVal('aa-today-music',       fmt(countByType(te, 'music_play')));
        setVal('aa-today-diary',       fmt(diaryViews(te)));
        setVal('aa-today-live',        fmt(liveViews(te)));

        // THIS WEEK
        setVal('aa-week-visitors', fmt(uniqueVisitors(we)));
        setVal('aa-week-music',    fmt(countByType(we, 'music_play')));

        // THIS MONTH
        setVal('aa-month-visitors', fmt(uniqueVisitors(me)));
        setVal('aa-month-music',    fmt(countByType(me, 'music_play')));

        // ALL TIME (90-day window)
        setVal('aa-all-visitors', fmt(uniqueVisitors(events)));
        setVal('aa-all-music',    fmt(countByType(events, 'music_play')));

        // POPULAR (all time window)
        renderTopList('aa-top-tracks', topTracks(events, 5));
        renderTopList('aa-top-pages',  topPages(events, 5));
    }

    // ── Panel loader registry ─────────────────────────────────────────────────
    //
    // Map of panel name → loader function(events).
    // Add entries here when new detail tabs are built.

    var PANEL_LOADERS = {
        dashboard: renderDashboard,
        // visitors: renderVisitors,  // future
        // music:    renderMusic,      // future
        // pages:    renderPages,      // future
    };

    // ── Tab navigation ────────────────────────────────────────────────────────

    var _activePanel = 'dashboard';

    function showPanel(name) {
        // Update tab active state
        var tabs = document.querySelectorAll('.aa-nav-tab[data-panel]');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('is-active', tabs[i].dataset.panel === name);
        }
        // Show/hide panels
        var panels = document.querySelectorAll('.aa-panel');
        for (var j = 0; j < panels.length; j++) {
            panels[j].hidden = (panels[j].id !== 'aa-panel-' + name);
        }
        _activePanel = name;
    }

    function initTabs() {
        var tabs = document.querySelectorAll('.aa-nav-tab[data-panel]');
        for (var i = 0; i < tabs.length; i++) {
            (function (tab) {
                tab.addEventListener('click', function () {
                    showPanel(tab.dataset.panel);
                });
            }(tabs[i]));
        }
    }

    // ── Data fetch ────────────────────────────────────────────────────────────

    var _events  = null;
    var _loading = false;

    function setLoading(on) {
        var loadEl = document.getElementById('aa-loading');
        var panel  = document.getElementById('aa-panel-' + _activePanel);
        if (loadEl) { loadEl.textContent = '読み込み中…'; loadEl.style.display = on ? '' : 'none'; }
        if (panel)  panel.hidden = on;
    }

    function setError(msg) {
        var loadEl = document.getElementById('aa-loading');
        if (loadEl) { loadEl.textContent = msg; loadEl.style.display = ''; }
        var panel = document.getElementById('aa-panel-' + _activePanel);
        if (panel) panel.hidden = true;
    }

    function applyData(events) {
        _events = events;
        setLoading(false);
        showPanel(_activePanel);
        var loader = PANEL_LOADERS[_activePanel];
        if (loader) loader(events);
    }

    function load() {
        if (_loading) return;
        _loading = true;
        setLoading(true);

        var url = '/api/analytics?start=' + ALL_START + '&end=' + TODAY;

        window._adminAuthFetch(url)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                _loading = false;
                applyData(Array.isArray(data.events) ? data.events : []);
            })
            .catch(function () {
                _loading = false;
                setError('読み込みに失敗しました。再読み込みしてください。');
            });
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', function () {
        initTabs();

        var refreshBtn = document.getElementById('aa-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                _events = null;
                load();
            });
        }

        // _adminAuthFetch is set synchronously by admin.js before DOMContentLoaded
        load();
    });

}());
