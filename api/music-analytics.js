/**
 * api/music-analytics.js  —  GET /api/music-analytics
 *
 * Returns all Music Analytics data computed from analytics events.
 * Response is designed to be AI/external-datasource-extensible:
 *   _meta.dataSources lists active sources
 *   _meta.futureDataSources lists planned integrations (Spotify, Apple Music, YouTube)
 *
 * Fields that require play-time tracking (avgDuration, completionRate) return
 * null today because analytics.js only fires 'music_play' on click, not on
 * seek/end. Add tracking and populate these fields when available.
 *
 * Admin-auth required.
 */

import { readAnalyticsDays, getFirstDate } from './_analytics_store.js';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Date utilities ────────────────────────────────────────────────────────────

function nowJST()    { return new Date(Date.now() + 9 * 3600000); }
function todayStr()  { return nowJST().toISOString().slice(0, 10); }

function toJSTDate(ts) {
    return new Date(new Date(ts).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function toJSTDow(ts) {
    return new Date(new Date(ts).getTime() + 9 * 3600000).getUTCDay(); // 0=Sun
}

function addDays(d, n) {
    const dt = new Date(d + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
}

function dateRange(start, end) {
    const out = [];
    let cur = new Date(start + 'T00:00:00Z');
    const fin = new Date(end + 'T00:00:00Z');
    while (cur <= fin) { out.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
    return out;
}

function weekMonday(d) {
    const dt = new Date(d + 'T00:00:00Z');
    const dow = dt.getUTCDay();
    dt.setUTCDate(dt.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    return dt.toISOString().slice(0, 10);
}

function monthStart(d) { return d.slice(0, 7) + '-01'; }

function readJSON(rel) {
    try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')); }
    catch { return null; }
}

// ── Core computation ──────────────────────────────────────────────────────────

function buildMusicData(allEvents, lives, diaries, today) {
    const yesterday    = addDays(today, -1);
    const thisWeekStart = weekMonday(today);
    const thisMonthStart = monthStart(today);

    // ── 1. Filter & group music_play events ──────────────────────────────────
    const musicEvents = allEvents
        .filter(e => e.event === 'music_play' && e.props?.track)
        .sort((a, b) => a.ts.localeCompare(b.ts));

    const tracks = [...new Set(musicEvents.map(e => e.props.track))];

    if (!tracks.length) {
        return {
            overview: { totalSongs:0, totalPlays:0, uniqueListeners:0,
                        playsToday:0, playsThisWeek:0, playsThisMonth:0 },
            songs: [], chartData: { dates:[], cumulative:{}, daily:{} },
            insights: [], achievements: null, timeline: [], _meta: _meta()
        };
    }

    // ── 2. Per-track data structures ─────────────────────────────────────────
    // trackMap[track] = { events[], visitorSessions: { visitorId: Set(sessionId) } }
    const trackMap = {};
    tracks.forEach(t => { trackMap[t] = { events: [], vs: {} }; });

    musicEvents.forEach(e => {
        const td = trackMap[e.props.track];
        td.events.push(e);
        if (!td.vs[e.visitor_id]) td.vs[e.visitor_id] = new Set();
        td.vs[e.visitor_id].add(e.session_id);
    });

    // ── 3. Chart data (cumulative by day) ────────────────────────────────────
    const firstEventDate = musicEvents[0]?.ts ? toJSTDate(musicEvents[0].ts) : today;
    const allDates       = dateRange(firstEventDate, today);

    // daily plays per track aligned to allDates
    const daily = {};
    tracks.forEach(t => { daily[t] = new Array(allDates.length).fill(0); });

    musicEvents.forEach(e => {
        const d   = toJSTDate(e.ts);
        const idx = allDates.indexOf(d);
        if (idx >= 0) daily[e.props.track][idx]++;
    });

    // cumulative (never decreasing)
    const cumulative = {};
    tracks.forEach(t => {
        let running = 0;
        cumulative[t] = daily[t].map(n => (running += n));
    });

    // ── 4. Per-song metrics ───────────────────────────────────────────────────
    const songs = tracks.map(track => {
        const td  = trackMap[track];
        const ev  = td.events;
        const vs  = td.vs;

        const firstSeenDate = toJSTDate(ev[0].ts);
        const lastPlayDate  = toJSTDate(ev[ev.length - 1].ts);
        const totalPlays    = ev.length;
        const uniqueListeners = Object.keys(vs).length;

        // Returning: visitors who played in 2+ distinct sessions
        const returningCount = Object.values(vs).filter(s => s.size >= 2).length;
        const retRate = uniqueListeners ? Math.round(returningCount / uniqueListeners * 100) : 0;

        // Period plays
        const playsToday     = ev.filter(e => toJSTDate(e.ts) === today).length;
        const playsYest      = ev.filter(e => toJSTDate(e.ts) === yesterday).length;
        const playsThisWeek  = ev.filter(e => toJSTDate(e.ts) >= thisWeekStart).length;
        const playsThisMonth = ev.filter(e => toJSTDate(e.ts) >= thisMonthStart).length;

        // Day of week distribution
        const dowCounts = new Array(7).fill(0);
        ev.forEach(e => dowCounts[toJSTDow(e.ts)]++);

        // Milestones (find the N-th play event's date)
        const milestoneLevels = [100, 500, 1000, 5000, 10000];
        const milestones = {};
        milestoneLevels.forEach(n => {
            milestones[String(n)] = ev[n - 1] ? toJSTDate(ev[n - 1].ts) : null;
        });

        // Release Impact (plays & unique visitors within windows from firstSeenDate)
        const firstTs = new Date(ev[0].ts).getTime();
        function impact(ms) {
            const windowEv = ev.filter(e => new Date(e.ts).getTime() - firstTs <= ms);
            return {
                plays: windowEv.length,
                uniqueListeners: new Set(windowEv.map(e => e.visitor_id)).size,
            };
        }
        const releaseImpact = {
            h24: impact(24 * 3600 * 1000),
            d7:  impact(7  * 86400 * 1000),
            d30: impact(30 * 86400 * 1000),
        };

        // Stability: plays after day 30 / total plays
        const afterD30 = ev.filter(e => new Date(e.ts).getTime() - firstTs > 30 * 86400 * 1000).length;
        const stabilityRate = totalPlays ? Math.round(afterD30 / totalPlays * 100) : 0;

        return {
            track, firstSeenDate, lastPlayDate, totalPlays, uniqueListeners,
            retRate, playsToday, playsYest, playsThisWeek, playsThisMonth,
            dowCounts, milestones, releaseImpact, stabilityRate,
            // Null fields — requires play-time tracking in analytics.js
            avgDuration: null, completionRate: null,
        };
    });

    // ── 5. Overview ───────────────────────────────────────────────────────────
    const totalPlays = musicEvents.length;
    const allVisitors = new Set(musicEvents.map(e => e.visitor_id));
    const overview = {
        totalSongs:      tracks.length,
        totalPlays,
        uniqueListeners: allVisitors.size,
        playsToday:      musicEvents.filter(e => toJSTDate(e.ts) === today).length,
        playsThisWeek:   musicEvents.filter(e => toJSTDate(e.ts) >= thisWeekStart).length,
        playsThisMonth:  musicEvents.filter(e => toJSTDate(e.ts) >= thisMonthStart).length,
        avgDuration:     null, // requires play-time tracking
        avgCompletion:   null, // requires play-time tracking
    };

    // ── 6. Insights ───────────────────────────────────────────────────────────
    const insights = buildMusicInsights(songs, musicEvents, lives, allDates, daily);

    // ── 7. Achievements ───────────────────────────────────────────────────────
    const achievements = buildAchievements(songs);

    // ── 8. Timeline ───────────────────────────────────────────────────────────
    const timeline = buildTimeline(songs, lives, diaries, today);

    return {
        overview,
        songs: songs.sort((a, b) => b.totalPlays - a.totalPlays),
        chartData: { dates: allDates, cumulative, daily },
        insights,
        achievements,
        timeline,
        _meta: _meta(),
    };
}

// ── Insight rules ─────────────────────────────────────────────────────────────

function buildMusicInsights(songs, allMusicEvents, lives, allDates, daily) {
    const ins = [];

    // 1. Top song
    if (songs.length) {
        const top = songs[0];
        ins.push({ id:'top_song', icon:'🎵',
            text:`「${top.track}」が最も多く再生されています（${top.totalPlays.toLocaleString()}回）。` });
    }

    // 2. Live → plays spike correlation
    const recentLives = lives.filter(l => l.date).slice(-5);
    let liveSpike = 0;
    recentLives.forEach(l => {
        const dayAfterIdx = allDates.indexOf(l.date.slice(0, 10)) + 1;
        if (dayAfterIdx <= 0 || dayAfterIdx >= allDates.length) return;
        const totalNextDay = songs.reduce((s, song) => s + (daily[song.track]?.[dayAfterIdx] || 0), 0);
        const avgDay = songs.reduce((s, song) => s + (daily[song.track]?.slice(Math.max(0, dayAfterIdx - 7), dayAfterIdx).reduce((a, b) => a + b, 0) / 7 || 0), 0);
        if (totalNextDay > avgDay * 1.3) liveSpike++;
    });
    if (recentLives.length >= 2 && liveSpike / recentLives.length >= 0.5)
        ins.push({ id:'live_spike', icon:'🎤', text:'ライブ翌日に Music 再生数が最も伸びています。' });

    // 3. Sustained song (stable after 30d)
    const sustained = songs.filter(s => s.stabilityRate >= 50 && s.totalPlays >= 20);
    if (sustained.length)
        ins.push({ id:'sustained', icon:'📈',
            text:`「${sustained[0].track}」は公開30日以降も安定して再生されています。` });

    // 4. Fastest growing (highest plays-in-last-30d / total)
    const thirtyAgo = addDays(allDates[allDates.length - 1] || todayStr(), -30);
    const withRecent = songs.map(s => {
        const idx30 = allDates.findIndex(d => d >= thirtyAgo);
        const recent = idx30 >= 0 ? (daily[s.track]?.slice(idx30).reduce((a,b)=>a+b,0) || 0) : 0;
        return { ...s, recentPlays: recent };
    }).filter(s => s.totalPlays >= 10);
    withRecent.sort((a, b) => (b.recentPlays / b.totalPlays) - (a.recentPlays / a.totalPlays));
    if (withRecent.length >= 2 && withRecent[0].recentPlays / withRecent[0].totalPlays > 0.6)
        ins.push({ id:'fastest_growing', icon:'🚀',
            text:`「${withRecent[0].track}」が最近の30日間で最も伸びています。` });

    // 5. Day-of-week pattern (across all songs)
    const dowNames = ['日','月','火','水','木','金','土'];
    const allDow = new Array(7).fill(0);
    songs.forEach(s => s.dowCounts.forEach((n, i) => allDow[i] += n));
    const peakDow = allDow.indexOf(Math.max(...allDow));
    if (allDow[peakDow] > 0 && allDow[peakDow] / allMusicEvents.length > 0.2)
        ins.push({ id:'peak_dow', icon:'📅',
            text:`${dowNames[peakDow]}曜日に再生数が集中しています。` });

    // 6. High loyalty song
    const loyal = [...songs].sort((a, b) => b.retRate - a.retRate)[0];
    if (loyal && loyal.retRate >= 30)
        ins.push({ id:'loyal', icon:'❤️',
            text:`「${loyal.track}」はリピーターが多く、ファンに継続的に愛されています（Returning ${loyal.retRate}%）。` });

    return ins.slice(0, 5);
}

// ── Achievements ──────────────────────────────────────────────────────────────

function buildAchievements(songs) {
    if (!songs.length) return null;
    const byPlays   = [...songs].sort((a, b) => b.totalPlays - a.totalPlays)[0];
    const byLoyal   = [...songs].sort((a, b) => b.retRate - a.retRate)[0];

    // Fastest growing: highest ratio of recent plays (last 30d) to all-time
    const byGrowth  = [...songs]
        .filter(s => s.playsThisMonth > 0)
        .sort((a, b) => (b.playsThisMonth / Math.max(1, b.totalPlays)) - (a.playsThisMonth / Math.max(1, a.totalPlays)))[0] || null;

    // Longest active: most days between first and last play
    const byActive  = [...songs].sort((a, b) => {
        const dA = (new Date(a.lastPlayDate) - new Date(a.firstSeenDate)) / 86400000;
        const dB = (new Date(b.lastPlayDate) - new Date(b.firstSeenDate)) / 86400000;
        return dB - dA;
    })[0];

    return {
        mostPlayed:     { track: byPlays.track,  value: byPlays.totalPlays,   unit: 'Plays' },
        fastestGrowing: byGrowth ? { track: byGrowth.track, value: byGrowth.playsThisMonth, unit: '直近30日再生' } : null,
        mostLoyal:      { track: byLoyal.track,  value: byLoyal.retRate,       unit: '% Returning' },
        longestActive:  { track: byActive.track,
                          value: Math.round((new Date(byActive.lastPlayDate) - new Date(byActive.firstSeenDate)) / 86400000),
                          unit: '日間' },
    };
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function buildTimeline(songs, lives, diaries, today) {
    const cutoff = addDays(today, -180);
    const items  = [];

    // Releases (first-seen date per track)
    songs.forEach(s => {
        if (s.firstSeenDate >= cutoff)
            items.push({ date: s.firstSeenDate, type:'release', icon:'💿', title: s.track, track: s.track });
    });

    // Lives
    lives.forEach(l => {
        const d = (l.date || '').slice(0, 10);
        if (d >= cutoff)
            items.push({ date: d, type:'live', icon:'🎤', title: l.venue || 'ライブ', track: null });
    });

    // Diary posts
    (diaries || []).filter(d => d.status === 'published').forEach(d => {
        const dt = (d.createdAt || d.date || '').slice(0, 10);
        if (dt >= cutoff)
            items.push({ date: dt, type:'diary', icon:'📔', title: d.title || '(untitled)', track: null });
    });

    // Song milestones (100/500/1000 plays)
    songs.forEach(s => {
        [100, 500, 1000].forEach(n => {
            const dt = s.milestones[String(n)];
            if (dt && dt >= cutoff)
                items.push({ date: dt, type:'milestone', icon:'🏆', title:`「${s.track}」${n} Plays`, track: s.track });
        });
    });

    return items.filter(i => i.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
}

// ── Meta ──────────────────────────────────────────────────────────────────────

function _meta() {
    return {
        dataSources: ['analytics'],
        futureDataSources: ['spotify', 'apple_music', 'youtube'],
        trackedFields: ['plays', 'unique_listeners', 'returning_rate', 'release_date'],
        untrackedFields: ['duration', 'completion_rate'],
        note: 'avgDuration and completionRate are null until play-time tracking is added to analytics.js',
    };
}

// ── Vercel handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    const cookies = parseCookies(req.headers.cookie || '');
    const token   = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
                  || cookies[COOKIE_NAME] || '';
    if (!token || !verifyToken(token)) return res.status(401).json({ error:'Unauthorized' });
    if (req.method !== 'GET')          return res.status(405).json({ error:'Method Not Allowed' });

    try {
        const today     = todayStr();
        const firstDate = await getFirstDate();
        const allEvents = firstDate
            ? await readAnalyticsDays(dateRange(firstDate, today))
            : [];

        const lives   = readJSON('data/lives.json')  || [];
        const diaries = readJSON('data/diary.json')  || [];

        const data = buildMusicData(allEvents, lives, diaries, today);
        res.status(200).json(data);
    } catch (err) {
        console.error('[music-analytics]', err);
        res.status(500).json({ error:'Internal Server Error' });
    }
}
