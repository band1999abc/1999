/**
 * Vercel Serverless Function: /api/milestones
 *
 * GET — return all milestones with current state (admin only).
 *
 * Achievement dates are computed exactly from raw data
 * (N-th event / N-th unique visitor / etc.), then cached
 * write-once in KV so subsequent calls skip the scan.
 *
 * ── Adding a new milestone ────────────────────────────────────────
 * 1. Add one object to MILESTONE_DEFS.
 * 2. Implement dateFrom(events, diaries, lives) → ISO string | null.
 * 3. Implement current(events, diaries, lives)  → number.
 * No other changes required.
 * ─────────────────────────────────────────────────────────────────
 */

import { readAnalyticsDays, getFirstDate } from './_analytics_store.js';
import { getAchievementDates, setAchievementDateIfNew } from './_milestones_store.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';

// ── Utilities ─────────────────────────────────────────────────────────────────

function todayJST() {
    return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

function dateRange(start, end) {
    const dates = [];
    let cur  = new Date(start + 'T00:00:00Z');
    const last = new Date(end   + 'T00:00:00Z');
    while (cur <= last) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

function readJSON(relPath) {
    try { return JSON.parse(readFileSync(join(process.cwd(), relPath), 'utf-8')); }
    catch { return null; }
}

// ── Achievement-date detector helpers ────────────────────────────────────────
// events must be sorted ascending by ts before calling these.

function nthEvent(events, type, n) {
    let c = 0;
    for (const e of events) {
        if (e.event === type && ++c >= n) return e.ts;
    }
    return null;
}

// フロントエンドは 'page_view' を送信する（'visit' は未使用だが後方互換で残す）
function _isVisitEvent(e) {
    return e.event === 'page_view' || e.event === 'visit';
}

function nthUniqueVisitor(events, n) {
    const seen = new Set();
    for (const e of events) {
        if (!_isVisitEvent(e) || seen.has(e.visitor_id)) continue;
        seen.add(e.visitor_id);
        if (seen.size >= n) return e.ts;
    }
    return null;
}

function nthReturningVisitor(events, n) {
    const seen = new Set();
    for (const e of events) {
        if (!_isVisitEvent(e) || e.is_new_visitor !== false || seen.has(e.visitor_id)) continue;
        seen.add(e.visitor_id);
        if (seen.size >= n) return e.ts;
    }
    return null;
}

function firstReturnRateDate(events, targetPct) {
    const all = new Set(), ret = new Set();
    for (const e of events) {
        if (!_isVisitEvent(e)) continue;
        all.add(e.visitor_id);
        if (e.is_new_visitor === false) ret.add(e.visitor_id);
        if (all.size && Math.round(ret.size / all.size * 100) >= targetPct) return e.ts;
    }
    return null;
}

function nthUniqueTrack(events, n) {
    const seen = new Set();
    for (const e of events) {
        const t = e.event === 'music_play' && e.props?.track;
        if (!t || seen.has(t)) continue;
        seen.add(t);
        if (seen.size >= n) return e.ts;
    }
    return null;
}

function nthDiary(diaries, n) {
    // Sort by createdAt (registration time), not by `date` (content/event date).
    // If createdAt is absent on a record, sort last — do not use `date` as proxy.
    const pub = (diaries || [])
        .filter(d => d.status === 'published')
        .sort((a, b) => (a.createdAt || 'zzz').localeCompare(b.createdAt || 'zzz'));
    const d = pub[n - 1];
    return d ? (d.createdAt || null) : null;
}

function nthLive(lives, n) {
    // Sort by createdAt (registration time), NOT by `date` (performance date).
    // Using `date` would produce the wrong order for "初ライブ登録" milestones.
    const sorted = (lives || [])
        .sort((a, b) => (a.createdAt || 'zzz').localeCompare(b.createdAt || 'zzz'));
    const l = sorted[n - 1];
    return l ? (l.createdAt || null) : null;
}

// ── Shared current-value helpers ─────────────────────────────────────────────

const _musicPlays    = (ev)       => ev.filter(e => e.event === 'music_play').length;
const _visitors      = (ev)       => new Set(ev.filter(_isVisitEvent).map(e => e.visitor_id)).size;
const _returning     = (ev)       => new Set(ev.filter(e => _isVisitEvent(e) && e.is_new_visitor === false).map(e => e.visitor_id)).size;
const _retRate       = (ev)       => { const v = _visitors(ev); return v ? Math.round(_returning(ev) / v * 100) : 0; };
const _qrScans       = (ev)       => ev.filter(e => e.event === 'qr_scan').length;
const _releases      = (ev)       => new Set(ev.filter(e => e.event === 'music_play' && e.props?.track).map(e => e.props.track)).size;
const _diariesPub    = (ev, di)   => (di || []).filter(d => d.status === 'published').length;
const _livesCount    = (ev, di, li) => (li || []).length;

// ── Milestone definitions ─────────────────────────────────────────────────────

const MILESTONE_DEFS = [

    // ── Music ─────────────────────────────────────────────────────────────
    { id: 'music_first',  cat: 'Music', catIcon: '🎵', label: '初回再生',
      target: 1,     unit: 'Play',   metric: 'music_plays',
      current: _musicPlays, dateFrom: (ev) => nthEvent(ev, 'music_play', 1) },

    { id: 'music_100',    cat: 'Music', catIcon: '🎵', label: '100 Plays',
      target: 100,   unit: 'Plays',  metric: 'music_plays',
      current: _musicPlays, dateFrom: (ev) => nthEvent(ev, 'music_play', 100) },

    { id: 'music_500',    cat: 'Music', catIcon: '🎵', label: '500 Plays',
      target: 500,   unit: 'Plays',  metric: 'music_plays',
      current: _musicPlays, dateFrom: (ev) => nthEvent(ev, 'music_play', 500) },

    { id: 'music_1000',   cat: 'Music', catIcon: '🎵', label: '1000 Plays',
      target: 1000,  unit: 'Plays',  metric: 'music_plays',
      current: _musicPlays, dateFrom: (ev) => nthEvent(ev, 'music_play', 1000) },

    { id: 'music_5000',   cat: 'Music', catIcon: '🎵', label: '5000 Plays',
      target: 5000,  unit: 'Plays',  metric: 'music_plays',
      current: _musicPlays, dateFrom: (ev) => nthEvent(ev, 'music_play', 5000) },

    { id: 'music_10000',  cat: 'Music', catIcon: '🎵', label: '10000 Plays',
      target: 10000, unit: 'Plays',  metric: 'music_plays',
      current: _musicPlays, dateFrom: (ev) => nthEvent(ev, 'music_play', 10000) },

    // ── Visitors ──────────────────────────────────────────────────────────
    { id: 'vis_first',    cat: 'Visitors', catIcon: '👥', label: '初回訪問',
      target: 1,    unit: 'Visitor',  metric: 'visitors',
      current: _visitors, dateFrom: (ev) => nthUniqueVisitor(ev, 1) },

    { id: 'vis_100',      cat: 'Visitors', catIcon: '👥', label: '100 Visitors',
      target: 100,  unit: 'Visitors', metric: 'visitors',
      current: _visitors, dateFrom: (ev) => nthUniqueVisitor(ev, 100) },

    { id: 'vis_500',      cat: 'Visitors', catIcon: '👥', label: '500 Visitors',
      target: 500,  unit: 'Visitors', metric: 'visitors',
      current: _visitors, dateFrom: (ev) => nthUniqueVisitor(ev, 500) },

    { id: 'vis_1000',     cat: 'Visitors', catIcon: '👥', label: '1000 Visitors',
      target: 1000, unit: 'Visitors', metric: 'visitors',
      current: _visitors, dateFrom: (ev) => nthUniqueVisitor(ev, 1000) },

    { id: 'vis_5000',     cat: 'Visitors', catIcon: '👥', label: '5000 Visitors',
      target: 5000, unit: 'Visitors', metric: 'visitors',
      current: _visitors, dateFrom: (ev) => nthUniqueVisitor(ev, 5000) },

    // ── Returning ─────────────────────────────────────────────────────────
    { id: 'ret_first',    cat: 'Returning', catIcon: '🔄', label: '初めてのReturning Visitor',
      target: 1,  unit: '人', metric: 'returning',
      current: _returning, dateFrom: (ev) => nthReturningVisitor(ev, 1) },

    { id: 'ret_100',      cat: 'Returning', catIcon: '🔄', label: 'Returning Visitor 100人',
      target: 100, unit: '人', metric: 'returning',
      current: _returning, dateFrom: (ev) => nthReturningVisitor(ev, 100) },

    { id: 'ret_rate_25',  cat: 'Returning', catIcon: '🔄', label: 'Returning Rate 25%',
      target: 25, unit: '%', metric: 'ret_rate',
      current: _retRate, dateFrom: (ev) => firstReturnRateDate(ev, 25) },

    { id: 'ret_rate_50',  cat: 'Returning', catIcon: '🔄', label: 'Returning Rate 50%',
      target: 50, unit: '%', metric: 'ret_rate',
      current: _retRate, dateFrom: (ev) => firstReturnRateDate(ev, 50) },

    // ── QR ────────────────────────────────────────────────────────────────
    { id: 'qr_first',     cat: 'QR', catIcon: '📱', label: '初回QR Scan',
      target: 1,    unit: 'Scan',   metric: 'qr_scans',
      current: _qrScans, dateFrom: (ev) => nthEvent(ev, 'qr_scan', 1) },

    { id: 'qr_100',       cat: 'QR', catIcon: '📱', label: '100 QR Scans',
      target: 100,  unit: 'Scans',  metric: 'qr_scans',
      current: _qrScans, dateFrom: (ev) => nthEvent(ev, 'qr_scan', 100) },

    { id: 'qr_500',       cat: 'QR', catIcon: '📱', label: '500 QR Scans',
      target: 500,  unit: 'Scans',  metric: 'qr_scans',
      current: _qrScans, dateFrom: (ev) => nthEvent(ev, 'qr_scan', 500) },

    { id: 'qr_1000',      cat: 'QR', catIcon: '📱', label: '1000 QR Scans',
      target: 1000, unit: 'Scans',  metric: 'qr_scans',
      current: _qrScans, dateFrom: (ev) => nthEvent(ev, 'qr_scan', 1000) },

    // ── Diary ─────────────────────────────────────────────────────────────
    { id: 'diary_first',  cat: 'Diary', catIcon: '📔', label: '初回Diary公開',
      target: 1,   unit: '件', metric: 'diaries',
      current: _diariesPub, dateFrom: (ev, di) => nthDiary(di, 1) },

    { id: 'diary_10',     cat: 'Diary', catIcon: '📔', label: 'Diary 10件',
      target: 10,  unit: '件', metric: 'diaries',
      current: _diariesPub, dateFrom: (ev, di) => nthDiary(di, 10) },

    { id: 'diary_50',     cat: 'Diary', catIcon: '📔', label: 'Diary 50件',
      target: 50,  unit: '件', metric: 'diaries',
      current: _diariesPub, dateFrom: (ev, di) => nthDiary(di, 50) },

    { id: 'diary_100',    cat: 'Diary', catIcon: '📔', label: 'Diary 100件',
      target: 100, unit: '件', metric: 'diaries',
      current: _diariesPub, dateFrom: (ev, di) => nthDiary(di, 100) },

    // ── Live ──────────────────────────────────────────────────────────────
    { id: 'live_first',   cat: 'Live', catIcon: '🎤', label: '初ライブ登録',
      target: 1,  unit: '本', metric: 'lives',
      current: _livesCount, dateFrom: (ev, di, li) => nthLive(li, 1) },

    { id: 'live_10',      cat: 'Live', catIcon: '🎤', label: 'ライブ 10本',
      target: 10, unit: '本', metric: 'lives',
      current: _livesCount, dateFrom: (ev, di, li) => nthLive(li, 10) },

    { id: 'live_50',      cat: 'Live', catIcon: '🎤', label: 'ライブ 50本',
      target: 50, unit: '本', metric: 'lives',
      current: _livesCount, dateFrom: (ev, di, li) => nthLive(li, 50) },

    // ── Release ───────────────────────────────────────────────────────────
    { id: 'rel_first',    cat: 'Release', catIcon: '💿', label: '初リリース',
      target: 1,  unit: '曲', metric: 'releases',
      current: _releases, dateFrom: (ev) => nthUniqueTrack(ev, 1) },

    { id: 'rel_5',        cat: 'Release', catIcon: '💿', label: '楽曲 5曲',
      target: 5,  unit: '曲', metric: 'releases',
      current: _releases, dateFrom: (ev) => nthUniqueTrack(ev, 5) },

    { id: 'rel_10',       cat: 'Release', catIcon: '💿', label: '楽曲 10曲',
      target: 10, unit: '曲', metric: 'releases',
      current: _releases, dateFrom: (ev) => nthUniqueTrack(ev, 10) },

    { id: 'rel_20',       cat: 'Release', catIcon: '💿', label: '楽曲 20曲',
      target: 20, unit: '曲', metric: 'releases',
      current: _releases, dateFrom: (ev) => nthUniqueTrack(ev, 20) },
];

// ── Vercel handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    // Auth check
    const cookies = parseCookies(req.headers.cookie || '');
    const token   = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
                  || cookies[COOKIE_NAME] || '';
    if (!token || !verifyToken(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. Load all-time analytics events (no date cap — milestones are life-time)
        const today     = todayJST();
        const firstDate = await getFirstDate();
        const events    = firstDate
            ? await readAnalyticsDays(dateRange(firstDate, today))
            : [];

        // 2. Load content data
        const diaries = readJSON('data/diary.json') || [];
        const lives   = readJSON('data/lives.json') || [];

        // 3. Load cached achievement dates in one pipeline call
        const ids    = MILESTONE_DEFS.map(m => m.id);
        const cached = await getAchievementDates(ids);

        // 4. Compute state + detect newly achieved milestones
        const toStore = [];   // [{ id, isoDate }]
        const milestones = MILESTONE_DEFS.map(def => {
            const current    = def.current(events, diaries, lives);
            const isAchieved = current >= def.target;
            let achievedAt   = cached[def.id] || null;

            if (isAchieved && !achievedAt) {
                // Compute exact date from raw data; fall back to now if not found
                achievedAt = def.dateFrom(events, diaries, lives) || new Date().toISOString();
                toStore.push({ id: def.id, isoDate: achievedAt });
            }

            return {
                id:         def.id,
                cat:        def.cat,
                catIcon:    def.catIcon,
                label:      def.label,
                target:     def.target,
                unit:       def.unit,
                current,
                achieved:   isAchieved,
                achievedAt: achievedAt || null,
                diff:       Math.max(0, def.target - current),
            };
        });

        // 5. Persist newly achieved dates (fire-and-forget — don't block response)
        if (toStore.length) {
            Promise.allSettled(toStore.map(s => setAchievementDateIfNew(s.id, s.isoDate)))
                   .catch(() => {});
        }

        res.status(200).json({ milestones });
    } catch (err) {
        console.error('[milestones]', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
