/**
 * music.js  v1
 * 公開 Music ページの動的レンダリング。
 *
 * After Hours（/afterhours/music）が唯一の管理場所（Single Source of Truth）。
 * GET /api/music から公開中の楽曲一覧を取得し、song-list に描画する。
 *
 * Analytics との連携：
 *   analytics.js がキャプチャフェーズで .song-link クリックを監視し、
 *   .song-name テキストを track_view イベントのトラック名として使用する。
 *   このファイルは同じクラス・構造を維持するため既存 Analytics は無変更で動作する。
 */
(function () {
    'use strict';

    var listEl = document.getElementById('song-list');
    if (!listEl) return;

    // ── HTML エスケープ ──────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ── 楽曲カードの HTML を生成 ─────────────────────────────────────────────
    function buildTrackItem(t) {
        var year = t.releaseDate ? String(t.releaseDate).slice(0, 4) : '';
        var href = 'track.html?id=' + encodeURIComponent(t.id);
        var jacket = t.jacket === true
            ? '<img class="song-jacket" src="/api/music-jacket/' + encodeURIComponent(t.id)
                + '" alt="" loading="lazy" decoding="async">'
            : '';

        return '<div class="song-item">'
            + '<a href="' + href + '" class="song-link">'
            +   '<div class="song-left">'
            +     '<span class="play-icon" aria-hidden="true">'
            +       '<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">'
            +         '<polygon points="0,0 10,6 0,12"/>'
            +       '</svg>'
            +     '</span>'
            +     jacket
            +     '<span class="song-name">' + esc(t.title) + '</span>'
            +   '</div>'
            +   (year ? '<span class="song-year">' + esc(year) + '</span>' : '')
            + '</a>'
            + '</div>'
            + '<hr class="song-line">';
    }

    // ── 一覧を描画 ────────────────────────────────────────────────────────────
    function render(tracks) {
        // API は未認証リクエストで published のみ返すが念のため再フィルタ
        var published = tracks.filter(function (t) { return t.status === 'published'; });

        if (!published.length) {
            // 楽曲がまだない場合
            listEl.dataset.state = 'empty';
            listEl.innerHTML = '<div class="sub">Now Brewing...</div><hr class="song-line">';
            return;
        }

        var html = '';
        published.forEach(function (t) {
            html += buildTrackItem(t);
        });

        // 一覧末尾に "Now Brewing..." テイザーを表示（今後の楽曲を示す）
        html += '<div class="sub">Now Brewing...</div><hr class="song-line">';

        listEl.innerHTML = html;
        listEl.dataset.state = published.length ? 'success' : 'empty';
    }

    // ── API フェッチ ─────────────────────────────────────────────────────────
    function load() {
        listEl.dataset.state = 'loading';
        listEl.setAttribute('aria-busy', 'true');
        listEl.innerHTML = '<div class="sub">読み込み中…</div>';
        // Public pages must never request draft data using an admin cookie.
        fetch('/api/music', { credentials: 'omit' })
        .then(function (r) {
            if (!r.ok) throw new Error('API error ' + r.status);
            return r.json();
        })
        .then(function (tracks) {
            if (!Array.isArray(tracks) || tracks.some(function (t) {
                return !t || typeof t !== 'object' || Array.isArray(t)
                    || typeof t.id !== 'string' || !t.id
                    || typeof t.title !== 'string' || typeof t.status !== 'string';
            })) throw new Error('Invalid music response');
            if (!tracks.some(function (t) { return t.status === 'published'; })) {
                listEl.dataset.state = 'empty';
            }
            render(tracks);
        })
        .catch(function () {
            listEl.dataset.state = 'error';
            listEl.innerHTML = '<div class="sub" role="alert">楽曲を読み込めませんでした。しばらくしてから再試行してください。</div>';
            var retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'public-pagination-button';
            retry.textContent = '再試行';
            retry.addEventListener('click', load);
            listEl.appendChild(retry);
        })
        .finally(function () { listEl.setAttribute('aria-busy', 'false'); });
    }
    load();

}());
