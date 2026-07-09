/**
 * track.js  v4
 * 汎用楽曲詳細ページ（track.html）の動的レンダリング。
 *
 * URL パラメータ ?id=<trackId> を読み取り、
 * GET /api/music/<id> から楽曲データを取得して描画する。
 *
 * フィールド対応:
 *   track.audioFile → true のとき カスタムプレーヤーを表示
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

    var id = new URLSearchParams(location.search).get('id');
    if (!id) { location.replace('music.html'); return; }

    // ── Custom Player Builder ─────────────────────────────────────────────────
    function buildCustomPlayer(src) {
        var audio = document.createElement('audio');
        audio.preload = 'none';
        audio.src     = src;

        var seeking = false;

        // ── DOM ───────────────────────────────────────────────────────────────
        var wrap = document.createElement('div');
        wrap.className = 'cp';

        // Play / Pause / Loading button
        var btn = document.createElement('button');
        btn.type      = 'button';
        btn.className = 'cp-btn';

        // Right column: seek bar + time display
        var right = document.createElement('div');
        right.className = 'cp-right';

        var barOuter = document.createElement('div');
        barOuter.className = 'cp-bar-outer';
        barOuter.setAttribute('role',          'slider');
        barOuter.setAttribute('aria-label',    '再生位置');
        barOuter.setAttribute('aria-valuemin', '0');
        barOuter.setAttribute('aria-valuemax', '100');
        barOuter.setAttribute('aria-valuenow', '0');

        var bar = document.createElement('div');
        bar.className = 'cp-bar';

        var bufFill  = document.createElement('div');
        bufFill.className  = 'cp-buf';

        var progFill = document.createElement('div');
        progFill.className = 'cp-fill';

        var thumb = document.createElement('div');
        thumb.className = 'cp-thumb';

        bar.appendChild(bufFill);
        bar.appendChild(progFill);
        bar.appendChild(thumb);
        barOuter.appendChild(bar);

        var timesDiv = document.createElement('div');
        timesDiv.className = 'cp-times';

        var curEl = document.createElement('span');
        curEl.textContent = '0:00';

        var durEl = document.createElement('span');
        durEl.textContent = '—';

        timesDiv.appendChild(curEl);
        timesDiv.appendChild(durEl);

        right.appendChild(barOuter);
        right.appendChild(timesDiv);
        wrap.appendChild(btn);
        wrap.appendChild(right);

        // ── Icon SVGs ─────────────────────────────────────────────────────────
        var ICON = {
            play:    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><polygon points="7,4 20,12 7,20" fill="currentColor"/></svg>',
            pause:   '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="5"  y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="15" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>',
            loading: '<svg class="cp-spin" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="20 12" stroke-linecap="round"/></svg>',
        };

        function setIcon(state) {
            btn.innerHTML = ICON[state] || ICON.play;
            btn.setAttribute('aria-label',
                state === 'pause'   ? '一時停止' :
                state === 'loading' ? '読み込み中' : '再生');
        }

        setIcon('play');

        // ── Time formatter ────────────────────────────────────────────────────
        function fmt(sec) {
            if (!isFinite(sec) || sec < 0) return '—';
            var s = Math.floor(sec);
            var m = Math.floor(s / 60);
            var h = Math.floor(m / 60);
            m %= 60; s %= 60;
            var ss = (s < 10 ? '0' : '') + s;
            return h > 0
                ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss
                : m + ':' + ss;
        }

        // ── Progress & buffer update ──────────────────────────────────────────
        function updateBar() {
            if (seeking) return;
            var pct = audio.duration ? audio.currentTime / audio.duration : 0;
            var p   = (pct * 100).toFixed(2) + '%';
            progFill.style.width = p;
            thumb.style.left     = p;
            curEl.textContent    = fmt(audio.currentTime);
            barOuter.setAttribute('aria-valuenow', Math.round(pct * 100));
        }

        function updateBuf() {
            try {
                if (audio.buffered.length && audio.duration) {
                    var b = (audio.buffered.end(audio.buffered.length - 1) / audio.duration * 100).toFixed(2);
                    bufFill.style.width = b + '%';
                }
            } catch (e) { /* ignore */ }
        }

        // ── Seek helpers ──────────────────────────────────────────────────────
        function seekPct(pct) {
            pct = Math.max(0, Math.min(1, pct));
            if (audio.duration) audio.currentTime = audio.duration * pct;
            var p = (pct * 100).toFixed(2) + '%';
            progFill.style.width = p;
            thumb.style.left     = p;
            curEl.textContent    = fmt(audio.duration ? audio.duration * pct : 0);
        }

        function pctFromX(clientX) {
            var r = bar.getBoundingClientRect();
            return (clientX - r.left) / r.width;
        }

        // ── Mouse seek ────────────────────────────────────────────────────────
        barOuter.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            seeking = true;
            barOuter.classList.add('cp-seeking');
            seekPct(pctFromX(e.clientX));

            function onMove(ev) { seekPct(pctFromX(ev.clientX)); }
            function onUp() {
                seeking = false;
                barOuter.classList.remove('cp-seeking');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
            e.preventDefault();
        });

        // ── Touch seek ────────────────────────────────────────────────────────
        barOuter.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) return;
            seeking = true;
            barOuter.classList.add('cp-seeking');
            seekPct(pctFromX(e.touches[0].clientX));
            e.preventDefault();
        }, { passive: false });

        barOuter.addEventListener('touchmove', function (e) {
            if (!seeking || e.touches.length !== 1) return;
            seekPct(pctFromX(e.touches[0].clientX));
            e.preventDefault();
        }, { passive: false });

        barOuter.addEventListener('touchend', function () {
            seeking = false;
            barOuter.classList.remove('cp-seeking');
        });

        // ── Play / Pause button ───────────────────────────────────────────────
        btn.addEventListener('click', function () {
            if (audio.paused || audio.ended) {
                audio.play().catch(function () {});
            } else {
                audio.pause();
            }
        });

        // ── Audio events ──────────────────────────────────────────────────────
        audio.addEventListener('play',            function () { setIcon('pause'); });
        audio.addEventListener('pause',           function () { if (!audio.ended) setIcon('play'); });
        audio.addEventListener('waiting',         function () { setIcon('loading'); });
        audio.addEventListener('canplay',         function () { setIcon(audio.paused ? 'play' : 'pause'); });
        audio.addEventListener('timeupdate',      updateBar);
        audio.addEventListener('progress',        updateBuf);
        audio.addEventListener('durationchange',  function () { durEl.textContent = fmt(audio.duration); });
        audio.addEventListener('loadedmetadata',  function () { durEl.textContent = fmt(audio.duration); });

        // 再生終了: 先頭に戻してプレイアイコンへ
        audio.addEventListener('ended', function () {
            setIcon('play');
            audio.currentTime = 0;
            progFill.style.width = '0%';
            thumb.style.left     = '0%';
            curEl.textContent    = '0:00';
        });

        audio.addEventListener('error', function () {
            setIcon('play');
            curEl.textContent = 'エラー';
        });

        return { el: wrap, audio: audio };
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function render(track) {
        document.title = (track.title || '1999') + ' | 1999';
        if (titleEl) titleEl.textContent = track.title || '';

        var rawUrl    = (track.audioUrl || '').trim();
        var isSafeUrl = rawUrl && /^https?:\/\//i.test(rawUrl);
        var hasFile   = !!track.audioFile;
        var hasAudio  = hasFile || isSafeUrl;

        if (!hasAudio) {
            if (statusEl) statusEl.textContent = '準備中。';
        } else {
            if (statusEl) statusEl.textContent = '';
            if (audioEl)  audioEl.hidden = false;
        }

        // ── 1. ホスト配信: カスタムプレーヤー ────────────────────────────────
        if (hasFile && audioEl) {
            var cp = buildCustomPlayer('/api/music-file/' + encodeURIComponent(id));

            // Analytics: 初回再生時のみ発火
            var analyticsTracked = false;
            cp.audio.addEventListener('play', function () {
                if (!analyticsTracked) {
                    analyticsTracked = true;
                    if (window.AH && window.AH.track) {
                        window.AH.track('music_play', {
                            track:  track.title || '',
                            source: 'hosted',
                        });
                    }
                }
            });

            audioEl.appendChild(cp.el);
        }

        // ── 2. 外部リンク（YouTube / Spotify / etc.）──────────────────────────
        if (isSafeUrl && audioEl) {
            var btn = document.createElement('a');
            btn.setAttribute('href', rawUrl);
            btn.className   = 'play-button';
            btn.target      = '_blank';
            btn.rel         = 'noopener noreferrer';
            btn.textContent = hasFile ? '▶ 外部リンク' : '▶ 聴く';

            btn.addEventListener('click', function () {
                if (window.AH && window.AH.track) {
                    window.AH.track('music_play', {
                        track:  track.title || '',
                        source: 'external',
                    });
                }
            });

            audioEl.appendChild(btn);
        }

        // ── 3. 歌詞 ───────────────────────────────────────────────────────────
        if (track.lyrics && track.lyrics.trim()) {
            if (lyricsWrapEl) lyricsWrapEl.hidden = false;
            if (lyricsEl)     lyricsEl.textContent = track.lyrics;
        }
    }

    // ── API フェッチ ─────────────────────────────────────────────────────────
    fetch('/api/music/' + encodeURIComponent(id), { credentials: 'omit' })
        .then(function (r) {
            if (r.status === 404) throw { notFound: true };
            if (!r.ok) throw new Error('HTTP ' + r.status);
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
