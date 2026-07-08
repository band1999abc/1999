/**
 * api/insights.js  —  GET /api/insights
 *
 * Returns rule-based insights derived from all-time analytics,
 * diary, lives, and milestone achievement data.
 *
 * Response shape (AI-swappable design):
 *   "text" / "story" fields contain rule-generated text now.
 *   "_data" fields carry the raw numbers an AI could use instead.
 *   To add AI summaries: replace text fields only; keep _data intact.
 *
 * Admin-auth required (same as /api/analytics).
 */

import { readAnalyticsDays, getFirstDate } from './_analytics_store.js';
import { getAchievementDates }              from './_milestones_store.js';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';
import { readFileSync } from 'fs';
import { join }         from 'path';

// ── Milestone label lookup (kept lean — only for timeline/achievements) ───────

const MS_LABELS = {
    music_first: ['🎵','初回再生'],     music_100:   ['🎵','100 Plays'],
    music_500:   ['🎵','500 Plays'],    music_1000:  ['🎵','1,000 Plays'],
    music_5000:  ['🎵','5,000 Plays'],  music_10000: ['🎵','10,000 Plays'],
    vis_first:   ['👥','初回訪問'],      vis_100:     ['👥','100 Visitors'],
    vis_500:     ['👥','500 Visitors'],  vis_1000:    ['👥','1,000 Visitors'],
    vis_5000:    ['👥','5,000 Visitors'],
    ret_first:   ['🔄','初Returning Visitor'], ret_100: ['🔄','Returning 100人'],
    ret_rate_25: ['🔄','Returning Rate 25%'],  ret_rate_50: ['🔄','Returning Rate 50%'],
    qr_first:    ['📱','初QR Scan'],     qr_100:  ['📱','100 QR Scans'],
    qr_500:      ['📱','500 QR Scans'],  qr_1000: ['📱','1,000 QR Scans'],
    diary_first: ['📔','初Diary公開'],   diary_10:  ['📔','Diary 10件'],
    diary_50:    ['📔','Diary 50件'],    diary_100: ['📔','Diary 100件'],
    live_first:  ['🎤','初ライブ登録'],  live_10: ['🎤','ライブ 10本'],
    live_50:     ['🎤','ライブ 50本'],
    rel_first:   ['💿','初リリース'],    rel_5:  ['💿','楽曲 5曲'],
    rel_10:      ['💿','楽曲 10曲'],     rel_20: ['💿','楽曲 20曲'],
};

// ── Date utilities ────────────────────────────────────────────────────────────

function nowJST()      { return new Date(Date.now() + 9 * 3600000); }
function todayStr()    { return nowJST().toISOString().slice(0, 10); }
function monthStr(d)   { return d.slice(0, 7); }

function toJSTDate(ts) {
    return new Date(new Date(ts).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function toJSTHour(ts) {
    return new Date(new Date(ts).getTime() + 9 * 3600000).getUTCHours();
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function dateRange(start, end) {
    const out = [];
    let cur = new Date(start + 'T00:00:00Z');
    const fin = new Date(end   + 'T00:00:00Z');
    while (cur <= fin) { out.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
    return out;
}

/** Monday of the ISO week containing dateStr */
function weekMonday(dateStr) {
    const d   = new Date(dateStr + 'T00:00:00Z');
    const dow = d.getUTCDay();             // 0=Sun
    d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    return d.toISOString().slice(0, 10);
}

function prevMonthBounds(dateStr) {
    const [y, m] = dateStr.slice(0, 7).split('-').map(Number);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const pad = n => String(n).padStart(2, '0');
    const start = `${py}-${pad(pm)}-01`;
    const last  = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    const end   = `${py}-${pad(pm)}-${pad(last)}`;
    return [start, end];
}

// ── Event metric helpers ──────────────────────────────────────────────────────

// フロントエンドは 'page_view' を送信する（'visit' は未使用だが後方互換で残す）
const isVisit   = e => e.event === 'page_view' || e.event === 'visit';
const isPlay    = e => e.event === 'music_play';
const isQR      = e => e.event === 'qr_scan';
const isPage    = e => e.event === 'page_view';

function visitors(ev)  { return new Set(ev.filter(isVisit).map(e => e.visitor_id)).size; }
function returning(ev) { return new Set(ev.filter(e => isVisit(e) && e.is_new_visitor === false).map(e => e.visitor_id)).size; }
function retRate(ev)   { const v = visitors(ev); return v ? Math.round(returning(ev) / v * 100) : 0; }
function plays(ev)     { return ev.filter(isPlay).length; }
function qrScans(ev)   { return ev.filter(isQR).length; }
function pageViews(ev) { return ev.filter(isPage).length; }

function topTrack(ev) {
    const c = {};
    ev.forEach(e => { if (isPlay(e) && e.props?.track) c[e.props.track] = (c[e.props.track] || 0) + 1; });
    const s = Object.entries(c).sort((a, b) => b[1] - a[1]);
    return s.length ? { track: s[0][0], count: s[0][1] } : null;
}

function groupByDate(ev) {
    const g = {};
    ev.forEach(e => { const d = toJSTDate(e.ts); (g[d] = g[d] || []).push(e); });
    return g;
}

function pctChange(a, b) { return b ? Math.round((a - b) / b * 100) : null; }

function readJSON(rel) {
    try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')); }
    catch { return null; }
}

// ── Section generators ────────────────────────────────────────────────────────

/** Today's Insights — natural-language observations */
function buildToday(todayEv, yestEv, thisWeekEv, lastWeekEv, allByDate, recentLives) {
    const today = todayStr();
    const insights = [];

    const todayV = visitors(todayEv);
    const yestV  = visitors(yestEv);

    // 1. Visitor change vs yesterday
    if (todayV > 0 && yestV > 0) {
        const pct = pctChange(todayV, yestV);
        if (pct >= 10)
            insights.push({ id:'visitor_up',   icon:'📈', level:'positive', text:`昨日より Visitors が ${pct}% 増えました。` });
        else if (pct <= -10)
            insights.push({ id:'visitor_down', icon:'📉', level:'neutral',  text:`昨日より Visitors が ${Math.abs(pct)}% 減りました。` });
    } else if (todayV > 0 && yestV === 0) {
        insights.push({ id:'back_after_zero', icon:'👋', level:'positive', text:`昨日は訪問ゼロでしたが、今日は ${todayV} 人が訪れました。` });
    }

    // 2. Top track today
    const tt = topTrack(todayEv);
    if (tt)
        insights.push({ id:'top_track', icon:'🎵', level:'neutral', text:`「${tt.track}」が今日最も再生されました（${tt.count}回）。` });

    // 3. All-time high (need ≥7 days of history)
    const prevDates = Object.keys(allByDate).filter(d => d < today);
    if (prevDates.length >= 7) {
        const prevMax = prevDates.reduce((m, d) => Math.max(m, visitors(allByDate[d])), 0);
        if (todayV > prevMax && todayV > 0)
            insights.push({ id:'alltime_high', icon:'🎉', level:'positive', text:`今日は過去最高の訪問者数（${todayV} 人）です！` });
    }

    // 4. Post-live context
    const liveRecentlyAt = recentLives.find(l => {
        if (!l.date) return false;
        const diff = (new Date(today) - new Date(l.date)) / 86400000;
        return diff >= 0 && diff <= 2;
    });
    if (liveRecentlyAt) {
        const twPlays = plays(thisWeekEv), lwPlays = plays(lastWeekEv);
        if (twPlays > lwPlays * 1.15)
            insights.push({ id:'live_music_spike', icon:'🎤', level:'positive', text:'ライブ後に Music 再生数が増えています。' });
        else
            insights.push({ id:'live_context', icon:'🎤', level:'neutral', text:'直近にライブがありました。アクセスの動きを観察しましょう。' });
    }

    // 5. Returning rate improvement
    const thisRR = retRate(thisWeekEv), lastRR = retRate(lastWeekEv);
    if (thisRR > 0 && lastRR > 0 && thisRR >= lastRR + 5)
        insights.push({ id:'ret_up', icon:'🔄', level:'positive', text:`リピーター率が今週 ${thisRR}% と先週より上がっています。` });

    // 6. QR today
    const todayQR = qrScans(todayEv);
    if (todayQR > 0)
        insights.push({ id:'qr_today', icon:'📱', level:'neutral', text:`QR コード経由で今日 ${todayQR} 件のアクセスがありました。` });

    // 7. Default fallback
    if (!insights.length) {
        insights.push(todayV === 0
            ? { id:'quiet', icon:'🌙', level:'neutral', text:'今日はまだ訪問者がいません。' }
            : { id:'normal', icon:'✨', level:'neutral', text:`今日は ${todayV} 人が訪れました。` });
    }

    return {
        date: today,
        insights,
        _data: { visitorsToday:todayV, visitorsYest:yestV, playsToday:plays(todayEv),
                 topTrack:tt, qrToday:todayQR, retRateWeek:thisRR }
    };
}

/** Weekly Summary — metric table with week-over-week comparison */
function buildWeekly(thisWeekEv, lastWeekEv, thisStart, lastStart, today) {
    const mk = (key, label, icon, val, prev) =>
        ({ key, label, icon, value:val, prev, changePct: pctChange(val, prev) });
    return {
        period:     { start:thisStart, end:today },
        prevPeriod: { start:lastStart, end:addDays(thisStart, -1) },
        metrics: [
            mk('visitors',  'Visitors',          '👥', visitors(thisWeekEv),  visitors(lastWeekEv)),
            mk('plays',     'Music Plays',        '🎵', plays(thisWeekEv),     plays(lastWeekEv)),
            mk('returning', 'Returning Visitors', '🔄', returning(thisWeekEv), returning(lastWeekEv)),
            mk('qr',        'QR Scans',           '📱', qrScans(thisWeekEv),   qrScans(lastWeekEv)),
            mk('pageviews', 'Page Views',         '📄', pageViews(thisWeekEv), pageViews(lastWeekEv)),
        ],
        _data: { retRateThis:retRate(thisWeekEv), retRateLast:retRate(lastWeekEv) }
    };
}

/** Monthly Story — template-based narrative paragraph */
function buildMonthly(thisMonthEv, lastMonthEv, lives, diaries, mStr) {
    const thisV  = visitors(thisMonthEv),  lastV  = visitors(lastMonthEv);
    const thisRR = retRate(thisMonthEv),   thisPl = plays(thisMonthEv);
    const tt     = topTrack(thisMonthEv);
    const hasLive = lives.some(l => (l.date || '').startsWith(mStr));
    const pubDiaries = diaries.filter(d =>
        d.status === 'published' && (d.createdAt || d.date || '').startsWith(mStr));

    const parts = [];

    // Opening: visitor volume
    if (thisV === 0) {
        parts.push('今月はまだ訪問者がいません。');
    } else if (!lastV) {
        parts.push(`今月は ${thisV} 人が訪れました。`);
    } else {
        const pct = pctChange(thisV, lastV);
        if (pct >= 20)       parts.push(`今月は先月より ${pct}% 多くの人が訪れました。`);
        else if (pct >= 5)   parts.push('今月は先月よりやや多くの人が訪れました。');
        else if (pct <= -20) parts.push(`今月は先月より ${Math.abs(pct)}% 少ない訪問となりました。`);
        else                 parts.push('今月は先月と同程度の訪問者数でした。');
    }

    // Returning character
    if (thisV > 0) {
        if (thisRR >= 50)      parts.push('リピーターが多く、常連の人たちがよく戻ってきた一ヶ月でした。');
        else if (thisRR >= 25) parts.push('新しい訪問者とリピーターがバランスよく訪れました。');
        else                   parts.push('新しく訪れた人が中心の一ヶ月でした。');
    }

    // Live presence
    if (hasLive) parts.push('ライブがあり、その前後でサイトへのアクセスが増えました。');

    // Music highlight
    if (tt && thisPl > 0) parts.push(`「${tt.track}」が最も多く聴かれました（${tt.count}回）。`);

    // Diary activity
    if (pubDiaries.length > 0) parts.push(`Diary は今月 ${pubDiaries.length} 件公開されました。`);

    return {
        period: mStr,
        story: parts.length ? parts.join('') : 'まだデータが揃っていません。',
        _data: { visitorsThis:thisV, visitorsLast:lastV, retRate:thisRR,
                 plays:thisPl, hasLive, diaryCount:pubDiaries.length, topTrack:tt }
    };
}

/** Recommendations — rule-based improvement tips */
function buildRecommendations(allEv, lives, diaries, allByDate) {
    const recs = [];

    // 1. Peak hour
    const hourBin = new Array(24).fill(0);
    allEv.forEach(e => hourBin[toJSTHour(e.ts)]++);
    const total = hourBin.reduce((a, b) => a + b, 0);
    if (total > 0) {
        const peak = hourBin.indexOf(Math.max(...hourBin));
        if (hourBin[peak] / total > 0.12) {
            const end = (peak + 2) % 24;
            recs.push({ id:'peak_hour', icon:'🕐',
                text:`${peak}〜${end}時にアクセスが集中しています。この時間帯に合わせて更新すると効果的かもしれません。` });
        }
    }

    // 2. Diary → plays correlation
    const pubDiary = diaries.filter(d => d.status === 'published' && d.date);
    if (pubDiary.length >= 2) {
        const nDays  = Math.max(1, Object.keys(allByDate).length);
        const avgPl  = plays(allEv) / nDays;
        const spiked = pubDiary.filter(d => plays(allByDate[d.date] || []) > avgPl * 1.3).length;
        if (spiked / pubDiary.length >= 0.5)
            recs.push({ id:'diary_plays', icon:'📔',
                text:'Diary 公開日は Music 再生数が伸びる傾向があります。定期的な投稿が効果的です。' });
    }

    // 3. Post-live visitor spike
    const recentL = lives.filter(l => l.date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0, 6);
    const spiked  = recentL.filter(l => {
        const vBefore = visitors(allByDate[addDays(l.date, -1)] || []);
        const vAfter  = visitors(allByDate[addDays(l.date,  1)] || []);
        return vAfter > vBefore * 1.2 && vAfter > 0;
    }).length;
    if (recentL.length >= 2 && spiked / recentL.length >= 0.5)
        recs.push({ id:'post_live', icon:'🎤',
            text:'ライブ翌日に Visitors が増えています。ライブ告知をサイトでも強化すると効果的です。' });

    // 4. Returning rate
    const rr = retRate(allEv);
    const v  = visitors(allEv);
    if (rr < 25 && v >= 10)
        recs.push({ id:'low_returning', icon:'🔄',
            text:`リピーター率が ${rr}% と低めです。Diary や Music の定期更新でリピーターを増やしましょう。` });
    else if (rr >= 45 && v >= 10)
        recs.push({ id:'high_returning', icon:'🌟',
            text:`リピーター率が ${rr}% と高く、コアファンが育っています。新規訪問者を増やす施策も検討しましょう。` });

    // 5. QR usage
    const qr = qrScans(allEv);
    if (qr === 0 && lives.length > 0)
        recs.push({ id:'no_qr', icon:'📱',
            text:'ライブでの QR コード活用がまだありません。フライヤーへの掲載を検討してみてください。' });
    else if (qr > 0 && rr >= 25)
        recs.push({ id:'qr_working', icon:'📱',
            text:`QR 経由の訪問が ${qr} 件あり、フライヤーからのリピーターも定着しています。` });

    return recs.slice(0, 5);
}

/** Recent Achievement highlights (last N days) */
function buildAchievements(achievedDates, windowDays = 60) {
    const cutoff = addDays(todayStr(), -windowDays);
    return Object.entries(achievedDates)
        .filter(([, iso]) => iso && iso.slice(0, 10) >= cutoff)
        .map(([id, iso]) => {
            const [icon, label] = MS_LABELS[id] || ['🏆', id];
            return { id, icon, label, achievedAt: iso };
        })
        .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt))
        .slice(0, 8);
}

/** Timeline — recent diary posts, lives, milestones merged & sorted */
function buildTimeline(diaries, lives, achievedDates, windowDays = 90) {
    const cutoff = addDays(todayStr(), -windowDays);
    const items  = [];

    diaries.filter(d => d.status === 'published').forEach(d => {
        const date = (d.createdAt || d.date || '').slice(0, 10);
        if (date >= cutoff) items.push({ type:'diary', icon:'📔', label:'Diary', title:d.title || '(untitled)', date });
    });

    lives.forEach(l => {
        const date = (l.date || '').slice(0, 10);
        if (date >= cutoff) items.push({ type:'live', icon:'🎤', label:'Live', title:l.venue || 'ライブ', date });
    });

    Object.entries(achievedDates).forEach(([id, iso]) => {
        if (!iso) return;
        const date = iso.slice(0, 10);
        if (date >= cutoff) {
            const [icon, label] = MS_LABELS[id] || ['🏆', id];
            items.push({ type:'milestone', icon, label:'Milestone', title:label, date });
        }
    });

    return items
        .filter(i => i.date)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 20);
}

// ── Vercel handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    // Auth
    const cookies = parseCookies(req.headers.cookie || '');
    const token   = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
                  || cookies[COOKIE_NAME] || '';
    if (!token || !verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (req.method !== 'GET')          return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const today     = todayStr();
        const yesterday = addDays(today, -1);

        // Current/previous week
        const thisWeekStart = weekMonday(today);
        const lastWeekStart = addDays(thisWeekStart, -7);
        const lastWeekEnd   = addDays(thisWeekStart, -1);

        // Current/previous month
        const thisMonthStart       = monthStr(today) + '-01';
        const [prevMonthS, prevMonthE] = prevMonthBounds(today);

        // Determine earliest data date (for all-time grouping)
        const firstDate = await getFirstDate();

        // Load date ranges we need
        const allDates = firstDate ? dateRange(firstDate, today) : [];

        const [
            todayEv, yestEv, thisWeekEv, lastWeekEv, thisMonthEv, lastMonthEv, allEv,
        ] = await Promise.all([
            readAnalyticsDays([today]),
            readAnalyticsDays([yesterday]),
            readAnalyticsDays(dateRange(thisWeekStart, today)),
            readAnalyticsDays(dateRange(lastWeekStart, lastWeekEnd)),
            readAnalyticsDays(dateRange(thisMonthStart, today)),
            readAnalyticsDays(dateRange(prevMonthS, prevMonthE)),
            firstDate ? readAnalyticsDays(allDates) : Promise.resolve([]),
        ]);

        const allByDate = groupByDate(allEv);

        // Content data
        const diaries = readJSON('data/diary.json') || [];
        const lives   = readJSON('data/lives.json') || [];

        // Milestone achievements (all-time for timeline/achievements sections)
        const msIds    = Object.keys(MS_LABELS);
        const achieved = await getAchievementDates(msIds);

        // Recent lives (last 7 days) for today's context
        const recentLives = lives.filter(l => l.date && l.date >= addDays(today, -7));

        // Build all sections in parallel (CPU-bound, but structured for clarity)
        const todaySec        = buildToday(todayEv, yestEv, thisWeekEv, lastWeekEv, allByDate, recentLives);
        const weeklySec       = buildWeekly(thisWeekEv, lastWeekEv, thisWeekStart, lastWeekStart, today);
        const monthlySec      = buildMonthly(thisMonthEv, lastMonthEv, lives, diaries, monthStr(today));
        const achievementsSec = buildAchievements(achieved);
        const recommendSec    = buildRecommendations(allEv, lives, diaries, allByDate);
        const timelineSec     = buildTimeline(diaries, lives, achieved);

        res.status(200).json({
            generatedAt: new Date().toISOString(),
            today:        todaySec,
            weekly:       weeklySec,
            monthly:      monthlySec,
            achievements: achievementsSec,
            recommendations: recommendSec,
            timeline:     timelineSec,
        });
    } catch (err) {
        console.error('[insights]', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
