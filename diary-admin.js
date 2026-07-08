/**
 * diary-admin.js  v2
 * Client-side logic for /afterhours/diary (admin diary management).
 * Supports scheduled publishing (status: 'scheduled', scheduledAt: 'YYYY-MM-DDTHH:MM').
 */
(function () {
    'use strict';

    if (document.body.dataset.page !== 'afterhours-diary') return;

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const countEl      = document.getElementById('da-count');
    const listEl       = document.getElementById('da-list');
    const headingEl    = document.getElementById('da-editor-heading');
    const formEl       = document.getElementById('da-form');
    const titleEl      = document.getElementById('da-title');
    const bodyEl       = document.getElementById('da-body');
    const dateEl       = document.getElementById('da-date');
    const schedWrapEl  = document.getElementById('da-scheduled-wrap');
    const schedAtEl    = document.getElementById('da-scheduled-at');
    const saveBtn      = document.getElementById('da-save');
    const publishBtn   = document.getElementById('da-publish');
    const deleteBtn    = document.getElementById('da-delete');
    const newBtn       = document.getElementById('da-new');

    // ── State ─────────────────────────────────────────────────────────────────
    let allPosts  = [];    // cached full list (all statuses)
    let editingId = null;  // null = creating new

    // ── Helpers ───────────────────────────────────────────────────────────────

    function todayIso() {
        const d   = new Date();
        const y   = d.getFullYear();
        const m   = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /** Current JST datetime as 'YYYY-MM-DDTHH:MM'. */
    function nowJSTLocal() {
        const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
        return d.toISOString().slice(0, 16);
    }

    /** Default scheduledAt: tomorrow noon JST ('YYYY-MM-DDTHH:MM').
     *  Using "now" as default caused instant auto-promotion on save. */
    function defaultSchedAt() {
        const d = new Date(Date.now() + 9 * 60 * 60 * 1000); // JST now
        d.setUTCDate(d.getUTCDate() + 1);                    // +1 day
        d.setUTCHours(12, 0, 0, 0);                          // noon JST
        return d.toISOString().slice(0, 16);
    }

    // YYYY-MM-DD → YYYY.MM.DD
    function fmtDate(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
        return iso.replace(/-/g, '.');
    }

    // YYYY-MM-DDTHH:MM → YYYY.MM.DD HH:MM
    function fmtDateTime(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) return '';
        const [date, time] = iso.split('T');
        return `${date.replace(/-/g, '.')} ${time}`;
    }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pubModeValue() {
        const el = formEl.querySelector('input[name="da-pub-mode"]:checked');
        return el ? el.value : 'draft';
    }

    function setPubMode(val) {
        const el = formEl.querySelector(`input[name="da-pub-mode"][value="${val}"]`);
        if (el) el.checked = true;
        toggleSchedWrap(val);
    }

    function toggleSchedWrap(mode) {
        if (!schedWrapEl) return;
        const showing = mode === 'scheduled';
        schedWrapEl.classList.toggle('da-hidden', !showing);
        if (showing && schedAtEl) {
            // Keep min current so past times are visually blocked
            schedAtEl.min = nowJSTLocal();
            // Auto-fill with a sensible future default if empty
            if (!schedAtEl.value) schedAtEl.value = defaultSchedAt();
        }
    }

    // ── Pub-mode radio → show/hide datetime picker ─────────────────────────
    formEl.querySelectorAll('input[name="da-pub-mode"]').forEach(radio => {
        radio.addEventListener('change', () => toggleSchedWrap(radio.value));
    });

    // ── Render list ───────────────────────────────────────────────────────────

    function renderList() {
        const n = allPosts.length;
        countEl.textContent = n === 0 ? '' : `${n} 件`;

        if (n === 0) {
            listEl.innerHTML = '<p class="da-empty">まだ投稿がありません</p>';
            return;
        }

        listEl.innerHTML = allPosts.map(p => {
            const active    = p.id === editingId ? ' is-active' : '';
            const dotClass  = p.status === 'published'  ? ' is-published'
                            : p.status === 'scheduled'  ? ' is-scheduled'
                            : '';
            const badge     = p.status === 'published'
                ? '<span class="da-badge da-badge--published">公開中</span>'
                : p.status === 'scheduled'
                ? '<span class="da-badge da-badge--scheduled">予約中</span>'
                : '<span class="da-badge da-badge--draft">下書き</span>';
            return `
            <div class="da-item${active}" data-id="${esc(p.id)}">
                <span class="da-dot${dotClass}"></span>
                <span class="da-item-date"></span>
                <span class="da-item-title"></span>
                ${badge}
            </div>`;
        }).join('');

        // Fill via textContent (XSS-safe)
        listEl.querySelectorAll('.da-item').forEach((el, i) => {
            const p = allPosts[i];
            // Show scheduled datetime in date column if scheduled
            el.querySelector('.da-item-date').textContent =
                p.status === 'scheduled' && p.scheduledAt
                    ? fmtDateTime(p.scheduledAt)
                    : fmtDate(p.date);

            const titleEl2 = el.querySelector('.da-item-title');
            if (p.title) {
                titleEl2.textContent = p.title;
            } else {
                const span = document.createElement('span');
                span.className   = 'da-notitle';
                span.textContent = '（タイトルなし）';
                titleEl2.appendChild(span);
            }
            el.addEventListener('click', () => selectPost(el.dataset.id));
        });
    }

    // ── Select / clear editor ─────────────────────────────────────────────────

    function selectPost(id) {
        const post = allPosts.find(p => p.id === id);
        if (!post) return;
        editingId       = id;
        headingEl.textContent = '編集';
        titleEl.value   = post.title       || '';
        bodyEl.value    = post.body        || '';
        dateEl.value    = post.date        || todayIso();
        // Restore pub-mode radio and scheduled datetime
        const mode = post.status === 'published' || post.status === 'scheduled' || post.status === 'draft'
            ? post.status : 'draft';
        setPubMode(mode);
        if (schedAtEl) {
            schedAtEl.min   = nowJSTLocal();
            // Use saved scheduledAt, or default to tomorrow noon (never "now")
            schedAtEl.value = post.scheduledAt || defaultSchedAt();
        }
        deleteBtn.classList.remove('da-hidden');
        renderList();
        formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        titleEl.focus();
    }

    function clearEditor() {
        editingId = null;
        headingEl.textContent = '新規投稿';
        titleEl.value = '';
        bodyEl.value  = '';
        dateEl.value  = todayIso();
        setPubMode('draft');
        if (schedAtEl) schedAtEl.value = '';
        deleteBtn.classList.add('da-hidden');
        renderList();
        titleEl.focus();
    }

    // ── Auth-aware fetch helper ───────────────────────────────────────────────

    function authFetch(url, opts) {
        if (window._adminAuthFetch) return window._adminAuthFetch(url, opts);
        const token = sessionStorage.getItem('admin_token') || '';
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {});
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, opts);
    }

    // ── API calls ─────────────────────────────────────────────────────────────

    async function loadPosts() {
        try {
            const res = await authFetch('/api/diary');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            allPosts = await res.json();
            renderList();
        } catch (e) {
            console.error('[diary-admin] loadPosts:', e);
            listEl.innerHTML = '<p class="da-empty">読み込みに失敗しました</p>';
        }
    }

    function setBusy(busy) {
        saveBtn.disabled    = busy;
        publishBtn.disabled = busy;
        deleteBtn.disabled  = busy;
    }

    /**
     * Save or update the current post.
     * @param {string|null} forcedStatus  'published' to override radio (今すぐ公開 button).
     */
    async function savePost(forcedStatus) {
        const title  = titleEl.value.trim();
        const body   = bodyEl.value.trim();
        const date   = dateEl.value || todayIso();
        const mode   = forcedStatus || pubModeValue();  // 'published'|'scheduled'|'draft'

        // Build payload
        const payload = { title, body, date, status: mode };
        if (mode === 'scheduled') {
            const at = schedAtEl ? schedAtEl.value : '';
            if (!at) {
                alert('公開日時を入力してください。');
                schedAtEl && schedAtEl.focus();
                return;
            }
            if (at <= nowJSTLocal()) {
                alert('公開日時は現在より未来の日時を入力してください。');
                schedAtEl && schedAtEl.focus();
                return;
            }
            payload.scheduledAt = at;
        } else {
            payload.scheduledAt = '';
        }

        const url    = editingId ? `/api/diary/${editingId}` : '/api/diary';
        const method = editingId ? 'PUT' : 'POST';

        setBusy(true);
        try {
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const saved = await res.json();

            if (editingId) {
                allPosts = allPosts.map(p => p.id === editingId ? saved : p);
            } else {
                allPosts = [saved, ...allPosts];
                editingId = saved.id;
            }

            // Reflect saved values back to form
            titleEl.value = saved.title || '';
            bodyEl.value  = saved.body  || '';
            dateEl.value  = saved.date  || todayIso();
            const savedMode = saved.status || 'draft';
            setPubMode(savedMode);
            if (schedAtEl) schedAtEl.value = saved.scheduledAt || '';
            headingEl.textContent   = '編集';
            deleteBtn.classList.remove('da-hidden');
            renderList();

        } catch (e) {
            console.error('[diary-admin] savePost:', e);
            alert('保存に失敗しました。もう一度お試しください。');
        } finally {
            setBusy(false);
        }
    }

    async function deletePost() {
        if (!editingId) return;
        const post  = allPosts.find(p => p.id === editingId);
        const label = (post && post.title) ? `「${post.title}」` : 'この投稿';
        if (!confirm(`${label}を削除しますか？この操作は取り消せません。`)) return;

        setBusy(true);
        try {
            const res = await authFetch(`/api/diary/${editingId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            allPosts = allPosts.filter(p => p.id !== editingId);
            clearEditor();
        } catch (e) {
            console.error('[diary-admin] deletePost:', e);
            alert('削除に失敗しました。もう一度お試しください。');
        } finally {
            setBusy(false);
        }
    }

    // ── Event bindings ────────────────────────────────────────────────────────

    newBtn.addEventListener('click', clearEditor);
    saveBtn.addEventListener('click',    () => savePost(null));        // respect radio
    publishBtn.addEventListener('click', () => savePost('published')); // 今すぐ公開
    deleteBtn.addEventListener('click', deletePost);

    // Prevent accidental form submit (Enter key)
    formEl.addEventListener('submit', e => e.preventDefault());

    // ── Init ──────────────────────────────────────────────────────────────────
    clearEditor();
    loadPosts();

}());
