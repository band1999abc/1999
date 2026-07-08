/**
 * track.js  v1
 * 汎用楽曲詳細ページ（track.html）の動的レンダリング。
 *
 * URL パラメータ ?id=<trackId> を読み取り、
 * GET /api/music/<id> から楽曲データを取得して描画する。
 *
 * フィールド対応:
 *   track.title     → <h1>
 *   track.audioUrl  → あれば「▶ 聴く」ボタン、なければ「準備中。」
 *   track.lyrics    → あれば Lyrics セクション
 *
 * Analytics:
 *   「▶ 聴く」クリック時に music_play イベントを手動発火。
 *   page_view は analytics.js が自動送信。
 */
(function () {
    'use strict';

    var titleEl      = document.getElementById('track-title');
    var statusEl     = document.getElementById('track-status');
    var audioEl      = document.getElementById('track-audio');
    var lyricsWrapEl = document.getElementById('track-lyrics-wrap');
    var lyricsEl     = document.getElementById('track-lyrics');

    // ── HTML エスケープ ──────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ── URL から id を取得 ───────────────────────────────────────────────────
    var id = new URLSearchParams(location.search).get('id');
    if (!id) {
        location.replace('music.html');
        return;
    }

    // ── 楽曲データを描画 ─────────────────────────────────────────────────────
    function render(track) {
        // <title> タグを更新
        document.title = (track.title || '1999') + ' | 1999';

        // h1 タイトル
        if (titleEl) titleEl.textContent = track.title || '';

        // 音源 URL の有無で分岐
        var rawUrl = (track.audioUrl || '').trim();
        // URL スキームを https: / http: のみ許可（javascript: 等を排除）
        var isSafeUrl = rawUrl && /^https?:\/\//i.test(rawUrl);

        if (isSafeUrl) {
            // 音源あり：DOM APIで安全に構築（innerHTML を使わない）
            if (statusEl) statusEl.textContent = '';
            if (audioEl) {
                audioEl.hidden = false;
                var btn = document.createElement('a');
                btn.setAttribute('href', rawUrl);          // esc 済み（scheme 検証後）
                btn.className    = 'play-button';
                btn.target       = '_blank';
                btn.rel          = 'noopener noreferrer';
                btn.textContent  = '▶ 聴く';               // textContent で XSS を防止

                // Analytics: クリック時に music_play を発火
                btn.addEventListener('click', function () {
                    if (window.AH && window.AH.track) {
                        window.AH.track('music_play', { track: track.title || '' });
                    }
                });

                audioEl.appendChild(btn);
            }
        } else {
            // 音源なし：準備中メッセージ
            if (statusEl) statusEl.textContent = '準備中。';
        }

        // 歌詞（あれば表示）
        if (track.lyrics && track.lyrics.trim()) {
            if (lyricsWrapEl) lyricsWrapEl.hidden = false;
            // textContent を使い XSS を防止。CSS の white-space: pre-wrap が改行を保持する。
            if (lyricsEl) lyricsEl.textContent = track.lyrics;
        }
    }

    // ── API フェッチ ─────────────────────────────────────────────────────────
    // credentials: 'omit' — admin セッションクッキーを送信しない（公開 API 呼び出し）
    fetch('/api/music/' + encodeURIComponent(id), { credentials: 'omit' })
        .then(function (r) {
            if (r.status === 404) throw { notFound: true };
            if (!r.ok) throw new Error('API error ' + r.status);
            return r.json();
        })
        .then(render)
        .catch(function (e) {
            if (e && e.notFound) {
                // 非公開または存在しない楽曲 → 404 ページへ
                location.replace('404.html');
            } else {
                // ネットワークエラー
                if (titleEl) titleEl.textContent = '読み込めませんでした';
                if (statusEl) statusEl.textContent = 'しばらくしてからもう一度お試しください。';
            }
        });

}());
