/**
 * milestones.js  —  client-side renderer for /afterhours/milestones
 *
 * Fetches GET /api/milestones (admin-authenticated),
 * then renders the Apple-award-style milestone cards.
 */
(function () {
    'use strict';

    var CAT_ORDER = ['Music', 'Visitors', 'Returning', 'QR', 'Diary', 'Live', 'Release'];

    /* ── utils ─────────────────────────────────────────────────── */
    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** ISO string → 「2026年3月15日」 in JST.
     *  Appends 'Z' when the datetime has no timezone marker so that
     *  browsers without a timezone treat it as UTC, not local time. */
    function fmtDate(isoStr) {
        if (!isoStr) return '';
        var s = isoStr;
        // Normalize: if looks like "YYYY-MM-DDTHH:mm…" with no trailing Z or ±hh:mm
        if (s.length >= 16 && !s.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(s)) {
            s += 'Z';
        }
        var d = new Date(s);
        if (isNaN(d.getTime())) return '';
        var jst = new Date(d.getTime() + 9 * 3600000);
        return jst.getUTCFullYear() + '年'
             + (jst.getUTCMonth() + 1) + '月'
             + jst.getUTCDate() + '日';
    }

    /** Build the「あと N unit」hint text for unachieved milestones */
    function hintText(ms) {
        var diff = ms.diff;
        if (diff <= 0) return '';
        var n = diff.toLocaleString('ja-JP');
        if (ms.unit === '%') return 'あと ' + diff + '%';
        return 'あと ' + n + ' ' + ms.unit;
    }

    /* ── SVG icons ─────────────────────────────────────────────── */
    function checkSvg() {
        return '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">'
             + '<path d="M4 10L8.5 14.5L16 6" stroke="white" stroke-width="2.2"'
             + ' stroke-linecap="round" stroke-linejoin="round"/>'
             + '</svg>';
    }

    function lockSvg() {
        return '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">'
             + '<rect x="3" y="8" width="11" height="8" rx="2.5" stroke="currentColor" stroke-width="1.5"/>'
             + '<path d="M5.5 8V5.5a3 3 0 016 0V8" stroke="currentColor"'
             + ' stroke-width="1.5" stroke-linecap="round"/>'
             + '</svg>';
    }

    /* ── card renderer ──────────────────────────────────────────── */
    function renderCard(ms) {
        var done  = ms.achieved;
        var state = done ? 'ms-card--done' : 'ms-card--locked';
        var icon  = done
            ? '<div class="ms-icon ms-icon--done">' + checkSvg() + '</div>'
            : '<div class="ms-icon ms-icon--locked">' + lockSvg() + '</div>';
        var sub   = done
            ? '<div class="ms-date">' + esc(fmtDate(ms.achievedAt)) + '</div>'
            : '<div class="ms-hint">' + esc(hintText(ms)) + '</div>';

        return '<div class="ms-card ' + state + '" role="listitem">'
             + icon
             + '<div class="ms-label">' + esc(ms.label) + '</div>'
             + sub
             + '</div>';
    }

    /* ── category section renderer ──────────────────────────────── */
    function renderCategory(cat, milestones) {
        var icon  = esc(milestones[0] ? milestones[0].catIcon : '');
        var done  = milestones.filter(function (m) { return m.achieved; }).length;
        var total = milestones.length;

        return '<section class="ms-category">'
             + '<div class="ms-cat-header">'
             + '<span class="ms-cat-icon" aria-hidden="true">' + icon + '</span>'
             + '<span class="ms-cat-name">' + esc(cat) + '</span>'
             + '<span class="ms-cat-badge' + (done === total ? ' ms-cat-badge--complete' : '') + '">'
             + done + ' / ' + total
             + '</span>'
             + '</div>'
             + '<div class="ms-grid" role="list">'
             + milestones.map(renderCard).join('')
             + '</div>'
             + '</section>';
    }

    /* ── render all milestones into the page ────────────────────── */
    function render(milestones) {
        var bycat = {};
        milestones.forEach(function (m) {
            if (!bycat[m.cat]) bycat[m.cat] = [];
            bycat[m.cat].push(m);
        });

        var totalDone  = milestones.filter(function (m) { return m.achieved; }).length;
        var totalCount = milestones.length;
        var pct        = totalCount ? Math.round(totalDone / totalCount * 100) : 0;

        /* summary */
        var elDone  = document.getElementById('ms-done');
        var elTotal = document.getElementById('ms-total');
        var elFill  = document.getElementById('ms-fill');
        var elPct   = document.getElementById('ms-pct');
        if (elDone)  elDone.textContent  = totalDone;
        if (elTotal) elTotal.textContent = totalCount;
        if (elFill)  elFill.style.width  = pct + '%';
        if (elPct)   elPct.textContent   = pct + '%';

        /* category sections */
        var container = document.getElementById('ms-container');
        if (!container) return;
        container.innerHTML = CAT_ORDER
            .filter(function (cat) { return bycat[cat] && bycat[cat].length; })
            .map(function (cat) { return renderCategory(cat, bycat[cat]); })
            .join('');
    }

    /* ── fetch + load ───────────────────────────────────────────── */
    function load() {
        var loading = document.getElementById('ms-loading');
        var error   = document.getElementById('ms-error');

        var fetchFn = window._adminAuthFetch || function (url, opts) { return fetch(url, opts || {}); };

        fetchFn('/api/milestones')
            .then(function (res) {
                if (res.status === 401) { window.location.href = '/afterhours/login'; return null; }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data) return;
                if (loading) loading.hidden = true;
                render(data.milestones || []);
            })
            .catch(function (err) {
                console.error('[milestones]', err);
                if (loading) loading.hidden = true;
                if (error)   error.hidden   = false;
            });
    }

    document.addEventListener('DOMContentLoaded', load);
}());
