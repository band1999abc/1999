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
    const flyerGridEl   = document.getElementById('la-flyer-grid');
    const flyerEmptyEl  = document.getElementById('la-flyer-empty');
    const flyerAddBtn   = document.getElementById('la-flyer-add');
    const flyerFileEl   = document.getElementById('la-flyer-file');

    // ── State ─────────────────────────────────────────────────────────────────
    let allLives   = [];   // sorted by sort_order
    let editingId  = null;

    /**
     * Flyer items for the currently-editing live.
     * Each: { slotId: string|null, src: string, file: File|null, toDelete: boolean }
     *   slotId null  → pending upload (not yet on server)
     *   toDelete true → will be DELETEd on save
     */
    let flyerItems = [];

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

    function flyerUrl(liveId, slotId) {
        return '/api/flyer/' + liveId + '?s=' + encodeURIComponent(slotId);
    }

    /** Number of images from live.flyer value */
    function imageCount(live) {
        if (!live.flyer) return 0;
        if (live.flyer === true) return 1;
        if (Array.isArray(live.flyer)) return live.flyer.length;
        return 0;
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

    // ── Flyer UI ──────────────────────────────────────────────────────────────

    function renderFlyerGrid() {
        flyerGridEl.innerHTML = '';
        const visible = flyerItems.filter(it => !it.toDelete);

        if (visible.length === 0) {
            flyerEmptyEl.classList.remove('la-hidden');
        } else {
            flyerEmptyEl.classList.add('la-hidden');
        }

        visible.forEach(function (item) {
            const thumb = document.createElement('div');
            thumb.className = 'la-flyer-thumb';

            const img = document.createElement('img');
            img.src = item.src;
            img.alt = 'フライヤー';
            thumb.appendChild(img);

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'la-flyer-thumb-del';
            del.setAttribute('aria-label', '削除');
            del.innerHTML = '&#215;';
            del.addEventListener('click', function () { removeFlyerItem(item); });
            thumb.appendChild(del);

            flyerGridEl.appendChild(thumb);
        });
    }

    function resetFlyerState() {
        flyerItems = [];
        renderFlyerGrid();
    }

    function removeFlyerItem(item) {
        if (item.slotId) {
            // Server-side item: mark for deletion
            item.toDelete = true;
        } else {
            // Pending-only item: just remove from array
            flyerItems = flyerItems.filter(it => it !== item);
        }
        renderFlyerGrid();
    }

    function addFlyerFiles(files) {
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                alert('画像ファイルを選択してください: ' + file.name);
                continue;
            }
            if (file.size > 5 * 1024 * 1024) {
                alert('ファイルサイズが大きすぎます（5MB以下）: ' + file.name);
                continue;
            }
            const item = { slotId: null, src: '', file: file, toDelete: false };
            flyerItems.push(item);

            // Preview immediately with FileReader
            const reader = new FileReader();
            reader.onload = (function (it) {
                return function (e) {
                    it.src = e.target.result;
                    renderFlyerGrid();
                };
            }(item));
            reader.readAsDataURL(file);
        }
        renderFlyerGrid();
    }

    // File picker trigger
    flyerAddBtn.addEventListener('click', function () {
        flyerFileEl.value = '';
        flyerFileEl.click();
    });

    flyerFileEl.addEventListener('change', function () {
        if (flyerFileEl.files && flyerFileEl.files.length) {
            addFlyerFiles(Array.from(flyerFileEl.files));
        }
        flyerFileEl.value = '';
    });

    // ── Sync flyers to server ─────────────────────────────────────────────────

    function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload  = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * Sync all pending adds and deletes to the server.
     * Returns { changed: boolean } — true if anything was modified.
     * Throws on network/server error.
     */
    async function syncFlyers(liveId) {
        let changed = false;

        // Delete marked items
        for (const item of flyerItems.filter(it => it.toDelete && it.slotId)) {
            const res = await authFetch(
                '/api/flyer/' + liveId + '?s=' + encodeURIComponent(item.slotId),
                { method: 'DELETE' }
            );
            if (!res.ok) throw new Error('DELETE /api/flyer failed: HTTP ' + res.status);
            changed = true;
        }
        flyerItems = flyerItems.filter(it => !it.toDelete);

        // Upload pending items
        for (const item of flyerItems.filter(it => !it.slotId && it.file)) {
            const dataUrl = await fileToDataUrl(item.file);
            const res = await authFetch('/api/flyer/' + liveId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl })
            });
            if (!res.ok) throw new Error('POST /api/flyer failed: HTTP ' + res.status);
            const json = await res.json();
            item.slotId = json.slotId;
            item.file   = null;
            item.src    = flyerUrl(liveId, json.slotId) + '&t=' + Date.now();
            changed = true;
        }

        return { changed };
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

            // Image count badge
            const cnt = imageCount(live);
            if (cnt > 0) {
                const fi = document.createElement('span');
                fi.className = 'la-flyer-badge';
                fi.title = cnt + '枚の画像';
                fi.textContent = cnt > 1 ? ('🖼×' + cnt) : '🖼';
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

        // Load flyer state from server data
        resetFlyerState();
        if (live.flyer === true) {
            // Legacy single image
            flyerItems = [{
                slotId: '0',
                src: flyerUrl(id, '0') + '&t=' + Date.now(),
                file: null,
                toDelete: false
            }];
            renderFlyerGrid();
        } else if (Array.isArray(live.flyer) && live.flyer.length > 0) {
            flyerItems = live.flyer.map(function (slotId) {
                return {
                    slotId: slotId,
                    src: flyerUrl(id, slotId) + '&t=' + Date.now(),
                    file: null,
                    toDelete: false
                };
            });
            renderFlyerGrid();
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
        resetFlyerState();
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
        flyerAddBtn.disabled = busy;
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
            // don't create duplicate entries if image sync later fails.
            if (editingId) {
                allLives = allLives.map(l => l.id === editingId ? saved : l);
            } else {
                allLives = [...allLives, saved];
                editingId = saved.id;  // set before flyer sync
            }
            headingEl.textContent = '編集';
            deleteBtn.classList.remove('la-hidden');

            // Step 2: sync flyer images (upload pending, delete marked)
            try {
                await syncFlyers(saved.id);
            } catch (flyerErr) {
                console.error('[live-admin] flyer sync failed (metadata saved):', flyerErr);
                alert('ライブ情報は保存しましたが、画像の処理に失敗しました: ' + flyerErr.message);
            }

            // Step 3: reload live from server to get authoritative flyer state
            try {
                const reloadRes = await authFetch('/api/live/' + saved.id);
                if (reloadRes.ok) {
                    saved = await reloadRes.json();
                }
            } catch (_) { /* non-fatal */ }

            // Update allLives with refreshed state
            allLives = allLives.map(l => l.id === saved.id ? saved : l);

            // Re-sort
            allLives.sort((a, b) => {
                const so = (a.sort_order != null ? a.sort_order : 9999) -
                           (b.sort_order != null ? b.sort_order : 9999);
                return so !== 0 ? so : (a.date || '').localeCompare(b.date || '');
            });

            // Reflect saved metadata values in form
            dateEl.value   = saved.date   || '';
            venueEl.value  = saved.venue  || '';
            openEl.value   = saved.open   || '';
            startEl.value  = saved.start  || '';
            ticketEl.value = saved.ticket || '';
            setStatusRadio(saved.status || 'draft');

            // Refresh flyer grid to show server-confirmed slots
            resetFlyerState();
            const serverImages = Array.isArray(saved.flyer) ? saved.flyer :
                                 (saved.flyer === true ? ['0'] : []);
            flyerItems = serverImages.map(function (slotId) {
                return {
                    slotId: slotId,
                    src: flyerUrl(saved.id, slotId) + '&t=' + Date.now(),
                    file: null,
                    toDelete: false
                };
            });
            renderFlyerGrid();

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

            // Also delete all flyer images if any exist
            if (live && imageCount(live) > 0) {
                // DELETE without ?s removes ALL slots
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
