/**
 * diary-admin.js
 * Client-side logic for /afterhours/diary (admin diary management).
 * Only runs when data-page="afterhours-diary".
 */
(function () {
    'use strict';

    if (document.body.dataset.page !== 'afterhours-diary') return;

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const countEl    = document.getElementById('da-count');
    const listEl     = document.getElementById('da-list');
    const headingEl  = document.getElementById('da-editor-heading');
    const formEl     = document.getElementById('da-form');
    const titleEl    = document.getElementById('da-title');
    const bodyEl     = document.getElementById('da-body');
    const dateEl     = document.getElementById('da-date');
    const saveBtn    = document.getElementById('da-save');
    const publishBtn = document.getElementById('da-publish');
    const deleteBtn  = document.getElementById('da-delete');
    const newBtn     = document.getElementById('da-new');

    // ── State ─────────────────────────────────────────────────────────────────
    let allPosts   = [];   // cached full list (published + draft)
    let editingId  = null; // null = creating new

    // ── Helpers ───────────────────────────────────────────────────────────────

    function todayIso() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    // YYYY-MM-DD → YYYY.MM.DD  (validates format first)
    function fmtDate(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
        return iso.replace(/-/g, '.');
    }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function statusRadioValue() {
        const el = formEl.querySelector('input[name="da-status"]:checked');
        return el ? el.value : 'draft';
    }

    function setStatusRadio(val) {
        const el = formEl.querySelector(`input[name="da-status"][value="${val}"]`);
        if (el) el.checked = true;
    }

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
            const published = p.status === 'published';
            const dotClass  = published ? ' is-published' : '';
            // Escape id for data attribute; use textContent for displayed text via DOM
            return `
            <div class="da-item${active}" data-id="${esc(p.id)}">
                <span class="da-dot${dotClass}" title="${published ? '公開' : '下書き'}"></span>
                <span class="da-item-date"></span>
                <span class="da-item-title"></span>
            </div>`;
        }).join('');

        // Fill date/title via textContent (XSS-safe)
        listEl.querySelectorAll('.da-item').forEach((el, i) => {
            const p = allPosts[i];
            el.querySelector('.da-item-date').textContent  = fmtDate(p.date);
            const titleEl2 = el.querySelector('.da-item-title');
            if (p.title) {
                titleEl2.textContent = p.title;
            } else {
                const span = document.createElement('span');
                span.className = 'da-notitle';
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
        editingId = id;
        headingEl.textContent = '編集';
        titleEl.value = post.title || '';
        bodyEl.value  = post.body  || '';
        dateEl.value  = post.date  || todayIso();
        setStatusRadio(post.status || 'draft');
        deleteBtn.style.display = '';
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
        setStatusRadio('draft');
        deleteBtn.style.display = 'none';
        renderList();
        titleEl.focus();
    }

    // ── Auth-aware fetch helper ───────────────────────────────────────────────

    function authFetch(url, opts) {
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

    async function savePost(forcedStatus) {
        const title  = titleEl.value.trim();
        const body   = bodyEl.value.trim();
        const date   = dateEl.value || todayIso();
        const status = forcedStatus || statusRadioValue();

        const payload = { title, body, date, status };
        const url     = editingId ? `/api/diary/${editingId}` : '/api/diary';
        const method  = editingId ? 'PUT' : 'POST';

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

            // reflect saved values back to form
            titleEl.value = saved.title || '';
            bodyEl.value  = saved.body  || '';
            dateEl.value  = saved.date  || todayIso();
            setStatusRadio(saved.status || 'draft');
            headingEl.textContent   = '編集';
            deleteBtn.style.display = '';
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
    saveBtn.addEventListener('click', () => savePost(null));      // keep current status
    publishBtn.addEventListener('click', () => savePost('published'));
    deleteBtn.addEventListener('click', deletePost);

    // Prevent accidental form submit (Enter key)
    formEl.addEventListener('submit', e => e.preventDefault());

    // ── Init ──────────────────────────────────────────────────────────────────
    clearEditor();
    loadPosts();

}());
