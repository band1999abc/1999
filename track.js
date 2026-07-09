/**
 * track.js  v2
 * 汎用楽曲詳細ページ（track.html）の動的レンダリング。
 *
 * URL パラメータ ?id=<trackId> を読み取り、
 * GET /api/music/<id> から楽曲データを取得して描画する。
 *
 * フィールド対応:
 *   track.audioFile → true のとき <audio> プレーヤーを埋め込み
 *   track.audioUrl  → あれば「▶ 外部リンク」ボタン（両方あっても共存）
 *   track.title     → <h1>
 *   track.lyrics    → あれば Lyrics セクション
 *
 * Analytics:
 *   再生開始・外部リンククリック時に music_play イベントを手動発火。
 *   page_view は analytics.js が自動送信。
 */
(function () {
    'use strict';

    var titleEl      = document.getElementById('track-title');
    var statusEl     = document.getElementById('track-status');
    var audioEl      = document.getElementById('track-audio');
    var lyricsWrapEl = document.getElementById('track-lyrics-wrap');
    var lyricsEl     = document.getElementById('track-lyrics');

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

        var rawUrl    = (track.audioUrl || '').trim();
        var isSafeUrl = rawUrl && /^https?:\/\//i.test(rawUrl);
        var hasFile   = !!track.audioFile;

        var hasAudio = hasFile || isSafeUrl;

        if (!hasAudio) {
            // 音源なし — ステータスを表示するが歌詞描画は続行
            if (statusEl) statusEl.textContent = '準備中。';
        } else {
            if (statusEl) statusEl.textContent = '';
            if (audioEl)  audioEl.hidden = false;
        }

        // ── 1. ホスト配信: <audio> プレーヤー ─────────────────────────────────
        if (hasFile && audioEl) {
            var player = document.createElement('audio');
            player.className = 'track-player';
            player.controls  = true;
            player.preload   = 'none';
            player.src       = '/api/music-file/' + encodeURIComponent(id);

            // Analytics: 再生開始時
            var tracked = false;
            player.addEventListener('play', function () {
                if (!tracked) {
                    tracked = true;
                    if (window.AH && window.AH.track) {
                        window.AH.track('music_play', { track: track.title || '', source: 'hosted' });
                    }
                }
            });

            audioEl.appendChild(player);
        }

        // ── 2. 外部リンク（YouTube / Spotify / etc.）──────────────────────────
        if (isSafeUrl && audioEl) {
            var btn = document.createElement('a');
            btn.setAttribute('href', rawUrl);   // scheme validated above
            btn.className   = 'play-button';
            btn.target      = '_blank';
            btn.rel         = 'noopener noreferrer';
            btn.textContent = hasFile ? '▶ 外部リンク' : '▶ 聴く';

            btn.addEventListener('click', function () {
                if (window.AH && window.AH.track) {
                    window.AH.track('music_play', { track: track.title || '', source: 'external' });
                }
            });

            audioEl.appendChild(btn);
        }

        // ── 歌詞（あれば表示）────────────────────────────────────────────────
        if (track.lyrics && track.lyrics.trim()) {
            if (lyricsWrapEl) lyricsWrapEl.hidden = false;
            if (lyricsEl)     lyricsEl.textContent = track.lyrics;
        }
    }

    // ── API フェッチ ─────────────────────────────────────────────────────────
    fetch('/api/music/' + encodeURIComponent(id), { credentials: 'omit' })
        .then(function (r) {
            if (r.status === 404) throw { notFound: true };
            if (!r.ok) throw new Error('API error ' + r.status);
            return r.json();
        })
        .then(render)
        .catch(function (e) {
            if (e && e.notFound) {
                location.replace('404.html');
            } else {
                if (titleEl) titleEl.textContent = '読み込めませんでした';
                if (statusEl) statusEl.textContent = 'しばらくしてからもう一度お試しください。';
            }
        });

}());
