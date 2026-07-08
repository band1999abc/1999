/**
 * insights.js  —  client-side renderer for /afterhours/insights
 *
 * Fetches GET /api/insights and renders all six sections.
 * All text is server-generated (rule-based now; AI-swappable later).
 */
(function () {
    'use strict';

    /* ── Utilities ─────────────────────────────────────────────── */

    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }

    /** ISO → 「2026年3月15日」 in JST */
    function fmtDate(iso) {
        if (!iso) return '';
        var s = iso;
        if (s.length >= 16 && !s.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(s)) s += 'Z';
        var d = new Date(s);
        if (isNaN(d.getTime())) return iso.slice(0, 10);
        var j = new Date(d.getTime() + 9 * 3600000);
        return j.getUTCFullYear() + '年' + (j.getUTCMonth() + 1) + '月' + j.getUTCDate() + '日';
    }

    /** ISO date string → 「M月D日」 */
    function fmtShort(dateStr) {
        if (!dateStr) return '';
        var parts = dateStr.slice(0, 10).split('-');
        return parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
    }

    function changePill(pct) {
        if (pct === null || pct === undefined) return '';
        var cls  = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
        var sign = pct > 0 ? '+' : '';
        return '<span class="ins-pill ins-pill--' + cls + '">' + sign + pct + '%</span>';
    }

    /* ── Section renderers ─────────────────────────────────────── */

    function renderToday(data) {
        if (!data || !data.insights || !data.insights.length) return '';
        var rows = data.insights.map(function (ins) {
            return '<li class="ins-insight ins-insight--' + esc(ins.level) + '">'
                 + '<span class="ins-insight-icon" aria-hidden="true">' + esc(ins.icon) + '</span>'
                 + '<span class="ins-insight-text">' + esc(ins.text) + '</span>'
                 + '</li>';
        }).join('');
        return '<section class="ins-section" id="ins-today">'
             + '<h2 class="ins-section-title">Today\'s Insights'
             + '<span class="ins-section-date">' + esc(fmtDate(data.date)) + '</span></h2>'
             + '<ul class="ins-insight-list">' + rows + '</ul>'
             + '</section>';
    }

    function renderWeekly(data) {
        if (!data || !data.metrics) return '';
        var period = data.period
            ? esc(fmtShort(data.period.start)) + ' 〜 ' + esc(fmtShort(data.period.end))
            : '';
        var cards = data.metrics.map(function (m) {
            return '<div class="ins-metric-card">'
                 + '<div class="ins-metric-header">'
                 + '<span class="ins-metric-icon">' + esc(m.icon) + '</span>'
                 + '<span class="ins-metric-label">' + esc(m.label) + '</span>'
                 + '</div>'
                 + '<div class="ins-metric-value">' + m.value.toLocaleString() + '</div>'
                 + '<div class="ins-metric-footer">'
                 + changePill(m.changePct)
                 + '<span class="ins-metric-prev">先週 ' + m.prev.toLocaleString() + '</span>'
                 + '</div>'
                 + '</div>';
        }).join('');
        return '<section class="ins-section" id="ins-weekly">'
             + '<h2 class="ins-section-title">Weekly Summary'
             + (period ? '<span class="ins-section-date">' + period + '</span>' : '')
             + '</h2>'
             + '<div class="ins-metric-grid">' + cards + '</div>'
             + '</section>';
    }

    function renderMonthly(data) {
        if (!data) return '';
        var label = data.period ? data.period.replace('-', '年') + '月' : '';
        return '<section class="ins-section" id="ins-monthly">'
             + '<h2 class="ins-section-title">Monthly Story'
             + (label ? '<span class="ins-section-date">' + esc(label) + '</span>' : '')
             + '</h2>'
             + '<p class="ins-story">' + esc(data.story || '') + '</p>'
             + '</section>';
    }

    function renderAchievements(list) {
        if (!list || !list.length) return '';
        var items = list.map(function (a) {
            return '<div class="ins-ach-item">'
                 + '<span class="ins-ach-icon">' + esc(a.icon) + '</span>'
                 + '<span class="ins-ach-label">' + esc(a.label) + '</span>'
                 + '<span class="ins-ach-date">' + esc(fmtDate(a.achievedAt)) + '</span>'
                 + '</div>';
        }).join('');
        return '<section class="ins-section" id="ins-ach">'
             + '<h2 class="ins-section-title">Achievements</h2>'
             + '<div class="ins-ach-list">' + items + '</div>'
             + '</section>';
    }

    function renderRecommendations(list) {
        if (!list || !list.length) return '';
        var items = list.map(function (r) {
            return '<li class="ins-rec-item">'
                 + '<span class="ins-rec-icon" aria-hidden="true">' + esc(r.icon) + '</span>'
                 + '<span class="ins-rec-text">' + esc(r.text) + '</span>'
                 + '</li>';
        }).join('');
        return '<section class="ins-section" id="ins-recs">'
             + '<h2 class="ins-section-title">Recommendations</h2>'
             + '<ul class="ins-rec-list">' + items + '</ul>'
             + '</section>';
    }

    function renderTimeline(list) {
        if (!list || !list.length) return '';
        var items = list.map(function (item) {
            return '<li class="ins-tl-item ins-tl-item--' + esc(item.type) + '">'
                 + '<div class="ins-tl-dot" aria-hidden="true">' + esc(item.icon) + '</div>'
                 + '<div class="ins-tl-body">'
                 + '<span class="ins-tl-label">' + esc(item.label) + '</span>'
                 + '<span class="ins-tl-title">' + esc(item.title) + '</span>'
                 + '<span class="ins-tl-date">' + esc(fmtShort(item.date)) + '</span>'
                 + '</div>'
                 + '</li>';
        }).join('');
        return '<section class="ins-section" id="ins-tl">'
             + '<h2 class="ins-section-title">Timeline</h2>'
             + '<ul class="ins-tl-list" role="list">' + items + '</ul>'
             + '</section>';
    }

    /* ── Main render ────────────────────────────────────────────── */

    function render(d) {
        var container = document.getElementById('ins-container');
        if (!container) return;

        var html = [
            renderToday(d.today),
            renderWeekly(d.weekly),
            renderMonthly(d.monthly),
            d.achievements && d.achievements.length ? renderAchievements(d.achievements) : '',
            renderRecommendations(d.recommendations),
            renderTimeline(d.timeline),
        ].join('');

        container.innerHTML = html || '<p class="ins-empty">データがありません。</p>';
    }

    /* ── Fetch & load ───────────────────────────────────────────── */

    function load() {
        var loading = document.getElementById('ins-loading');
        var error   = document.getElementById('ins-error');
        var fetchFn = window._adminAuthFetch || function (u) { return fetch(u); };

        fetchFn('/api/insights')
            .then(function (res) {
                if (res.status === 401) { window.location.href = '/afterhours/login'; return null; }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data) return;
                if (loading) loading.hidden = true;
                render(data);
            })
            .catch(function (err) {
                console.error('[insights]', err);
                if (loading) loading.hidden = true;
                if (error)   error.hidden   = false;
            });
    }

    document.addEventListener('DOMContentLoaded', load);
}());
