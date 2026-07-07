// Time-based greeting, night mode, and home message
// Night: 18:00 – 05:59  |  Day: 06:00 – 17:59
// Debug: ?night=1 forces night mode, ?weather=Clear|Rain|Snow… forces weather

(function () {
    'use strict';

    const now   = new Date();
    const hour  = now.getHours();
    const month = now.getMonth(); // 0-indexed

    // ── Night mode ────────────────────────────────────────────────
    const debugNight = new URLSearchParams(window.location.search).get('night');
    const isNight = debugNight === '1' || hour >= 18 || hour < 6;
    if (isNight) document.body.classList.add('night');

    // ── Helpers ───────────────────────────────────────────────────
    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function timeKey() {
        if (hour >= 6  && hour < 10) return 'morning';
        if (hour >= 10 && hour < 15) return 'midday';
        if (hour >= 15 && hour < 18) return 'afternoon';
        if (hour >= 18 && hour < 23) return 'evening';
        if (hour >= 23 || hour < 4)  return 'latenight';
        return 'dawn'; // 4–5
    }

    function seasonKey() {
        if (month >= 2 && month <= 4) return 'spring';   // 3–5月
        if (month >= 5 && month <= 7) return 'summer';   // 6–8月
        if (month >= 8 && month <= 10) return 'autumn';  // 9–11月
        return 'winter';                                  // 12–2月
    }

    function weatherKey(cond) {
        if (!cond) return null;
        if (cond === 'Clear') return 'clear';
        if (cond === 'Clouds') return 'cloudy';
        if (['Rain','Drizzle','Squall','Tornado'].indexOf(cond) >= 0) return 'rain';
        if (cond === 'Thunderstorm') return 'thunder';
        if (cond === 'Snow') return 'snow';
        return 'foggy'; // Mist, Fog, Haze, Smoke…
    }

    function todayStr() {
        return now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
    }

    // ── Greeting (1行目) ──────────────────────────────────────────
    const greetingEl = document.getElementById('greeting');
    if (greetingEl) {
        const greetings = {
            morning:   ['Good morning.', 'Rise and shine.', 'Morning.', 'A new day.', 'Still half asleep?'],
            midday:    ['Welcome.', 'Hello.', 'Hey.', "What's up.", 'Good to see you.'],
            afternoon: ['Take a break.', 'Afternoon.', 'Still here?', "How's the day going.", 'Almost there.'],
            evening:   ['Good evening.', 'Evening.', 'The night is young.', 'Welcome back.', 'Night owl.'],
            latenight: ['Still up?', "Can't sleep?", 'Late night.', 'Just you and the dark.', 'Night shift.'],
            dawn:      ['Up already?', 'Almost morning.', "The sun's coming.", 'Early bird.', 'Dawn breaking.'],
        };
        greetingEl.textContent = pick(greetings[timeKey()]);
    }

    // ── Home message (3–4行目) ────────────────────────────────────
    const msgEl = document.getElementById('home-message');
    if (msgEl) {

        // ── メッセージプール ──────────────────────────────────────

        const MSG_TIME = {
            morning: [
                'おはようございます。',
                '今日もいい朝を。',
                'コーヒーでもどうぞ。',
                'ゆっくり目を覚まして。',
                '今日はどんな一日でしょうか。',
                '朝の音楽もいいですよ。',
                'いい朝ですね。',
            ],
            midday: [
                'ごゆっくり。',
                '今日はのんびりどうぞ。',
                '少し休んでいきませんか。',
                '気になるところからどうぞ。',
                '今日も開いています。',
                '音楽でもどうぞ。',
                'お昼の時間に来てくれたんですね。',
            ],
            afternoon: [
                '一息つきませんか。',
                'もうすぐ夜ですね。',
                'お疲れ様でした。',
                '夕暮れ前のひとときを。',
                '今日もありがとうございます。',
                'ゆっくりしていきませんか。',
                'もう少しで終わりますね。',
            ],
            evening: [
                '今夜もどうぞ。',
                'ゆっくりどうぞ。',
                '夜の音楽もいいですよ。',
                '静かな夜に。',
                '夜のはじまりに。',
                '夜長をどうぞ。',
                '今夜はいい夜ですね。',
            ],
            latenight: [
                'こんな時間に来てくれたんですね。',
                '眠れない夜ですか。',
                '深夜のひとときを。',
                '静かですね。',
                '夜中の音楽もどうぞ。',
                'ゆっくりどうぞ。',
            ],
            dawn: [
                '夜明け前ですね。',
                'もう少しで朝です。',
                '静かな時間ですね。',
                '夜が明けていきますね。',
                '朝が来る前に。',
            ],
        };

        const MSG_SEASON = {
            spring: [
                '桜が咲いているといいですね。',
                'いい季節になりましたね。',
                '春の夜も悪くないですよ。',
                '窓を開けてみてください。',
                '春の音楽をどうぞ。',
                '過ごしやすい季節ですね。',
            ],
            summer: [
                '暑い日が続きますね。',
                '冷たいものでも飲みながらどうぞ。',
                '夏の夜もいいですね。',
                '涼しくしてお過ごしください。',
                '夏の音楽でもどうぞ。',
                '今夜も暑いですね。',
            ],
            autumn: [
                '秋の夜長に。',
                '過ごしやすい季節になりましたね。',
                '秋の音楽もいいですよ。',
                '深まる秋の夜に。',
                'ゆっくりした夜に。',
            ],
            winter: [
                '温かい飲み物がおすすめです。',
                '寒い日が続きますね。',
                '冬の夜もいいものですよ。',
                '暖かくしてどうぞ。',
                '温かいところでゆっくりどうぞ。',
                '今夜は特に寒いですね。',
            ],
        };

        const MSG_WEATHER = {
            clear: [
                'いい天気ですね。',
                '晴れた日は気持ちいいですね。',
                '今日は外も気持ちよさそう。',
                'きれいな空が広がっています。',
                '晴れの日の音楽もいいですよ。',
            ],
            cloudy: [
                '曇り空もいいものです。',
                '穏やかな天気ですね。',
                '静かな一日ですね。',
                '曇りの日はゆっくりするのがいい。',
                'どんよりした日も悪くないです。',
            ],
            rain: [
                '雨音も悪くないですね。',
                '雨の日はゆっくりするのがいい。',
                '雨音を聞きながらどうぞ。',
                '雨の日の音楽もどうぞ。',
                '今日は雨ですね。',
                '外は雨ですよ。',
            ],
            snow: [
                '雪が降っているようですね。',
                '静かな雪の日に。',
                '雪の夜はいいものです。',
                '外は雪です。暖かくしてどうぞ。',
                '雪の日はゆっくりしましょう。',
            ],
            thunder: [
                '嵐の夜ですね。',
                '外は荒れていますね。',
                '今夜は家でゆっくりしましょう。',
                '雨風が強いですね。',
                '安全な場所でどうぞ。',
            ],
            foggy: [
                '霧がかかっていますね。',
                '今日はぼんやりした天気ですね。',
                '霧の日も悪くないですよ。',
                '煙るような空ですね。',
            ],
        };

        const MSG_RARE = [
            '今日はクジラが近くまで来ています。',
            '少しだけ潮の匂いがします。',
            '音楽日和です。',
            'いつもありがとうございます。',
            '今夜、星が見えるといいですね。',
            'どこかで誰かも同じ音楽を聴いているかもしれません。',
        ];

        // ── メッセージ表示 ─────────────────────────────────────────
        function showMessage(html) {
            msgEl.innerHTML = html;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    msgEl.classList.add('visible');
                });
            });
        }

        function isLiveToday(lives) {
            const today = todayStr();
            return Array.isArray(lives) && lives.some(function (l) { return l.date === today; });
        }

        function buildMessage(condition, lives) {
            // レアメッセージ（約2%）
            if (Math.random() < 0.02) {
                showMessage('<p>' + pick(MSG_RARE) + '</p>');
                return;
            }

            // ライブ当日
            if (isLiveToday(lives)) {
                showMessage(
                    '<p>好きなように過ごしてください。</p>' +
                    '<p>一緒に歌ってもいいし、</p>' +
                    '<p>コーヒーを飲みながら眺めるだけでも。</p>'
                );
                return;
            }

            // 通常：時間帯＋季節＋天気のプールを合算してランダム
            let pool = MSG_TIME[timeKey()].concat(MSG_SEASON[seasonKey()]);
            const wk = weatherKey(condition);
            if (wk && MSG_WEATHER[wk]) {
                pool = pool.concat(MSG_WEATHER[wk]);
            }
            showMessage('<p>' + pick(pool) + '</p>');
        }

        // ── weatherReady イベント待機 ──────────────────────────────
        const weatherPromise = new Promise(function (resolve) {
            const timer = setTimeout(function () { resolve(null); }, 6000);
            window.addEventListener('weatherReady', function (e) {
                clearTimeout(timer);
                resolve(e.detail && e.detail.condition);
            }, { once: true });
        });

        // ── ライブ当日チェック ─────────────────────────────────────
        const livePromise = fetch('/api/live')
            .then(function (r) { return r.json(); })
            .catch(function () { return []; });

        // ── 両方揃ったらメッセージ決定 ────────────────────────────
        Promise.all([weatherPromise, livePromise]).then(function (results) {
            buildMessage(results[0], results[1]);
        });
    }

    // ── 隠し管理画面：h1 を3秒以内に5回クリック ─────────────────
    const h1 = document.querySelector('h1');
    if (h1) {
        let _n = 0, _t = null;
        h1.addEventListener('click', function () {
            _n++;
            clearTimeout(_t);
            _t = setTimeout(function () { _n = 0; }, 3000);
            if (_n >= 5) {
                _n = 0;
                clearTimeout(_t);
                window.location.href = '/afterhours';
            }
        });
    }
}());
