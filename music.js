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

        return '<div class="song-item">'
            + '<a href="' + href + '" class="song-link">'
            +   '<div class="song-left">'
            +     '<span class="play-icon" aria-hidden="true">'
            +       '<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">'
            +         '<polygon points="0,0 10,6 0,12"/>'
            +       '</svg>'
            +     '</span>'
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
    }

    // ── API フェッチ ─────────────────────────────────────────────────────────
    // credentials: 'omit' — admin セッションクッキーを送信しない（公開 API 呼び出し）
    fetch('/api/music', { credentials: 'omit' })
        .then(function (r) {
            if (!r.ok) throw new Error('API error ' + r.status);
            return r.json();
        })
        .then(render)
        .catch(function () {
            // ネットワークエラー時はフォールバック表示
            listEl.innerHTML = '<div class="sub">Now Brewing...</div><hr class="song-line">';
        });

}());
