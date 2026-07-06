/**
 * live-admin.js
 * Client-side logic for /afterhours/live (admin live management).
 * Only runs when data-page="afterhours-live".
 */
(function () {
    'use strict';

    if (document.body.dataset.page !== 'afterhours-live') return;

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const countEl       = document.getElementById('la-count');
    const listEl        = document.getElementById('la-list');
    const headingEl     = document.getElementById('la-editor-heading');
    const formEl        = document.getElementById('la-form');
    const dateEl        = document.getElementById('la-date');
    const venueEl       = document.getElementById('la-venue');
    const openEl        = document.getElementById('la-open');
    const startEl       = document.getElementById('la-start');
    const ticketEl      = document.getElementById('la-ticket');
    const saveBtn       = document.getElementById('la-save');
    const publishBtn    = document.getElementById('la-publish');
    const deleteBtn     = document.getElementById('la-delete');
    const newBtn        = document.getElementById('la-new');

    // Flyer elements
    const flyerPreviewEl  = document.getElementById('la-flyer-preview');
    const flyerFileEl     = document.getElementById('la-flyer-file');
    const flyerSelectBtn  = document.getElementById('la-flyer-select');
    const flyerRemoveBtn  = document.getElementById('la-flyer-remove');
    const flyerEmptyEl    = document.getElementById('la-flyer-empty');

    // ── State ─────────────────────────────────────────────────────────────────
    let allLives         = [];   // sorted by sort_order
    let editingId        = null;
    let pendingFlyerFile = null; // File object waiting to be uploaded after save
    let pendingFlyerDel  = false; // whether to DELETE existing flyer on save

    // ── Helpers ───────────────────────────────────────────────────────────────

    function todayIso() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function fmtDate(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
        return iso.replace(/-/g, '.');
    }

    function statusRadioValue() {
        const el = formEl.querySelector('input[name="la-status"]:checked');
        return el ? el.value : 'draft';
    }

    function setStatusRadio(val) {
        const el = formEl.querySelector(`input[name="la-status"][value="${val}"]`);
        if (el) el.checked = true;
    }

    // Normalize sort_order to 0, 1, 2, ... after load or reorder
    function normalize(lives) {
        return lives.map((l, i) => ({ ...l, sort_order: i }));
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

    // ── Flyer UI helpers ──────────────────────────────────────────────────────

    // Show flyer preview (from URL or data URL)
    function showFlyerPreview(src) {
        flyerPreviewEl.src = src;
        flyerPreviewEl.classList.remove('la-hidden');
        flyerEmptyEl.classList.add('la-hidden');
        flyerRemoveBtn.classList.remove('la-hidden');
    }

    // Hide flyer preview (no flyer state)
    function hideFlyerPreview() {
        flyerPreviewEl.classList.add('la-hidden');
        flyerPreviewEl.src = '';
        flyerEmptyEl.classList.remove('la-hidden');
        flyerRemoveBtn.classList.add('la-hidden');
    }

    // Reset flyer section completely (new entry)
    function resetFlyer() {
        pendingFlyerFile = null;
        pendingFlyerDel  = false;
        flyerFileEl.value = '';
        hideFlyerPreview();
    }

    // When user selects a file
    flyerFileEl.addEventListener('change', function () {
        const file = flyerFileEl.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('画像ファイルを選択してください。');
            flyerFileEl.value = '';
            return;
        }

        // 5MB hard limit on file size before encoding
        if (file.size > 5 * 1024 * 1024) {
            alert('ファイルサイズが大きすぎます（5MB以下にしてください）。');
            flyerFileEl.value = '';
            return;
        }

        pendingFlyerFile = file;
        pendingFlyerDel  = false;

        // Show local preview
        const reader = new FileReader();
        reader.onload = function (e) {
            showFlyerPreview(e.target.result);
        };
        reader.readAsDataURL(file);
    });

    // "画像を選択" button triggers the hidden file input
    flyerSelectBtn.addEventListener('click', function () {
        flyerFileEl.click();
    });

    // "フライヤーを削除" button
    flyerRemoveBtn.addEventListener('click', function () {
        if (!confirm('フライヤー画像を削除しますか？')) return;
        pendingFlyerDel  = true;
        pendingFlyerFile = null;
        flyerFileEl.value = '';
        hideFlyerPreview();
    });

    // ── Upload flyer after live save ──────────────────────────────────────────
    function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload  = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async function syncFlyer(liveId) {
        // If pending delete: remove flyer from server
        if (pendingFlyerDel) {
            const res = await authFetch('/api/flyer/' + liveId, { method: 'DELETE' });
            if (!res.ok) throw new Error('DELETE /api/flyer failed: HTTP ' + res.status);
            pendingFlyerDel = false;
            return false; // no flyer
        }

        // If pending upload: upload new flyer
        if (pendingFlyerFile) {
            const dataUrl = await fileToDataUrl(pendingFlyerFile);
            const res = await authFetch('/api/flyer/' + liveId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl })
            });
            if (!res.ok) throw new Error('PUT /api/flyer failed: HTTP ' + res.status);
            pendingFlyerFile = null;
            flyerFileEl.value = '';
            return true; // has flyer
        }

        return null; // no change
    }

    // ── Render list ───────────────────────────────────────────────────────────
    function renderList() {
        const n = allLives.length;
        countEl.textContent = n === 0 ? '' : `${n} 件`;

        if (n === 0) {
            listEl.innerHTML = '<p class="la-empty">まだライブがありません</p>';
            return;
        }

        listEl.innerHTML = '';
        allLives.forEach((live, i) => {
            const row = document.createElement('div');
            row.className = 'la-item' + (live.id === editingId ? ' is-active' : '');

            const dot = document.createElement('span');
            dot.className = 'la-dot' + (live.status === 'published' ? ' is-published' : '');
            dot.title = live.status === 'published' ? '公開' : '下書き';
            row.appendChild(dot);

            const dateSpan = document.createElement('span');
            dateSpan.className = 'la-item-date';
            dateSpan.textContent = fmtDate(live.date);
            row.appendChild(dateSpan);

            const venueSpan = document.createElement('span');
            venueSpan.className = 'la-item-venue';
            venueSpan.textContent = live.venue || '（会場未設定）';
            row.appendChild(venueSpan);

            // Flyer indicator
            if (live.flyer) {
                const fi = document.createElement('span');
                fi.className = 'la-flyer-badge';
                fi.title = 'フライヤーあり';
                fi.textContent = '🖼';
                row.appendChild(fi);
            }

            // ↑↓ reorder buttons
            const btns = document.createElement('span');
            btns.className = 'la-order-btns';

            const upBtn = document.createElement('button');
            upBtn.className = 'la-order-btn';
            upBtn.type = 'button';
            upBtn.textContent = '↑';
            upBtn.disabled = i === 0;
            upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveItem(i, -1); });
            btns.appendChild(upBtn);

            const downBtn = document.createElement('button');
            downBtn.className = 'la-order-btn';
            downBtn.type = 'button';
            downBtn.textContent = '↓';
            downBtn.disabled = i === allLives.length - 1;
            downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveItem(i, 1); });
            btns.appendChild(downBtn);

            row.appendChild(btns);

            row.addEventListener('click', () => selectLive(live.id));
            listEl.appendChild(row);
        });
    }

    // ── Reorder (move item up or down) ────────────────────────────────────────
    async function moveItem(idx, dir) {
        const target = idx + dir;
        if (target < 0 || target >= allLives.length) return;

        // Snapshot for rollback
        const snapshot = allLives.map(l => ({ ...l }));

        // Swap in local array and reassign sort_order
        [allLives[idx], allLives[target]] = [allLives[target], allLives[idx]];
        allLives = normalize(allLives);
        renderList();

        // Persist both swapped items
        const a = allLives[idx];
        const b = allLives[target];
        try {
            const [ra, rb] = await Promise.all([
                authFetch(`/api/live/${a.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sort_order: a.sort_order })
                }),
                authFetch(`/api/live/${b.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sort_order: b.sort_order })
                })
            ]);
            if (!ra.ok || !rb.ok) {
                throw new Error(`PUT failed: ${ra.status} / ${rb.status}`);
            }
        } catch (e) {
            console.error('[live-admin] moveItem failed, rolling back:', e);
            allLives = snapshot;
            renderList();
        }
    }

    // ── Select / clear editor ─────────────────────────────────────────────────
    function selectLive(id) {
        const live = allLives.find(l => l.id === id);
        if (!live) return;
        editingId = id;
        headingEl.textContent = '編集';
        dateEl.value   = live.date   || todayIso();
        venueEl.value  = live.venue  || '';
        openEl.value   = live.open   || '';
        startEl.value  = live.start  || '';
        ticketEl.value = live.ticket || '';
        setStatusRadio(live.status || 'draft');
        deleteBtn.classList.remove('la-hidden');

        // Flyer preview
        resetFlyer();
        if (live.flyer) {
            // Show current flyer from server (cache-bust to reflect recent uploads)
            showFlyerPreview('/api/flyer/' + id + '?t=' + Date.now());
        }

        renderList();
        formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        venueEl.focus();
    }

    function clearEditor() {
        editingId = null;
        headingEl.textContent = '新規ライブ';
        dateEl.value   = '';
        venueEl.value  = '';
        openEl.value   = '';
        startEl.value  = '';
        ticketEl.value = '';
        setStatusRadio('draft');
        deleteBtn.classList.add('la-hidden');
        resetFlyer();
        renderList();
        dateEl.focus();
    }

    // ── API calls ─────────────────────────────────────────────────────────────
    async function loadLives() {
        try {
            const res = await authFetch('/api/live');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            // Sort by sort_order then date
            data.sort((a, b) => {
                const so = (a.sort_order != null ? a.sort_order : 9999) -
                           (b.sort_order != null ? b.sort_order : 9999);
                return so !== 0 ? so : (a.date || '').localeCompare(b.date || '');
            });
            allLives = data;
            renderList();
        } catch (e) {
            console.error('[live-admin] loadLives:', e);
            listEl.innerHTML = '<p class="la-empty">読み込みに失敗しました</p>';
        }
    }

    function setBusy(busy) {
        saveBtn.disabled    = busy;
        publishBtn.disabled = busy;
        deleteBtn.disabled  = busy;
        flyerSelectBtn.disabled = busy;
        flyerRemoveBtn.disabled = busy;
    }

    async function saveLive(forcedStatus) {
        const date   = dateEl.value || todayIso();
        const venue  = venueEl.value.trim();
        const open   = openEl.value.trim();
        const start  = startEl.value.trim();
        const ticket = ticketEl.value.trim();
        const status = forcedStatus || statusRadioValue();

        const nextOrder = allLives.length > 0
            ? Math.max(...allLives.map(l => l.sort_order != null ? l.sort_order : 0)) + 1
            : 0;

        const payload = { date, venue, open, start, ticket, status };
        if (!editingId) payload.sort_order = nextOrder;

        const url    = editingId ? `/api/live/${editingId}` : '/api/live';
        const method = editingId ? 'PUT' : 'POST';

        setBusy(true);
        try {
            // Step 1: save live metadata
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let saved = await res.json();

            // Immediately reflect saved metadata in allLives so retries
            // don't create duplicate entries if flyer upload later fails.
            if (editingId) {
                allLives = allLives.map(l => l.id === editingId ? saved : l);
            } else {
                allLives = [...allLives, saved];
                editingId = saved.id;  // set before flyer sync
            }
            headingEl.textContent = '編集';
            deleteBtn.classList.remove('la-hidden');

            // Step 2: sync flyer (upload/delete if pending)
            let flyerResult = null;
            try {
                flyerResult = await syncFlyer(saved.id);
            } catch (flyerErr) {
                console.error('[live-admin] flyer sync failed (metadata saved):', flyerErr);
                alert('ライブ情報は保存しましたが、フライヤー画像の処理に失敗しました: ' + flyerErr.message);
            }

            if (flyerResult === true)  saved = { ...saved, flyer: true };
            if (flyerResult === false) saved = { ...saved, flyer: false };

            // Update allLives with final flyer state
            allLives = allLives.map(l => l.id === saved.id ? saved : l);

            // Re-sort
            allLives.sort((a, b) => {
                const so = (a.sort_order != null ? a.sort_order : 9999) -
                           (b.sort_order != null ? b.sort_order : 9999);
                return so !== 0 ? so : (a.date || '').localeCompare(b.date || '');
            });

            // Reflect saved values
            dateEl.value   = saved.date   || '';
            venueEl.value  = saved.venue  || '';
            openEl.value   = saved.open   || '';
            startEl.value  = saved.start  || '';
            ticketEl.value = saved.ticket || '';
            setStatusRadio(saved.status || 'draft');

            // Update flyer preview to reflect server state
            if (flyerResult === false) {
                hideFlyerPreview();
            } else if (flyerResult === true) {
                showFlyerPreview('/api/flyer/' + saved.id + '?t=' + Date.now());
            }

            renderList();

        } catch (e) {
            console.error('[live-admin] saveLive:', e);
            alert('保存に失敗しました: ' + e.message);
        } finally {
            setBusy(false);
        }
    }

    async function deleteLive() {
        if (!editingId) return;
        const live  = allLives.find(l => l.id === editingId);
        const label = live && live.venue ? `「${live.venue}」` : 'このライブ';
        if (!confirm(`${label}を削除しますか？この操作は取り消せません。`)) return;

        setBusy(true);
        try {
            const res = await authFetch(`/api/live/${editingId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // Also delete flyer if it exists
            if (live && live.flyer) {
                await authFetch('/api/flyer/' + editingId, { method: 'DELETE' }).catch(() => {});
            }

            allLives = allLives.filter(l => l.id !== editingId);
            clearEditor();
        } catch (e) {
            console.error('[live-admin] deleteLive:', e);
            alert('削除に失敗しました: ' + e.message);
        } finally {
            setBusy(false);
        }
    }

    // ── Event bindings ────────────────────────────────────────────────────────
    newBtn.addEventListener('click', clearEditor);
    saveBtn.addEventListener('click', () => saveLive(null));
    publishBtn.addEventListener('click', () => saveLive('published'));
    deleteBtn.addEventListener('click', deleteLive);
    formEl.addEventListener('submit', e => e.preventDefault());

    // ── Init ──────────────────────────────────────────────────────────────────
    clearEditor();
    loadLives();

}());
