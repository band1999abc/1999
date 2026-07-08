/**
 * messages-admin.js  v1
 * Client-side logic for /afterhours/messages (Message Management).
 *
 * Views:
 *   mm-list-view   → list of messages + test mode tab
 *   mm-editor-view → create / edit a single message
 */
(function () {
    'use strict';

    if (document.body.dataset.page !== 'afterhours-messages') return;

    // ── DOM refs ──────────────────────────────────────────────────────────────

    // List view
    var listViewEl   = document.getElementById('mm-list-view');
    var searchEl     = document.getElementById('mm-search');
    var sortEl       = document.getElementById('mm-sort');
    var listEl       = document.getElementById('mm-list');
    var addBtn       = document.getElementById('mm-add-btn');
    var backDashBtn  = document.getElementById('mm-back-dash');

    // Tab bar
    var tabListBtn   = document.getElementById('mm-tab-list');
    var tabTestBtn   = document.getElementById('mm-tab-test');
    var tabListCont  = document.getElementById('mm-list-tab');
    var tabTestCont  = document.getElementById('mm-test-tab');

    // Editor view
    var editorViewEl = document.getElementById('mm-editor-view');
    var editorBackBtn= document.getElementById('mm-editor-back');
    var editorHdEl   = document.getElementById('mm-editor-heading');
    var formEl       = document.getElementById('mm-form');
    var jaEl         = document.getElementById('mm-ja');
    var enEl         = document.getElementById('mm-en');
    var enabledEl    = document.getElementById('mm-enabled');
    var enabledLblEl = document.getElementById('mm-enabled-label');
    var prioValEl    = document.getElementById('mm-priority-val');
    var starsRowEl   = document.getElementById('mm-stars-row');
    var saveBtn      = document.getElementById('mm-save-btn');
    var deleteBtn    = document.getElementById('mm-delete-btn');

    // Test mode
    var testSlotEl    = document.getElementById('mm-test-slot');
    var testSeasonEl  = document.getElementById('mm-test-season');
    var testWeatherEl = document.getElementById('mm-test-weather');
    var testRunBtn    = document.getElementById('mm-test-run');
    var testResultsEl = document.getElementById('mm-test-results');

    // ── State ─────────────────────────────────────────────────────────────────
    var allMessages = [];
    var editingId   = null;

    // ── Label maps ────────────────────────────────────────────────────────────
    var SLOT_LABELS    = { dawn:'明け方', morning:'朝', midday:'昼', afternoon:'夕方', evening:'夜', latenight:'深夜' };
    var SEASON_LABELS  = { spring:'春', rainy:'梅雨', summer:'夏', autumn:'秋', winter:'冬' };
    var WEATHER_LABELS = { clear:'晴れ', cloudy:'曇り', rain:'雨', snow:'雪' };
    var SPECIAL_LABELS = { live_today:'ライブ当日', live_tomorrow:'ライブ翌日', new_release:'新曲公開', anniversary:'記念日' };

    // ── Auth fetch ────────────────────────────────────────────────────────────
    function authFetch(url, opts) {
        if (window._adminAuthFetch) return window._adminAuthFetch(url, opts);
        return fetch(url, opts);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showView(view) {
        listViewEl.classList.toggle('da-hidden', view !== 'list');
        editorViewEl.classList.toggle('da-hidden', view !== 'editor');
    }

    function showTab(tab) {
        tabListBtn.classList.toggle('mm-tab--active', tab === 'list');
        tabTestBtn.classList.toggle('mm-tab--active', tab === 'test');
        tabListCont.classList.toggle('da-hidden', tab !== 'list');
        tabTestCont.classList.toggle('da-hidden', tab !== 'test');
    }

    function starsHtml(n) {
        n = Math.max(1, Math.min(5, parseInt(n, 10) || 3));
        var s = '';
        for (var i = 1; i <= 5; i++) s += (i <= n ? '★' : '☆');
        return s;
    }

    function condTagsHtml(c) {
        c = c || {};
        var tags = [];
        (c.timeSlots || []).forEach(function (v) {
            var lbl = SLOT_LABELS[v] || v;
            tags.push('<span class="mm-tag mm-tag--time">' + esc(lbl) + '</span>');
        });
        (c.seasons || []).forEach(function (v) {
            var lbl = SEASON_LABELS[v] || v;
            tags.push('<span class="mm-tag mm-tag--season">' + esc(lbl) + '</span>');
        });
        (c.weather || []).forEach(function (v) {
            var lbl = WEATHER_LABELS[v] || v;
            tags.push('<span class="mm-tag mm-tag--weather">' + esc(lbl) + '</span>');
        });
        (c.special || []).forEach(function (v) {
            var lbl = SPECIAL_LABELS[v] || v;
            tags.push('<span class="mm-tag mm-tag--special">' + esc(lbl) + '</span>');
        });
        if (!tags.length) tags.push('<span class="mm-tag">共通</span>');
        return tags.join('');
    }

    // ── Load & render ─────────────────────────────────────────────────────────
    function loadMessages() {
        authFetch('/api/messages')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                allMessages = Array.isArray(data) ? data : [];
                renderList();
            })
            .catch(function () {
                allMessages = [];
                renderList();
            });
    }

    function renderList() {
        var q    = (searchEl.value || '').toLowerCase().trim();
        var sort = sortEl.value;

        var msgs = allMessages.filter(function (m) {
            if (sort === 'enabled' && !m.enabled) return false;
            if (q && m.ja.toLowerCase().indexOf(q) < 0 &&
                    (m.en || '').toLowerCase().indexOf(q) < 0) return false;
            return true;
        });

        msgs.sort(function (a, b) {
            if (sort === 'priority-desc') return (b.priority || 3) - (a.priority || 3);
            if (sort === 'priority-asc')  return (a.priority || 3) - (b.priority || 3);
            if (sort === 'createdAt-asc') return (a.createdAt || '').localeCompare(b.createdAt || '');
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        if (!msgs.length) {
            var emptyMsg = q
                ? '「' + esc(q) + '」に一致するメッセージはありません。'
                : (allMessages.length ? '有効なメッセージがありません。' : 'メッセージがまだありません。');
            listEl.innerHTML = '<div class="mm-empty">' + emptyMsg + '</div>';
            return;
        }

        listEl.innerHTML = msgs.map(function (m) {
            var dis   = m.enabled ? '' : ' mm-item--disabled';
            var sCls  = m.enabled ? 'mm-status--on' : 'mm-status--off';
            var sTxt  = m.enabled ? '有効' : '無効';
            var prio  = m.priority || 3;
            return '<div class="mm-item' + dis + '" data-id="' + esc(m.id) + '">' +
                '<div class="mm-item-text">「' + esc(m.ja) + '」</div>' +
                '<div class="mm-item-tags">' + condTagsHtml(m.conditions) + '</div>' +
                '<div class="mm-item-meta">' +
                  '<span class="mm-stars-disp">' + starsHtml(prio) + '</span>' +
                  '<span class="mm-status ' + sCls + '">' + sTxt + '</span>' +
                '</div>' +
                '<div class="mm-item-actions">' +
                  '<button class="mm-action-btn" data-action="edit" data-id="' + esc(m.id) + '">編集</button>' +
                  '<button class="mm-action-btn" data-action="dup"  data-id="' + esc(m.id) + '">複製</button>' +
                  '<button class="mm-action-btn mm-action-btn--danger" data-action="del" data-id="' + esc(m.id) + '">削除</button>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    // ── Editor ────────────────────────────────────────────────────────────────
    function openEditor(msg) {
        editingId = msg ? msg.id : null;
        editorHdEl.textContent = msg ? '編集' : '新しいメッセージ';

        // Show/hide delete button
        deleteBtn.classList.toggle('da-hidden', !msg);

        // Populate fields
        jaEl.value      = msg ? msg.ja  : '';
        enEl.value      = msg ? (msg.en || '') : '';
        enabledEl.checked = msg ? msg.enabled !== false : true;
        updateEnabledLabel();

        // Priority
        var prio = msg ? (msg.priority || 3) : 3;
        prioValEl.value = String(prio);
        renderStarBtns(prio);

        // Conditions
        var c = msg ? (msg.conditions || {}) : {};
        ['timeSlots', 'seasons', 'weather', 'special'].forEach(function (grp) {
            var vals = Array.isArray(c[grp]) ? c[grp] : [];
            formEl.querySelectorAll('input[name="' + grp + '"]').forEach(function (cb) {
                cb.checked = vals.indexOf(cb.value) >= 0;
            });
        });

        showView('editor');
        jaEl.focus();
    }

    function renderStarBtns(n) {
        n = Math.max(1, Math.min(5, parseInt(n, 10) || 3));
        starsRowEl.querySelectorAll('.mm-star-btn').forEach(function (btn) {
            var v = parseInt(btn.dataset.val, 10);
            btn.classList.toggle('is-lit', v <= n);
        });
    }

    function updateEnabledLabel() {
        if (enabledLblEl) enabledLblEl.textContent = enabledEl.checked ? '有効' : '無効';
    }

    function getConditions() {
        var c = { timeSlots: [], seasons: [], weather: [], special: [] };
        Object.keys(c).forEach(function (grp) {
            formEl.querySelectorAll('input[name="' + grp + '"]:checked').forEach(function (cb) {
                c[grp].push(cb.value);
            });
        });
        return c;
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    function saveMessage() {
        var ja = jaEl.value.trim();
        if (!ja) {
            jaEl.focus();
            jaEl.style.borderBottomColor = '#b07060';
            return;
        }
        jaEl.style.borderBottomColor = '';

        var payload = {
            ja:         ja,
            en:         (enEl.value || '').trim(),
            enabled:    enabledEl.checked,
            priority:   parseInt(prioValEl.value, 10) || 3,
            conditions: getConditions(),
        };

        var url    = editingId ? ('/api/messages/' + editingId) : '/api/messages';
        var method = editingId ? 'PUT' : 'POST';

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        authFetch(url, {
            method:  method,
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        })
        .then(function (r) {
            return r.ok ? r.json() : r.json().then(function (e) { return Promise.reject(e); });
        })
        .then(function (saved) {
            if (editingId) {
                var idx = allMessages.findIndex(function (m) { return m.id === editingId; });
                if (idx >= 0) allMessages[idx] = saved; else allMessages.push(saved);
            } else {
                allMessages.push(saved);
            }
            renderList();
            showView('list');
        })
        .catch(function (err) {
            alert((err && err.error) || '保存に失敗しました。');
        })
        .finally(function () {
            saveBtn.disabled = false;
            saveBtn.textContent = '保存';
        });
    }

    // ── Delete ────────────────────────────────────────────────────────────────
    function deleteMessage(id) {
        var msg = allMessages.find(function (m) { return m.id === id; });
        var txt = msg ? '「' + msg.ja.slice(0, 30) + (msg.ja.length > 30 ? '…' : '') + '」を削除しますか？' : 'このメッセージを削除しますか？';
        if (!confirm(txt)) return;

        authFetch('/api/messages/' + id, { method: 'DELETE' })
            .then(function (r) {
                return r.ok ? r.json() : r.json().then(function (e) { return Promise.reject(e); });
            })
            .then(function () {
                allMessages = allMessages.filter(function (m) { return m.id !== id; });
                renderList();
                if (editorViewEl && !editorViewEl.classList.contains('da-hidden')) showView('list');
            })
            .catch(function (err) { alert((err && err.error) || '削除に失敗しました。'); });
    }

    // ── Duplicate ─────────────────────────────────────────────────────────────
    function duplicateMessage(id) {
        var src = allMessages.find(function (m) { return m.id === id; });
        if (!src) return;

        var dup = {
            ja:         src.ja + '（複製）',
            en:         src.en || '',
            enabled:    false,
            priority:   src.priority || 3,
            conditions: JSON.parse(JSON.stringify(src.conditions || {})),
        };

        authFetch('/api/messages', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(dup),
        })
        .then(function (r) {
            return r.ok ? r.json() : r.json().then(function (e) { return Promise.reject(e); });
        })
        .then(function (newMsg) {
            allMessages.push(newMsg);
            renderList();
            openEditor(newMsg);
        })
        .catch(function (err) { alert((err && err.error) || '複製に失敗しました。'); });
    }

    // ── Test mode ─────────────────────────────────────────────────────────────
    function runTest() {
        var slot    = testSlotEl.value;
        var season  = testSeasonEl.value;
        var weather = testWeatherEl.value;
        var special = [];
        if (document.getElementById('mm-test-live-today').checked)    special.push('live_today');
        if (document.getElementById('mm-test-live-tomorrow').checked)  special.push('live_tomorrow');
        if (document.getElementById('mm-test-new-release').checked)    special.push('new_release');
        if (document.getElementById('mm-test-anniversary').checked)    special.push('anniversary');

        var matched = allMessages.filter(function (m) {
            var c = m.conditions || {};

            // Time slot: if set, tSlot must be in the list
            if (c.timeSlots && c.timeSlots.length && slot && c.timeSlots.indexOf(slot) < 0) return false;

            // Season: if set, season must match
            if (c.seasons && c.seasons.length && season && c.seasons.indexOf(season) < 0) return false;

            // Weather: if conditions set AND a specific weather is selected, must match.
            // Unselected weather (= '') means "any" — consistent with slot/season behavior.
            if (c.weather && c.weather.length && weather && c.weather.indexOf(weather) < 0) return false;

            // Special: if set, at least one must be active
            if (c.special && c.special.length) {
                var anyMatch = c.special.some(function (s) { return special.indexOf(s) >= 0; });
                if (!anyMatch) return false;
            }

            return true;
        });

        if (!matched.length) {
            testResultsEl.innerHTML = '<div class="mm-test-none">この条件に一致するカスタムメッセージはありません。</div>';
            return;
        }

        var enabledCount   = matched.filter(function (m) { return m.enabled; }).length;
        var disabledCount  = matched.length - enabledCount;
        var summary = enabledCount + '件が表示候補';
        if (disabledCount) summary += '（無効 ' + disabledCount + '件を含む）';

        testResultsEl.innerHTML =
            '<div class="mm-test-results-hd">' + summary + '</div>' +
            matched.map(function (m) {
                var offCls = m.enabled ? '' : ' mm-test-result-item--off';
                return '<div class="mm-test-result-item' + offCls + '">' +
                    '<div class="mm-test-result-text">「' + esc(m.ja) + '」</div>' +
                    '<div class="mm-test-result-meta">' +
                      '<span class="mm-stars-disp">' + starsHtml(m.priority) + '</span>' +
                      '<span>' + (m.enabled ? '有効' : '無効') + '</span>' +
                      '<span>優先度 ' + (m.priority || 3) + '</span>' +
                    '</div>' +
                    '</div>';
            }).join('');
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    // Back to dashboard
    if (backDashBtn) backDashBtn.addEventListener('click', function () {
        window.location.href = '/afterhours';
    });

    // Search & sort
    if (searchEl) searchEl.addEventListener('input', renderList);
    if (sortEl)   sortEl.addEventListener('change', renderList);

    // New message
    if (addBtn) addBtn.addEventListener('click', function () { openEditor(null); });

    // Tabs
    if (tabListBtn) tabListBtn.addEventListener('click', function () { showTab('list'); });
    if (tabTestBtn) tabTestBtn.addEventListener('click', function () { showTab('test'); });

    // Editor back
    if (editorBackBtn) editorBackBtn.addEventListener('click', function () { showView('list'); });

    // Priority stars
    if (starsRowEl) starsRowEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.mm-star-btn');
        if (!btn) return;
        var n = parseInt(btn.dataset.val, 10);
        prioValEl.value = String(n);
        renderStarBtns(n);
    });

    // Enabled toggle label
    if (enabledEl) enabledEl.addEventListener('change', updateEnabledLabel);

    // Form submit
    if (formEl) formEl.addEventListener('submit', function (e) { e.preventDefault(); saveMessage(); });

    // Delete button
    if (deleteBtn) deleteBtn.addEventListener('click', function () {
        if (editingId) deleteMessage(editingId);
    });

    // List delegation (edit / dup / del)
    if (listEl) listEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var id     = btn.dataset.id;
        if (action === 'edit') {
            var msg = allMessages.find(function (m) { return m.id === id; });
            if (msg) openEditor(msg);
        } else if (action === 'dup') {
            duplicateMessage(id);
        } else if (action === 'del') {
            deleteMessage(id);
        }
    });

    // Test run
    if (testRunBtn) testRunBtn.addEventListener('click', runTest);

    // ── Init ──────────────────────────────────────────────────────────────────
    loadMessages();
    showView('list');
    showTab('list');

})();
