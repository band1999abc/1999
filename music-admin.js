/**
 * music-admin.js  v1
 * After Hours — Music management admin
 * Runs only when data-page="afterhours-music"
 */
(function () {
    'use strict';
    if (document.body.dataset.page !== 'afterhours-music') return;

    // ── State ─────────────────────────────────────────────────────────────────

    var S = {
        tracks:        [],       // all music objects from API
        filter:        'all',    // 'all' | 'published' | 'scheduled' | 'draft'
        sort:          'release',// 'release' | 'plays' | 'title'
        query:         '',       // search string
        view:          'list',   // 'list' | 'editor'
        editingId:     null,     // null = creating new
        jacketSrc:     null,     // base64 dataUrl of pending jacket upload
        jacketToDelete: false,   // flag: delete existing jacket on next save
        audioMeta:     null,     // { duration, fileSize, bitrate, uploadedAt } from MP3 pick
        saving:        false,
        analytics:     {},       // { [trackTitle]: { total, listeners } }
    };

    // ── DOM refs ──────────────────────────────────────────────────────────────

    var listView      = document.getElementById('mc-list-view');
    var editorView    = document.getElementById('mc-editor-view');
    var searchEl      = document.getElementById('mc-search');
    var countEl       = document.getElementById('mc-count');
    var listEl        = document.getElementById('mc-list');
    var newBtn        = document.getElementById('mc-new-btn');
    var filterBar     = document.getElementById('mc-filter-bar');
    var sortBar       = document.getElementById('mc-sort-bar');

    // Editor form fields
    var editorHeading = document.getElementById('mc-editor-title');
    var backBtn       = document.getElementById('mc-back');
    var titleEl       = document.getElementById('mc-title');
    var titleEnEl     = document.getElementById('mc-title-en');
    var relDateEl     = document.getElementById('mc-release-date');
    var typeEl        = document.getElementById('mc-type');
    var audioUrlEl    = document.getElementById('mc-audio-url');
    var lyricsEl      = document.getElementById('mc-lyrics');
    var noteEl        = document.getElementById('mc-note');
    var schedWrapEl   = document.getElementById('mc-sched-wrap');
    var publishAtEl   = document.getElementById('mc-publish-at');
    var saveBtn       = document.getElementById('mc-save');
    var deleteBtn     = document.getElementById('mc-delete');
    var previewBtn    = document.getElementById('mc-preview-btn');

    // Jacket elements
    var jacketWrapEl  = document.getElementById('mc-jacket-wrap');
    var jacketImgEl   = document.getElementById('mc-jacket-img');
    var jacketEmptyEl = document.getElementById('mc-jacket-empty');
    var jacketDelBtn  = document.getElementById('mc-jacket-delete');
    var jacketAddBtn  = document.getElementById('mc-jacket-add');
    var jacketFileEl  = document.getElementById('mc-jacket-file');

    // MP3 metadata picker
    var mp3PickBtn = document.getElementById('mc-mp3-pick');
    var mp3FileEl  = document.getElementById('mc-mp3-file');
    var mp3MetaEl  = document.getElementById('mc-mp3-meta');
    var mp3DurEl   = document.getElementById('mc-mp3-duration');
    var mp3SizeEl  = document.getElementById('mc-mp3-size');
    var mp3BrEl    = document.getElementById('mc-mp3-bitrate');
    var mp3UpEl    = document.getElementById('mc-mp3-uploaded');

    // Preview overlay
    var previewOverlay = document.getElementById('mc-preview-overlay');
    var previewClose   = document.getElementById('mc-preview-close');
    var previewBody    = document.getElementById('mc-preview-body');

    // Confirm modal
    var confirmModal  = document.getElementById('mc-confirm-modal');
    var confirmMsg    = document.getElementById('mc-confirm-msg');
    var confirmOkBtn  = document.getElementById('mc-confirm-ok');
    var confirmCancel = document.getElementById('mc-confirm-cancel');
    var _confirmCb    = null;

    // ── Auth fetch ────────────────────────────────────────────────────────────

    function authFetch(url, opts) {
        if (window._adminAuthFetch) return window._adminAuthFetch(url, opts);
        var token = sessionStorage.getItem('admin_token') || '';
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {});
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, opts);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function fmtDate(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
        return iso.replace(/-/g, '.');
    }

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function fmtDuration(sec) {
        var s = Math.round(sec || 0);
        return Math.floor(s / 60) + ':' + pad2(s % 60);
    }

    function fmtFileSize(bytes) {
        if (!bytes) return '—';
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return Math.round(bytes / 1024) + ' KB';
    }

    function fmtDateTime(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate())
             + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function renderAudioMeta(meta) {
        if (!mp3MetaEl) return;
        if (!meta) { mp3MetaEl.classList.add('mc-hidden'); return; }
        mp3MetaEl.classList.remove('mc-hidden');
        if (mp3DurEl)  mp3DurEl.textContent  = meta.duration != null ? fmtDuration(meta.duration) : '—';
        if (mp3SizeEl) mp3SizeEl.textContent = meta.fileSize != null ? fmtFileSize(meta.fileSize) : '—';
        if (mp3BrEl)   mp3BrEl.textContent   = meta.bitrate  != null ? meta.bitrate + ' kbps（概算）' : '—';
        if (mp3UpEl)   mp3UpEl.textContent   = meta.uploadedAt ? fmtDateTime(meta.uploadedAt) : '—';
    }

    function todayIso() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function addYears(iso, n) {
        return (parseInt(iso.slice(0, 4), 10) + n) + iso.slice(4);
    }

    function statusLabel(s) {
        return s === 'published' ? '公開中' : s === 'scheduled' ? '予約中' : '下書き';
    }

    function statusBadgeCls(s) {
        return s === 'published' ? 'mc-badge--pub' : s === 'scheduled' ? 'mc-badge--sched' : 'mc-badge--draft';
    }

    function pubModeValue() {
        var el = document.querySelector('input[name="mc-pub-mode"]:checked');
        return el ? el.value : 'draft';
    }

    function setPubMode(val) {
        var el = document.querySelector('input[name="mc-pub-mode"][value="' + val + '"]');
        if (el) el.checked = true;
        toggleSchedWrap(val);
    }

    function toggleSchedWrap(mode) {
        if (schedWrapEl) schedWrapEl.classList.toggle('mc-hidden', mode !== 'scheduled');
    }

    // ── Confirm dialog ────────────────────────────────────────────────────────

    function openConfirm(msg, onOk) {
        if (confirmMsg) confirmMsg.textContent = msg;
        _confirmCb = onOk;
        if (confirmModal) confirmModal.classList.add('is-open');
    }

    if (confirmOkBtn) confirmOkBtn.addEventListener('click', function () {
        if (confirmModal) confirmModal.classList.remove('is-open');
        if (_confirmCb) _confirmCb();
        _confirmCb = null;
    });

    if (confirmCancel) confirmCancel.addEventListener('click', function () {
        if (confirmModal) confirmModal.classList.remove('is-open');
        _confirmCb = null;
    });

    // ── Filtering / sorting ───────────────────────────────────────────────────

    function filteredTracks() {
        var q = S.query.trim().toLowerCase();
        return S.tracks
            .filter(function (t) {
                if (S.filter !== 'all' && t.status !== S.filter) return false;
                if (q) {
                    var hay = ((t.title || '') + ' ' + (t.titleEn || '')).toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            })
            .sort(function (a, b) {
                if (S.sort === 'title') return (a.title || '').localeCompare(b.title || '', 'ja');
                if (S.sort === 'plays') {
                    var pa = (S.analytics[a.title] || {}).total || 0;
                    var pb = (S.analytics[b.title] || {}).total || 0;
                    return pb - pa;
                }
                // default: release date descending
                var rd = (b.releaseDate || '').localeCompare(a.releaseDate || '');
                return rd !== 0 ? rd : (b.createdAt || '').localeCompare(a.createdAt || '');
            });
    }

    // ── Render list ───────────────────────────────────────────────────────────

    function renderList() {
        var all = filteredTracks();
        var total = S.tracks.length;
        if (countEl) countEl.textContent = total > 0 ? total : '';

        // Sync filter buttons
        document.querySelectorAll('.mc-filter-btn').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset.filter === S.filter);
        });

        // Sync sort buttons
        document.querySelectorAll('.mc-sort-btn').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset.sort === S.sort);
        });

        if (!all.length) {
            listEl.innerHTML = '<p class="mc-empty">'
                + (S.query || S.filter !== 'all' ? '条件に合う楽曲がありません' : 'まだ楽曲がありません')
                + '</p>';
            return;
        }

        listEl.innerHTML = all.map(function (t) {
            var an = S.analytics[t.title] || {};
            var plays = an.total != null ? Number(an.total).toLocaleString('ja-JP') : '—';
            var lsn   = an.listeners != null ? Number(an.listeners).toLocaleString('ja-JP') : '—';
            var jSrc  = t.jacket
                ? '/api/music-jacket/' + t.id + '?v=' + (t.updatedAt || '').slice(0, 16)
                : '';
            var isActive = t.id === S.editingId ? ' mc-card--active' : '';

            return '<div class="mc-card' + isActive + '" data-id="' + esc(t.id) + '">'
                + '<div class="mc-card-jacket">'
                +   (jSrc
                      ? '<img src="' + esc(jSrc) + '" class="mc-thumb" alt="" loading="lazy">'
                      : '<div class="mc-thumb-empty">♪</div>')
                + '</div>'
                + '<div class="mc-card-body">'
                +   '<div class="mc-card-top">'
                +     '<div class="mc-card-title">' + esc(t.title || '(無題)') + '</div>'
                +     '<span class="mc-badge ' + statusBadgeCls(t.status) + '">' + statusLabel(t.status) + '</span>'
                +   '</div>'
                +   (t.titleEn ? '<div class="mc-card-en">' + esc(t.titleEn) + '</div>' : '')
                +   '<div class="mc-card-meta">'
                +     (t.releaseDate ? '<span>' + fmtDate(t.releaseDate) + '</span>' : '')
                +     '<span class="mc-stat">▶ ' + plays + '</span>'
                +     '<span class="mc-stat">👤 ' + lsn + '</span>'
                +   '</div>'
                + '</div>'
                + '<button class="mc-menu-btn" data-id="' + esc(t.id) + '" type="button" aria-label="メニュー">⋯</button>'
                + '</div>';
        }).join('');

        // Card click → open editor
        listEl.querySelectorAll('.mc-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                if (e.target.closest('.mc-menu-btn')) return;
                openEditor(card.dataset.id);
            });
        });

        // ⋯ menu buttons
        listEl.querySelectorAll('.mc-menu-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                showQuickMenu(btn.dataset.id, btn);
            });
        });
    }

    // ── Quick action menu ─────────────────────────────────────────────────────

    var _activeMenu = null;

    function closeAllMenus() {
        document.querySelectorAll('.mc-quick-menu').forEach(function (m) { m.remove(); });
        _activeMenu = null;
    }

    document.addEventListener('click', function (e) {
        if (_activeMenu && !e.target.closest('.mc-quick-menu')) closeAllMenus();
    });

    function showQuickMenu(trackId, anchor) {
        closeAllMenus();
        var t = S.tracks.find(function (x) { return x.id === trackId; });
        if (!t) return;

        var menu = document.createElement('div');
        menu.className = 'mc-quick-menu';
        var isPub = t.status === 'published';
        var items = [
            { action: isPub ? 'unpublish' : 'publish', label: isPub ? '非公開にする' : '公開する' },
            { action: 'duplicate', label: '複製' },
            { action: 'analytics', label: 'Analytics →' },
            { action: 'delete',    label: '削除', danger: true },
        ];
        menu.innerHTML = items.map(function (it) {
            return '<button class="mc-quick-item' + (it.danger ? ' mc-quick-item--danger' : '')
                 + '" data-action="' + it.action + '" data-id="' + esc(trackId) + '" type="button">'
                 + it.label + '</button>';
        }).join('');

        var rect = anchor.getBoundingClientRect();
        menu.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;'
            + 'right:' + (window.innerWidth - rect.right) + 'px;z-index:1000;';

        document.body.appendChild(menu);
        _activeMenu = menu;

        menu.querySelectorAll('.mc-quick-item').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                closeAllMenus();
                handleQuickAction(btn.dataset.action, btn.dataset.id);
            });
        });
    }

    function handleQuickAction(action, id) {
        var t = S.tracks.find(function (x) { return x.id === id; });
        if (!t) return;

        if (action === 'publish' || action === 'unpublish') {
            var ns = action === 'publish' ? 'published' : 'draft';
            authFetch('/api/music/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: ns }),
            }).then(function (r) { return r.json(); }).then(function (upd) {
                var idx = S.tracks.findIndex(function (x) { return x.id === id; });
                if (idx >= 0) S.tracks[idx] = Object.assign({}, S.tracks[idx], upd);
                renderList();
            });
        } else if (action === 'duplicate') {
            duplicateTrack(t);
        } else if (action === 'analytics') {
            window.location.href = '/afterhours/analytics';
        } else if (action === 'delete') {
            openConfirm('「' + (t.title || '(無題)') + '」を削除しますか？\nこの操作は取り消せません。', function () {
                doDelete(id);
            });
        }
    }

    function duplicateTrack(t) {
        var body = {
            title:          (t.title || '') + ' (コピー)',
            titleEn:        t.titleEn        || '',
            releaseDate:    t.releaseDate    || '',
            type:           t.type           || 'single',
            status:         'draft',
            scheduledAt:    '',
            audioUrl:       t.audioUrl       || '',
            lyrics:         t.lyrics         || '',
            productionNote: t.productionNote || '',
            duration:       t.duration       != null ? t.duration   : undefined,
            fileSize:       t.fileSize       != null ? t.fileSize    : undefined,
            bitrate:        t.bitrate        != null ? t.bitrate     : undefined,
            uploadedAt:     t.uploadedAt     || undefined,
        };
        authFetch('/api/music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function (r) { return r.json(); }).then(function (created) {
            if (created.error) { alert('複製エラー: ' + created.error); return; }
            S.tracks.unshift(created);
            renderList();
        });
    }

    function doDelete(id) {
        authFetch('/api/music/' + id, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function () {
                S.tracks = S.tracks.filter(function (x) { return x.id !== id; });
                if (S.editingId === id) { showView('list'); S.editingId = null; }
                renderList();
            });
    }

    // ── Editor ────────────────────────────────────────────────────────────────

    function openEditor(id) {
        S.editingId     = id || null;
        S.jacketSrc     = null;
        S.jacketToDelete = false;
        showView('editor');

        var t = id ? S.tracks.find(function (x) { return x.id === id; }) : null;
        if (editorHeading) editorHeading.textContent = t ? (t.title || '楽曲を編集') : '新規楽曲';
        if (titleEl)       titleEl.value        = t ? (t.title           || '') : '';
        if (titleEnEl)     titleEnEl.value      = t ? (t.titleEn         || '') : '';
        if (relDateEl)     relDateEl.value      = t ? (t.releaseDate     || '') : todayIso();
        if (typeEl)        typeEl.value         = t ? (t.type            || 'single') : 'single';
        if (audioUrlEl)    audioUrlEl.value     = t ? (t.audioUrl        || '') : '';
        if (lyricsEl)      lyricsEl.value       = t ? (t.lyrics          || '') : '';
        if (noteEl)        noteEl.value         = t ? (t.productionNote  || '') : '';

        var status = t ? (t.status || 'draft') : 'draft';
        var schedAt = t ? (t.scheduledAt || '') : '';
        setPubMode(status);
        if (publishAtEl) publishAtEl.value = schedAt;

        if (deleteBtn) deleteBtn.classList.toggle('mc-hidden', !id);
        renderJacketUI(t);

        // Restore audio metadata — show panel if any field is present
        var hasAnyMeta = t && (t.duration != null || t.fileSize != null || !!t.uploadedAt);
        S.audioMeta = hasAnyMeta
            ? { duration: t.duration ?? null, fileSize: t.fileSize ?? null, bitrate: t.bitrate ?? null, uploadedAt: t.uploadedAt || null }
            : null;
        renderAudioMeta(S.audioMeta);

        if (editorView) editorView.scrollTop = 0;
    }

    function renderJacketUI(t) {
        var hasExisting = t && t.jacket;
        var hasPending  = !!S.jacketSrc;
        var show = (hasPending || (hasExisting && !S.jacketToDelete));

        if (jacketWrapEl)  jacketWrapEl.classList.toggle('mc-hidden', !show);
        if (jacketEmptyEl) jacketEmptyEl.classList.toggle('mc-hidden',  show);
        if (jacketDelBtn)  jacketDelBtn.classList.toggle('mc-hidden',  !show);

        if (jacketImgEl) {
            if (hasPending) {
                jacketImgEl.src = S.jacketSrc;
                jacketImgEl.style.display = 'block';
            } else if (hasExisting && !S.jacketToDelete) {
                jacketImgEl.src = '/api/music-jacket/' + t.id
                    + '?v=' + (t.updatedAt || '').slice(0, 16);
                jacketImgEl.style.display = 'block';
            } else {
                jacketImgEl.src = '';
                jacketImgEl.style.display = 'none';
            }
        }
    }

    // MP3 file pick → extract duration, fileSize, bitrate, uploadedAt
    if (mp3PickBtn && mp3FileEl) {
        mp3PickBtn.addEventListener('click', function () { mp3FileEl.click(); });
        mp3FileEl.addEventListener('change', function () {
            var file = mp3FileEl.files[0];
            if (!file) return;
            mp3FileEl.value = '';

            var uploadedAt = new Date().toISOString();
            var fileSize   = file.size;
            var objUrl     = URL.createObjectURL(file);
            var audio      = new Audio();
            var resolved   = false;
            var timeout;

            function finalize(dur) {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                // Detach src first so the browser stops fetching, then release the blob
                audio.src = '';
                URL.revokeObjectURL(objUrl);
                var bitrate = (dur != null && dur > 0)
                    ? Math.round(fileSize * 8 / dur / 1000)
                    : null;
                S.audioMeta = { duration: dur, fileSize: fileSize, bitrate: bitrate, uploadedAt: uploadedAt };
                renderAudioMeta(S.audioMeta);
            }

            // loadedmetadata: fires first; for CBR files duration is already finite
            audio.addEventListener('loadedmetadata', function () {
                if (isFinite(audio.duration)) {
                    finalize(audio.duration);
                } else {
                    // VBR / stream-like: seek far to force browser to compute total duration
                    audio.currentTime = 1e9;
                }
            });

            // durationchange: fires again after seek resolves Infinity → actual value
            audio.addEventListener('durationchange', function () {
                if (!resolved && isFinite(audio.duration)) {
                    finalize(audio.duration);
                }
            });

            // Timeout fallback: store what we have (null duration if still Infinity)
            timeout = setTimeout(function () {
                finalize(isFinite(audio.duration) ? audio.duration : null);
            }, 6000);

            audio.addEventListener('error', function () {
                if (resolved) return; // already finished OK — ignore post-revoke errors
                clearTimeout(timeout);
                resolved = true;
                audio.src = '';
                URL.revokeObjectURL(objUrl);
                alert('音声ファイルの読み込みに失敗しました。MP3 ファイルを確認してください。');
            });

            audio.src = objUrl;
        });
    }

    // Jacket file input
    if (jacketAddBtn && jacketFileEl) {
        jacketAddBtn.addEventListener('click', function () { jacketFileEl.click(); });
        jacketFileEl.addEventListener('change', function () {
            var file = jacketFileEl.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                S.jacketSrc      = e.target.result;
                S.jacketToDelete = false;
                renderJacketUI(S.editingId ? S.tracks.find(function (x) { return x.id === S.editingId; }) : null);
            };
            reader.readAsDataURL(file);
            jacketFileEl.value = '';
        });
    }

    if (jacketDelBtn) {
        jacketDelBtn.addEventListener('click', function () {
            S.jacketSrc      = null;
            S.jacketToDelete = true;
            renderJacketUI(S.editingId ? S.tracks.find(function (x) { return x.id === S.editingId; }) : null);
        });
    }

    // Pub-mode radio → show/hide schedule date picker
    document.querySelectorAll('input[name="mc-pub-mode"]').forEach(function (radio) {
        radio.addEventListener('change', function () { toggleSchedWrap(radio.value); });
    });

    // ── Save ──────────────────────────────────────────────────────────────────

    if (saveBtn) saveBtn.addEventListener('click', doSave);

    function doSave() {
        if (S.saving) return;
        var title = titleEl ? titleEl.value.trim() : '';
        if (!title) {
            alert('タイトルを入力してください');
            if (titleEl) titleEl.focus();
            return;
        }
        var pubMode = pubModeValue();
        var pubAt   = publishAtEl ? publishAtEl.value.trim() : '';
        if (pubMode === 'scheduled' && !pubAt) {
            alert('予約公開の日時を入力してください');
            if (publishAtEl) publishAtEl.focus();
            return;
        }

        S.saving = true;
        if (saveBtn) { saveBtn.textContent = '保存中…'; saveBtn.disabled = true; }

        var body = {
            title:          title,
            titleEn:        titleEnEl  ? titleEnEl.value.trim()  : '',
            releaseDate:    relDateEl  ? relDateEl.value          : '',
            type:           typeEl     ? typeEl.value             : 'single',
            status:         pubMode,
            scheduledAt:    pubMode === 'scheduled' ? pubAt : '',
            audioUrl:       audioUrlEl ? audioUrlEl.value.trim()  : '',
            lyrics:         lyricsEl   ? lyricsEl.value           : '',
            productionNote: noteEl     ? noteEl.value             : '',
            duration:       S.audioMeta ? S.audioMeta.duration   : undefined,
            fileSize:       S.audioMeta ? S.audioMeta.fileSize    : undefined,
            bitrate:        S.audioMeta ? S.audioMeta.bitrate     : undefined,
            uploadedAt:     S.audioMeta ? S.audioMeta.uploadedAt  : undefined,
        };

        var isNew = !S.editingId;
        var req   = isNew
            ? authFetch('/api/music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
            : authFetch('/api/music/' + S.editingId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });

        req.then(function (r) { return r.json(); })
           .then(function (saved) {
                if (saved.error) throw new Error(saved.error);
                if (isNew) {
                    S.tracks.unshift(saved);
                    S.editingId = saved.id;
                } else {
                    var idx = S.tracks.findIndex(function (x) { return x.id === saved.id; });
                    if (idx >= 0) S.tracks[idx] = saved;
                }
                return handleJacketAfterSave(saved.id);
           })
           .then(function () {
                var t = S.tracks.find(function (x) { return x.id === S.editingId; });
                if (editorHeading && t) editorHeading.textContent = t.title || '楽曲を編集';
                if (deleteBtn) deleteBtn.classList.remove('mc-hidden');
                S.saving = false;
                if (saveBtn) { saveBtn.textContent = '✓ 保存済み'; saveBtn.disabled = false; }
                setTimeout(function () { if (saveBtn) saveBtn.textContent = '保存'; }, 2500);
                renderList();
           })
           .catch(function (e) {
                S.saving = false;
                if (saveBtn) { saveBtn.textContent = '保存'; saveBtn.disabled = false; }
                alert('保存に失敗しました: ' + e.message);
           });
    }

    function handleJacketAfterSave(musicId) {
        if (S.jacketToDelete && !S.jacketSrc) {
            return authFetch('/api/music-jacket/' + musicId, { method: 'DELETE' })
                .then(function (r) { return r.json(); })
                .then(function () {
                    var idx = S.tracks.findIndex(function (x) { return x.id === musicId; });
                    if (idx >= 0) S.tracks[idx] = Object.assign({}, S.tracks[idx], { jacket: false });
                    S.jacketToDelete = false;
                    renderJacketUI(S.tracks.find(function (x) { return x.id === musicId; }));
                });
        }
        if (S.jacketSrc) {
            return authFetch('/api/music-jacket/' + musicId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: S.jacketSrc }),
            })
            .then(function (r) { return r.json(); })
            .then(function () {
                S.jacketSrc = null;
                var idx = S.tracks.findIndex(function (x) { return x.id === musicId; });
                if (idx >= 0) S.tracks[idx] = Object.assign({}, S.tracks[idx], { jacket: true });
                renderJacketUI(S.tracks.find(function (x) { return x.id === musicId; }));
            });
        }
        return Promise.resolve();
    }

    // Delete button inside editor
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function () {
            if (!S.editingId) return;
            var t = S.tracks.find(function (x) { return x.id === S.editingId; });
            openConfirm('「' + (t ? t.title : '(無題)') + '」を削除しますか？\nこの操作は取り消せません。', function () {
                doDelete(S.editingId);
            });
        });
    }

    // Back to list
    if (backBtn) backBtn.addEventListener('click', function () {
        showView('list');
        S.editingId = null;
        renderList(); // refresh card highlight
    });

    // New track button
    if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });

    // ── Preview ───────────────────────────────────────────────────────────────

    if (previewBtn) previewBtn.addEventListener('click', function () {
        var t   = S.editingId ? S.tracks.find(function (x) { return x.id === S.editingId; }) : null;
        var ttl = titleEl    ? titleEl.value.trim()   : '';
        var ten = titleEnEl  ? titleEnEl.value.trim() : '';
        var rd  = relDateEl  ? relDateEl.value        : '';
        var lyr = lyricsEl   ? lyricsEl.value         : '';
        var jsr = S.jacketSrc || (t && t.jacket ? '/api/music-jacket/' + t.id : '');

        var html = '<div class="mc-prev-card">'
            + (jsr
                ? '<img src="' + esc(jsr) + '" class="mc-prev-jacket" alt="">'
                : '<div class="mc-prev-jacket mc-prev-jacket--empty">♪</div>')
            + '<div class="mc-prev-title">' + esc(ttl || '(タイトル未設定)') + '</div>'
            + (ten ? '<div class="mc-prev-en">' + esc(ten) + '</div>' : '')
            + (rd  ? '<div class="mc-prev-date">' + fmtDate(rd) + '</div>' : '')
            + (lyr
                ? '<div class="mc-prev-lyr-wrap"><div class="mc-prev-lyr-lbl">Lyrics</div>'
                +   '<pre class="mc-prev-lyr">' + esc(lyr) + '</pre></div>'
                : '')
            + '</div>';

        if (previewBody)   previewBody.innerHTML = html;
        if (previewOverlay) previewOverlay.classList.add('is-open');
    });

    if (previewClose) previewClose.addEventListener('click', function () {
        if (previewOverlay) previewOverlay.classList.remove('is-open');
    });

    // ── Filter, sort, search ──────────────────────────────────────────────────

    if (filterBar) filterBar.addEventListener('click', function (e) {
        var btn = e.target.closest('.mc-filter-btn');
        if (btn) { S.filter = btn.dataset.filter; renderList(); }
    });

    if (sortBar) sortBar.addEventListener('click', function (e) {
        var btn = e.target.closest('.mc-sort-btn');
        if (btn) { S.sort = btn.dataset.sort; renderList(); }
    });

    if (searchEl) searchEl.addEventListener('input', function () {
        S.query = searchEl.value;
        renderList();
    });

    // ── View management ───────────────────────────────────────────────────────

    function showView(v) {
        S.view = v;
        if (listView)   listView.classList.toggle('mc-hidden',   v !== 'list');
        if (editorView) editorView.classList.toggle('mc-hidden', v !== 'editor');
    }

    // ── Load music from API ───────────────────────────────────────────────────

    function loadTracks() {
        authFetch('/api/music')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                S.tracks = Array.isArray(data) ? data : [];
                renderList();
            })
            .catch(function (e) {
                console.error('[music-admin] loadTracks error:', e);
                if (listEl) listEl.innerHTML = '<p class="mc-empty">読み込みに失敗しました</p>';
            });
    }

    // Load last 90 days of analytics to populate play counts in the list
    function loadAnalytics() {
        var today  = todayIso();
        var start  = addYears(today, -1); // start 1 year ago (but API caps at 90 days)
        var params = '?start=' + start + '&end=' + today;
        authFetch('/api/analytics' + params)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var events = Array.isArray(d.events) ? d.events : [];
                var plays  = events.filter(function (e) { return e.event === 'music_play'; });
                var map    = Object.create(null);
                plays.forEach(function (e) {
                    var trk = (e.props && e.props.track) ? e.props.track.trim() : '';
                    if (!trk) return;
                    if (!map[trk]) map[trk] = { total: 0, vis: Object.create(null) };
                    map[trk].total++;
                    map[trk].vis[e.visitor_id] = 1;
                });
                S.analytics = Object.create(null);
                Object.keys(map).forEach(function (nm) {
                    S.analytics[nm] = {
                        total:     map[nm].total,
                        listeners: Object.keys(map[nm].vis).length,
                    };
                });
                renderList();
            })
            .catch(function () { /* analytics not critical */ });
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    showView('list');
    loadTracks();
    loadAnalytics();

}());
