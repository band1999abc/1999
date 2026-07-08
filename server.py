#!/usr/bin/env python3
"""
Development server for Replit.

Routes
------
GET  /api/analytics        — query events by date range (auth required)
POST /api/analytics        — collect analytics event (no auth)
GET  /api/weather          — IP-geolocated weather condition
GET  /api/auth             — session check  → {"ok": bool}
POST /api/auth             — login / logout → {"ok": bool}
GET  /api/diary            — list posts (auth → all; unauth → published only)
POST /api/diary            — create post (auth required)
GET  /api/diary/<id>       — get single post
PUT  /api/diary/<id>       — update post (auth required)
DELETE /api/diary/<id>     — delete post (auth required)
GET  /api/live             — list lives (auth → all; unauth → published only)
POST /api/live             — create live (auth required)
GET  /api/live/<id>        — get single live
PUT  /api/live/<id>        — update live (auth required)
DELETE /api/live/<id>      — delete live (auth required)
GET  /afterhours           — admin dashboard → afterhours.html
GET  /afterhours/diary     — diary admin → afterhours-diary.html
GET  /afterhours/live      — live admin  → afterhours-live.html
GET  /afterhours/login     — login page  → login.html
GET  *                     — static files via SimpleHTTPRequestHandler
"""

import base64
import datetime
import hashlib
import hmac
import http.server
import json
import os
import re
import time
import urllib.parse
import urllib.request
import uuid as _uuid_mod

# ── Paths ─────────────────────────────────────────────────────────────────────

_ROOT      = os.path.dirname(os.path.abspath(__file__))
_TEMPLATES = os.path.join(_ROOT, 'templates')
_DATA_DIR  = os.path.join(_ROOT, 'data')

# ── Auth helpers ──────────────────────────────────────────────────────────────

_COOKIE_NAME = 'admin_session'
_MAX_AGE     = 7 * 24 * 3600          # 7 days in seconds


def _get_members():
    """Return list of {name, password, comment} dicts.

    Reads MEMBERS env var (JSON array), e.g.:
      [{"name":"Alice","password":"pw1","comment":"おかえり、Aliceさん。"},
       {"name":"Bob",  "password":"pw2","comment":"こんばんは、Bobさん。"}]
    Falls back to ADMIN_PASSWORD with name "Admin".
    """
    raw = os.environ.get('MEMBERS', '').strip()
    if raw:
        try:
            arr = json.loads(raw)
            if isinstance(arr, list) and arr:
                return arr
        except json.JSONDecodeError:
            pass
    pw = os.environ.get('ADMIN_PASSWORD', '')
    return [{'name': 'Admin', 'password': pw, 'comment': 'おかえりなさい。'}] if pw else []


def _get_member_comment(name):
    for m in _get_members():
        if m.get('name') == name:
            return m.get('comment', '')
    return ''


def _make_token(member_name=''):
    exp     = time.time() + _MAX_AGE
    payload = base64.urlsafe_b64encode(
        json.dumps({'exp': exp, 'member': member_name}).encode()
    ).decode().rstrip('=')
    secret  = os.environ.get('SESSION_SECRET', '')
    sig     = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f'{payload}.{sig}'


def _verify_token(token):
    """Returns member name (str, possibly '') if valid, None if invalid/expired."""
    try:
        dot = token.rfind('.')
        if dot < 1:
            return None
        payload  = token[:dot]
        sig      = token[dot + 1:]
        secret   = os.environ.get('SESSION_SECRET', '')
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padded = payload + '=' * (-len(payload) % 4)
        data   = json.loads(base64.urlsafe_b64decode(padded))
        if time.time() >= data['exp']:
            return None
        return data.get('member', '')
    except Exception:
        return None


def _parse_cookies(header):
    out = {}
    for part in (header or '').split(';'):
        idx = part.find('=')
        if idx < 0:
            continue
        out[part[:idx].strip()] = part[idx + 1:].strip()
    return out


def _cookie_header(token):
    age = _MAX_AGE if token else 0
    val = token or ''
    return (f'{_COOKIE_NAME}={val}; HttpOnly; SameSite=Strict; '
            f'Path=/; Max-Age={age}')


# ── Diary storage helpers ─────────────────────────────────────────────────────

_DATE_RE     = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_SCHED_AT_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')


def _today_iso():
    return time.strftime('%Y-%m-%d')


def _now_jst():
    """Return current Japan time as 'YYYY-MM-DDTHH:MM' (JST = UTC+9)."""
    utc_ts = time.time() + 9 * 3600
    t = time.gmtime(utc_ts)
    return time.strftime('%Y-%m-%dT%H:%M', t)


def _valid_date(s):
    """Return s if it matches YYYY-MM-DD, else return today's date."""
    return s if (s and _DATE_RE.match(s)) else _today_iso()


def _auto_promote_scheduled(posts):
    """Promote 'scheduled' posts whose scheduledAt has passed (JST). Returns changed flag."""
    now_jst = _now_jst()
    changed = False
    for p in posts:
        if p.get('status') == 'scheduled':
            sched = p.get('scheduledAt', '')
            if sched and sched <= now_jst:
                p['status'] = 'published'
                p['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
                changed = True
    return changed


def _load_diary():
    path = os.path.join(_DATA_DIR, 'diary.json')
    os.makedirs(_DATA_DIR, exist_ok=True)
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            print('[diary] WARNING: diary.json is not a list, resetting to []')
            return []
        return data
    except (json.JSONDecodeError, OSError) as e:
        print(f'[diary] WARNING: could not load diary.json: {e}')
        return []


def _save_diary(posts):
    os.makedirs(_DATA_DIR, exist_ok=True)
    path = os.path.join(_DATA_DIR, 'diary.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)


# ── Live storage helpers ──────────────────────────────────────────────────────

_TIME_RE = re.compile(r'^\d{1,2}:\d{2}$')


def _valid_time(s):
    """Return s if it looks like H:MM or HH:MM, else empty string."""
    return s if (s and _TIME_RE.match(s)) else ''


def _load_lives():
    path = os.path.join(_DATA_DIR, 'lives.json')
    os.makedirs(_DATA_DIR, exist_ok=True)
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        return data
    except (json.JSONDecodeError, OSError) as e:
        print(f'[live] WARNING: could not load lives.json: {e}')
        return []


def _save_lives(lives):
    os.makedirs(_DATA_DIR, exist_ok=True)
    path = os.path.join(_DATA_DIR, 'lives.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(lives, f, ensure_ascii=False, indent=2)


# ── Milestone helpers (used by _handle_milestones_read) ──────────────────────

def _ms_nth_event(events, etype, n):
    c = 0
    for e in events:
        if e.get('event') == etype:
            c += 1
            if c >= n:
                return e.get('ts')
    return None

def _ms_nth_unique_visitor(events, n):
    seen = set()
    for e in events:
        if e.get('event') != 'visit':
            continue
        vid = e.get('visitor_id')
        if vid not in seen:
            seen.add(vid)
            if len(seen) >= n:
                return e.get('ts')
    return None

def _ms_nth_returning(events, n):
    seen = set()
    for e in events:
        if e.get('event') != 'visit' or e.get('is_new_visitor') is not False:
            continue
        vid = e.get('visitor_id')
        if vid not in seen:
            seen.add(vid)
            if len(seen) >= n:
                return e.get('ts')
    return None

def _ms_first_ret_rate_date(events, target_pct):
    all_vis, ret_vis = set(), set()
    for e in events:
        if e.get('event') != 'visit':
            continue
        all_vis.add(e.get('visitor_id'))
        if e.get('is_new_visitor') is False:
            ret_vis.add(e.get('visitor_id'))
        if all_vis and round(len(ret_vis) / len(all_vis) * 100) >= target_pct:
            return e.get('ts')
    return None

def _ms_nth_unique_track(events, n):
    seen = set()
    for e in events:
        if e.get('event') != 'music_play':
            continue
        track = (e.get('props') or {}).get('track')
        if track and track not in seen:
            seen.add(track)
            if len(seen) >= n:
                return e.get('ts')
    return None

def _ms_nth_diary(diaries, n):
    # Sort by createdAt (registration time), not by `date` (content date).
    # Records without createdAt sort last ('zzz' sentinel).
    pub = sorted(
        [d for d in diaries if d.get('status') == 'published'],
        key=lambda d: d.get('createdAt') or 'zzz'
    )
    if len(pub) >= n:
        return pub[n - 1].get('createdAt')
    return None

def _ms_nth_live(lives, n):
    # Sort by createdAt (registration time), NOT by `date` (performance date).
    srt = sorted(lives, key=lambda l: l.get('createdAt') or 'zzz')
    if len(srt) >= n:
        return srt[n - 1].get('createdAt')
    return None

def _ms_compute_values(events, diaries, lives):
    music_plays = sum(1 for e in events if e.get('event') == 'music_play')
    visitor_ids = {e.get('visitor_id') for e in events if e.get('event') == 'visit'}
    ret_ids = {e.get('visitor_id') for e in events
               if e.get('event') == 'visit' and e.get('is_new_visitor') is False}
    qr_scans = sum(1 for e in events if e.get('event') == 'qr_scan')
    tracks = {(e.get('props') or {}).get('track')
              for e in events if e.get('event') == 'music_play'
              and (e.get('props') or {}).get('track')}
    diaries_pub = sum(1 for d in diaries if d.get('status') == 'published')
    lives_count = len(lives)
    visitors    = len(visitor_ids)
    returning   = len(ret_ids)
    ret_rate    = round(returning / visitors * 100) if visitors else 0
    return {
        'music_plays': music_plays,
        'visitors':    visitors,
        'returning':   returning,
        'ret_rate':    ret_rate,
        'qr_scans':    qr_scans,
        'diaries':     diaries_pub,
        'lives':       lives_count,
        'releases':    len(tracks),
    }

def _ms_find_date(metric, target, events, diaries, lives):
    if metric == 'music_plays':
        return _ms_nth_event(events, 'music_play', target)
    if metric == 'visitors':
        return _ms_nth_unique_visitor(events, target)
    if metric == 'returning':
        return _ms_nth_returning(events, target)
    if metric == 'ret_rate':
        return _ms_first_ret_rate_date(events, target)
    if metric == 'qr_scans':
        return _ms_nth_event(events, 'qr_scan', target)
    if metric == 'diaries':
        return _ms_nth_diary(diaries, target)
    if metric == 'lives':
        return _ms_nth_live(lives, target)
    if metric == 'releases':
        return _ms_nth_unique_track(events, target)
    return None

_MILESTONES_DEFS = [
    # Music
    {'id': 'music_first',  'cat': 'Music',     'catIcon': '🎵', 'label': '初回再生',                  'metric': 'music_plays', 'target': 1,     'unit': 'Play'},
    {'id': 'music_100',    'cat': 'Music',     'catIcon': '🎵', 'label': '100 Plays',                'metric': 'music_plays', 'target': 100,   'unit': 'Plays'},
    {'id': 'music_500',    'cat': 'Music',     'catIcon': '🎵', 'label': '500 Plays',                'metric': 'music_plays', 'target': 500,   'unit': 'Plays'},
    {'id': 'music_1000',   'cat': 'Music',     'catIcon': '🎵', 'label': '1000 Plays',               'metric': 'music_plays', 'target': 1000,  'unit': 'Plays'},
    {'id': 'music_5000',   'cat': 'Music',     'catIcon': '🎵', 'label': '5000 Plays',               'metric': 'music_plays', 'target': 5000,  'unit': 'Plays'},
    {'id': 'music_10000',  'cat': 'Music',     'catIcon': '🎵', 'label': '10000 Plays',              'metric': 'music_plays', 'target': 10000, 'unit': 'Plays'},
    # Visitors
    {'id': 'vis_first',    'cat': 'Visitors',  'catIcon': '👥', 'label': '初回訪問',                  'metric': 'visitors',    'target': 1,     'unit': 'Visitor'},
    {'id': 'vis_100',      'cat': 'Visitors',  'catIcon': '👥', 'label': '100 Visitors',             'metric': 'visitors',    'target': 100,   'unit': 'Visitors'},
    {'id': 'vis_500',      'cat': 'Visitors',  'catIcon': '👥', 'label': '500 Visitors',             'metric': 'visitors',    'target': 500,   'unit': 'Visitors'},
    {'id': 'vis_1000',     'cat': 'Visitors',  'catIcon': '👥', 'label': '1000 Visitors',            'metric': 'visitors',    'target': 1000,  'unit': 'Visitors'},
    {'id': 'vis_5000',     'cat': 'Visitors',  'catIcon': '👥', 'label': '5000 Visitors',            'metric': 'visitors',    'target': 5000,  'unit': 'Visitors'},
    # Returning
    {'id': 'ret_first',    'cat': 'Returning', 'catIcon': '🔄', 'label': '初めてのReturning Visitor', 'metric': 'returning',   'target': 1,     'unit': '人'},
    {'id': 'ret_100',      'cat': 'Returning', 'catIcon': '🔄', 'label': 'Returning Visitor 100人',  'metric': 'returning',   'target': 100,   'unit': '人'},
    {'id': 'ret_rate_25',  'cat': 'Returning', 'catIcon': '🔄', 'label': 'Returning Rate 25%',       'metric': 'ret_rate',    'target': 25,    'unit': '%'},
    {'id': 'ret_rate_50',  'cat': 'Returning', 'catIcon': '🔄', 'label': 'Returning Rate 50%',       'metric': 'ret_rate',    'target': 50,    'unit': '%'},
    # QR
    {'id': 'qr_first',     'cat': 'QR',        'catIcon': '📱', 'label': '初回QR Scan',               'metric': 'qr_scans',    'target': 1,     'unit': 'Scan'},
    {'id': 'qr_100',       'cat': 'QR',        'catIcon': '📱', 'label': '100 QR Scans',              'metric': 'qr_scans',    'target': 100,   'unit': 'Scans'},
    {'id': 'qr_500',       'cat': 'QR',        'catIcon': '📱', 'label': '500 QR Scans',              'metric': 'qr_scans',    'target': 500,   'unit': 'Scans'},
    {'id': 'qr_1000',      'cat': 'QR',        'catIcon': '📱', 'label': '1000 QR Scans',             'metric': 'qr_scans',    'target': 1000,  'unit': 'Scans'},
    # Diary
    {'id': 'diary_first',  'cat': 'Diary',     'catIcon': '📔', 'label': '初回Diary公開',             'metric': 'diaries',     'target': 1,     'unit': '件'},
    {'id': 'diary_10',     'cat': 'Diary',     'catIcon': '📔', 'label': 'Diary 10件',               'metric': 'diaries',     'target': 10,    'unit': '件'},
    {'id': 'diary_50',     'cat': 'Diary',     'catIcon': '📔', 'label': 'Diary 50件',               'metric': 'diaries',     'target': 50,    'unit': '件'},
    {'id': 'diary_100',    'cat': 'Diary',     'catIcon': '📔', 'label': 'Diary 100件',              'metric': 'diaries',     'target': 100,   'unit': '件'},
    # Live
    {'id': 'live_first',   'cat': 'Live',      'catIcon': '🎤', 'label': '初ライブ登録',               'metric': 'lives',       'target': 1,     'unit': '本'},
    {'id': 'live_10',      'cat': 'Live',      'catIcon': '🎤', 'label': 'ライブ 10本',               'metric': 'lives',       'target': 10,    'unit': '本'},
    {'id': 'live_50',      'cat': 'Live',      'catIcon': '🎤', 'label': 'ライブ 50本',               'metric': 'lives',       'target': 50,    'unit': '本'},
    # Release
    {'id': 'rel_first',    'cat': 'Release',   'catIcon': '💿', 'label': '初リリース',                'metric': 'releases',    'target': 1,     'unit': '曲'},
    {'id': 'rel_5',        'cat': 'Release',   'catIcon': '💿', 'label': '楽曲 5曲',                  'metric': 'releases',    'target': 5,     'unit': '曲'},
    {'id': 'rel_10',       'cat': 'Release',   'catIcon': '💿', 'label': '楽曲 10曲',                 'metric': 'releases',    'target': 10,    'unit': '曲'},
    {'id': 'rel_20',       'cat': 'Release',   'catIcon': '💿', 'label': '楽曲 20曲',                 'metric': 'releases',    'target': 20,    'unit': '曲'},
]


# ── Insights helpers (used by _handle_insights_read) ─────────────────────────

_INS_MS_LABELS = {
    'music_first': ('🎵','初回再生'),    'music_100':   ('🎵','100 Plays'),
    'music_500':   ('🎵','500 Plays'),   'music_1000':  ('🎵','1,000 Plays'),
    'music_5000':  ('🎵','5,000 Plays'), 'music_10000': ('🎵','10,000 Plays'),
    'vis_first':   ('👥','初回訪問'),     'vis_100':     ('👥','100 Visitors'),
    'vis_500':     ('👥','500 Visitors'), 'vis_1000':    ('👥','1,000 Visitors'),
    'vis_5000':    ('👥','5,000 Visitors'),
    'ret_first':   ('🔄','初Returning Visitor'), 'ret_100':     ('🔄','Returning 100人'),
    'ret_rate_25': ('🔄','Returning Rate 25%'),  'ret_rate_50': ('🔄','Returning Rate 50%'),
    'qr_first':    ('📱','初QR Scan'),  'qr_100':  ('📱','100 QR Scans'),
    'qr_500':      ('📱','500 QR Scans'), 'qr_1000': ('📱','1,000 QR Scans'),
    'diary_first': ('📔','初Diary公開'), 'diary_10':  ('📔','Diary 10件'),
    'diary_50':    ('📔','Diary 50件'),  'diary_100': ('📔','Diary 100件'),
    'live_first':  ('🎤','初ライブ登録'), 'live_10': ('🎤','ライブ 10本'),
    'live_50':     ('🎤','ライブ 50本'),
    'rel_first':   ('💿','初リリース'),  'rel_5':  ('💿','楽曲 5曲'),
    'rel_10':      ('💿','楽曲 10曲'),   'rel_20': ('💿','楽曲 20曲'),
}


def _ins_today_str():
    return (datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')


def _ins_to_jst_date(ts):
    if not ts:
        return ''
    try:
        d = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return (d + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')
    except Exception:
        return ts[:10] if ts else ''


def _ins_to_jst_hour(ts):
    if not ts:
        return 0
    try:
        d = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return (d + datetime.timedelta(hours=9)).hour
    except Exception:
        return 0


def _ins_add_days(date_str, n):
    d = datetime.date.fromisoformat(date_str)
    return (d + datetime.timedelta(days=n)).isoformat()


def _ins_date_range(start, end):
    dates, cur = [], datetime.date.fromisoformat(start)
    last = datetime.date.fromisoformat(end)
    while cur <= last:
        dates.append(cur.isoformat())
        cur += datetime.timedelta(days=1)
    return dates


def _ins_week_monday(date_str):
    d = datetime.date.fromisoformat(date_str)
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def _ins_prev_month_bounds(date_str):
    y, m = int(date_str[:4]), int(date_str[5:7])
    pm = 12 if m == 1 else m - 1
    py = y - 1 if m == 1 else y
    start = f'{py}-{pm:02d}-01'
    last  = (datetime.date(py, pm, 1) + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)
    return start, last.isoformat()


def _ins_read_analytics_days(analytics_dir, dates):
    events = []
    for d in dates:
        fp = os.path.join(analytics_dir, d + '.json')
        if os.path.exists(fp):
            try:
                data = json.load(open(fp, encoding='utf-8'))
                if isinstance(data, list):
                    events.extend(data)
            except Exception:
                pass
    return sorted(events, key=lambda e: e.get('ts', ''))


def _ins_visitors(events):
    return len({e.get('visitor_id') for e in events if e.get('event') == 'visit'})


def _ins_returning(events):
    return len({e.get('visitor_id') for e in events
                if e.get('event') == 'visit' and e.get('is_new_visitor') is False})


def _ins_ret_rate(events):
    v = _ins_visitors(events)
    return round(_ins_returning(events) / v * 100) if v else 0


def _ins_plays(events):
    return sum(1 for e in events if e.get('event') == 'music_play')


def _ins_qr_scans(events):
    return sum(1 for e in events if e.get('event') == 'qr_scan')


def _ins_page_views(events):
    return sum(1 for e in events if e.get('event') == 'page_view')


def _ins_top_track(events):
    c = {}
    for e in events:
        if e.get('event') == 'music_play':
            t = (e.get('props') or {}).get('track')
            if t:
                c[t] = c.get(t, 0) + 1
    if not c:
        return None
    best = max(c, key=lambda k: c[k])
    return {'track': best, 'count': c[best]}


def _ins_group_by_date(events):
    g = {}
    for e in events:
        d = _ins_to_jst_date(e.get('ts', ''))
        if d:
            g.setdefault(d, []).append(e)
    return g


def _ins_pct(a, b):
    if not b:
        return None
    return round((a - b) / b * 100)


def _ins_build_today(today_ev, yest_ev, this_week_ev, last_week_ev, all_by_date, recent_lives, today):
    insights = []
    today_v = _ins_visitors(today_ev)
    yest_v  = _ins_visitors(yest_ev)

    # 1. Visitor change
    if today_v > 0 and yest_v > 0:
        pct = _ins_pct(today_v, yest_v)
        if pct is not None and pct >= 10:
            insights.append({'id':'visitor_up','icon':'📈','level':'positive',
                'text':f'昨日より Visitors が {pct}% 増えました。'})
        elif pct is not None and pct <= -10:
            insights.append({'id':'visitor_down','icon':'📉','level':'neutral',
                'text':f'昨日より Visitors が {abs(pct)}% 減りました。'})
    elif today_v > 0 and yest_v == 0:
        insights.append({'id':'back_after_zero','icon':'👋','level':'positive',
            'text':f'昨日は訪問ゼロでしたが、今日は {today_v} 人が訪れました。'})

    # 2. Top track
    tt = _ins_top_track(today_ev)
    if tt:
        insights.append({'id':'top_track','icon':'🎵','level':'neutral',
            'text':f'「{tt["track"]}」が今日最も再生されました（{tt["count"]}回）。'})

    # 3. All-time high
    prev_dates = [d for d in all_by_date if d < today]
    if len(prev_dates) >= 7:
        prev_max = max((_ins_visitors(all_by_date[d]) for d in prev_dates), default=0)
        if today_v > prev_max and today_v > 0:
            insights.append({'id':'alltime_high','icon':'🎉','level':'positive',
                'text':f'今日は過去最高の訪問者数（{today_v} 人）です！'})

    # 4. Post-live context
    live_recent = next((l for l in recent_lives
                        if l.get('date') and 0 <= (
                            datetime.date.fromisoformat(today)
                            - datetime.date.fromisoformat(l['date'][:10])
                        ).days <= 2), None)
    if live_recent:
        tw_pl = _ins_plays(this_week_ev)
        lw_pl = _ins_plays(last_week_ev)
        if tw_pl > lw_pl * 1.15:
            insights.append({'id':'live_music_spike','icon':'🎤','level':'positive',
                'text':'ライブ後に Music 再生数が増えています。'})
        else:
            insights.append({'id':'live_context','icon':'🎤','level':'neutral',
                'text':'直近にライブがありました。アクセスの動きを観察しましょう。'})

    # 5. Returning rate improvement
    this_rr = _ins_ret_rate(this_week_ev)
    last_rr = _ins_ret_rate(last_week_ev)
    if this_rr > 0 and last_rr > 0 and this_rr >= last_rr + 5:
        insights.append({'id':'ret_up','icon':'🔄','level':'positive',
            'text':f'リピーター率が今週 {this_rr}% と先週より上がっています。'})

    # 6. QR today
    today_qr = _ins_qr_scans(today_ev)
    if today_qr > 0:
        insights.append({'id':'qr_today','icon':'📱','level':'neutral',
            'text':f'QR コード経由で今日 {today_qr} 件のアクセスがありました。'})

    # 7. Fallback
    if not insights:
        if today_v == 0:
            insights.append({'id':'quiet','icon':'🌙','level':'neutral','text':'今日はまだ訪問者がいません。'})
        else:
            insights.append({'id':'normal','icon':'✨','level':'neutral','text':f'今日は {today_v} 人が訪れました。'})

    return {
        'date': today, 'insights': insights,
        '_data': {'visitorsToday': today_v, 'visitorsYest': yest_v,
                  'playsToday': _ins_plays(today_ev), 'topTrack': tt,
                  'qrToday': today_qr, 'retRateWeek': this_rr},
    }


def _ins_build_weekly(this_ev, last_ev, this_start, last_start, today):
    def mk(key, label, icon, val, prev):
        return {'key': key, 'label': label, 'icon': icon, 'value': val, 'prev': prev,
                'changePct': _ins_pct(val, prev)}
    return {
        'period':     {'start': this_start, 'end': today},
        'prevPeriod': {'start': last_start, 'end': _ins_add_days(this_start, -1)},
        'metrics': [
            mk('visitors',  'Visitors',          '👥', _ins_visitors(this_ev),  _ins_visitors(last_ev)),
            mk('plays',     'Music Plays',        '🎵', _ins_plays(this_ev),     _ins_plays(last_ev)),
            mk('returning', 'Returning Visitors', '🔄', _ins_returning(this_ev), _ins_returning(last_ev)),
            mk('qr',        'QR Scans',           '📱', _ins_qr_scans(this_ev),  _ins_qr_scans(last_ev)),
            mk('pageviews', 'Page Views',         '📄', _ins_page_views(this_ev), _ins_page_views(last_ev)),
        ],
        '_data': {'retRateThis': _ins_ret_rate(this_ev), 'retRateLast': _ins_ret_rate(last_ev)},
    }


def _ins_build_monthly(this_ev, last_ev, lives, diaries, m_str):
    this_v  = _ins_visitors(this_ev)
    last_v  = _ins_visitors(last_ev)
    this_rr = _ins_ret_rate(this_ev)
    this_pl = _ins_plays(this_ev)
    tt      = _ins_top_track(this_ev)
    has_live = any((l.get('date') or '').startswith(m_str) for l in lives)
    pub_diaries = [d for d in diaries
                   if d.get('status') == 'published'
                   and (d.get('createdAt') or d.get('date') or '').startswith(m_str)]
    parts = []

    if this_v == 0:
        parts.append('今月はまだ訪問者がいません。')
    elif not last_v:
        parts.append(f'今月は {this_v} 人が訪れました。')
    else:
        pct = _ins_pct(this_v, last_v)
        if pct is not None and pct >= 20:
            parts.append(f'今月は先月より {pct}% 多くの人が訪れました。')
        elif pct is not None and pct >= 5:
            parts.append('今月は先月よりやや多くの人が訪れました。')
        elif pct is not None and pct <= -20:
            parts.append(f'今月は先月より {abs(pct)}% 少ない訪問となりました。')
        else:
            parts.append('今月は先月と同程度の訪問者数でした。')

    if this_v > 0:
        if this_rr >= 50:
            parts.append('リピーターが多く、常連の人たちがよく戻ってきた一ヶ月でした。')
        elif this_rr >= 25:
            parts.append('新しい訪問者とリピーターがバランスよく訪れました。')
        else:
            parts.append('新しく訪れた人が中心の一ヶ月でした。')

    if has_live:
        parts.append('ライブがあり、その前後でサイトへのアクセスが増えました。')
    if tt and this_pl > 0:
        parts.append(f'「{tt["track"]}」が最も多く聴かれました（{tt["count"]}回）。')
    if pub_diaries:
        parts.append(f'Diary は今月 {len(pub_diaries)} 件公開されました。')

    return {
        'period': m_str,
        'story':  ''.join(parts) if parts else 'まだデータが揃っていません。',
        '_data': {'visitorsThis': this_v, 'visitorsLast': last_v,
                  'retRate': this_rr, 'plays': this_pl, 'hasLive': has_live,
                  'diaryCount': len(pub_diaries), 'topTrack': tt},
    }


def _ins_build_achievements(ms_cache, window_days=60):
    today  = _ins_today_str()
    cutoff = _ins_add_days(today, -window_days)
    result = []
    for mid, iso in ms_cache.items():
        if not iso or iso[:10] < cutoff:
            continue
        icon, label = _INS_MS_LABELS.get(mid, ('🏆', mid))
        result.append({'id': mid, 'icon': icon, 'label': label, 'achievedAt': iso})
    result.sort(key=lambda x: x['achievedAt'], reverse=True)
    return result[:8]


def _ins_build_recommendations(all_ev, lives, diaries, all_by_date):
    recs = []

    # 1. Peak hour
    hour_bin = [0] * 24
    for e in all_ev:
        hour_bin[_ins_to_jst_hour(e.get('ts', ''))] += 1
    total = sum(hour_bin)
    if total > 0:
        peak = hour_bin.index(max(hour_bin))
        if hour_bin[peak] / total > 0.12:
            recs.append({'id':'peak_hour','icon':'🕐',
                'text':f'{peak}〜{(peak+2)%24}時にアクセスが集中しています。この時間帯に合わせて更新すると効果的かもしれません。'})

    # 2. Diary → plays correlation
    pub_diary = [d for d in diaries if d.get('status') == 'published' and d.get('date')]
    if len(pub_diary) >= 2:
        n_days  = max(1, len(all_by_date))
        avg_pl  = _ins_plays(all_ev) / n_days
        spiked  = sum(1 for d in pub_diary if _ins_plays(all_by_date.get(d['date'], [])) > avg_pl * 1.3)
        if spiked / len(pub_diary) >= 0.5:
            recs.append({'id':'diary_plays','icon':'📔',
                'text':'Diary 公開日は Music 再生数が伸びる傾向があります。定期的な投稿が効果的です。'})

    # 3. Post-live spike
    recent_l = sorted([l for l in lives if l.get('date')],
                      key=lambda l: l['date'], reverse=True)[:6]
    spiked = sum(1 for l in recent_l
                 if _ins_visitors(all_by_date.get(_ins_add_days(l['date'], 1), []))
                    > _ins_visitors(all_by_date.get(_ins_add_days(l['date'], -1), [])) * 1.2
                 and _ins_visitors(all_by_date.get(_ins_add_days(l['date'], 1), [])) > 0)
    if len(recent_l) >= 2 and spiked / len(recent_l) >= 0.5:
        recs.append({'id':'post_live','icon':'🎤',
            'text':'ライブ翌日に Visitors が増えています。ライブ告知をサイトでも強化すると効果的です。'})

    # 4. Returning rate
    rr = _ins_ret_rate(all_ev)
    v  = _ins_visitors(all_ev)
    if rr < 25 and v >= 10:
        recs.append({'id':'low_returning','icon':'🔄',
            'text':f'リピーター率が {rr}% と低めです。Diary や Music の定期更新でリピーターを増やしましょう。'})
    elif rr >= 45 and v >= 10:
        recs.append({'id':'high_returning','icon':'🌟',
            'text':f'リピーター率が {rr}% と高く、コアファンが育っています。新規訪問者を増やす施策も検討しましょう。'})

    # 5. QR usage
    qr = _ins_qr_scans(all_ev)
    if qr == 0 and lives:
        recs.append({'id':'no_qr','icon':'📱',
            'text':'ライブでの QR コード活用がまだありません。フライヤーへの掲載を検討してみてください。'})
    elif qr > 0 and rr >= 25:
        recs.append({'id':'qr_working','icon':'📱',
            'text':f'QR 経由の訪問が {qr} 件あり、フライヤーからのリピーターも定着しています。'})

    return recs[:5]


def _ins_build_timeline(diaries, lives, ms_cache, window_days=90):
    today  = _ins_today_str()
    cutoff = _ins_add_days(today, -window_days)
    items  = []

    for d in diaries:
        if d.get('status') != 'published':
            continue
        date = (d.get('createdAt') or d.get('date') or '')[:10]
        if date >= cutoff:
            items.append({'type':'diary','icon':'📔','label':'Diary',
                'title': d.get('title') or '(untitled)', 'date': date})

    for l in lives:
        date = (l.get('date') or '')[:10]
        if date >= cutoff:
            items.append({'type':'live','icon':'🎤','label':'Live',
                'title': l.get('venue') or 'ライブ', 'date': date})

    for mid, iso in ms_cache.items():
        if not iso:
            continue
        date = iso[:10]
        if date >= cutoff:
            icon, label = _INS_MS_LABELS.get(mid, ('🏆', mid))
            items.append({'type':'milestone','icon':icon,'label':'Milestone',
                'title': label, 'date': date})

    items = [i for i in items if i.get('date')]
    items.sort(key=lambda x: x['date'], reverse=True)
    return items[:20]


# ── Music Analytics helpers (_ma_*) ───────────────────────────────────────────

def _ma_read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _ma_today_str():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')


def _ma_to_jst_date(ts):
    try:
        dt = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return (dt + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')
    except Exception:
        return ts[:10]


def _ma_to_jst_dow(ts):
    try:
        dt = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return (dt + datetime.timedelta(hours=9)).weekday()  # 0=Mon
    except Exception:
        return 0


def _ma_add_days(date_str, n):
    dt = datetime.date.fromisoformat(date_str)
    return (dt + datetime.timedelta(days=n)).isoformat()


def _ma_date_range(start, end):
    out = []
    cur = datetime.date.fromisoformat(start)
    fin = datetime.date.fromisoformat(end)
    while cur <= fin:
        out.append(cur.isoformat())
        cur += datetime.timedelta(days=1)
    return out


def _ma_first_analytics_date(analytics_dir):
    if not os.path.isdir(analytics_dir):
        return None
    files = sorted(f for f in os.listdir(analytics_dir) if f.endswith('.json'))
    return files[0][:-5] if files else None


def _ma_read_analytics_days(analytics_dir, dates):
    events = []
    for d in dates:
        fp = os.path.join(analytics_dir, d + '.json')
        if os.path.exists(fp):
            try:
                data = json.load(open(fp, encoding='utf-8'))
                if isinstance(data, list):
                    events.extend(data)
            except Exception:
                pass
    return sorted(events, key=lambda e: e.get('ts', ''))


def _ma_build(all_events, lives, diaries, today):
    yesterday     = _ma_add_days(today, -1)
    this_week_dt  = datetime.date.fromisoformat(today)
    dow = this_week_dt.weekday()
    week_start    = (this_week_dt - datetime.timedelta(days=dow)).isoformat()
    month_start   = today[:7] + '-01'

    music_events = [e for e in all_events
                    if e.get('event') == 'music_play' and e.get('props', {}).get('track')]
    music_events.sort(key=lambda e: e.get('ts', ''))

    tracks = list(dict.fromkeys(e['props']['track'] for e in music_events))

    if not tracks:
        return {
            'overview': {'totalSongs': 0, 'totalPlays': 0, 'uniqueListeners': 0,
                         'playsToday': 0, 'playsThisWeek': 0, 'playsThisMonth': 0,
                         'avgDuration': None, 'avgCompletion': None},
            'songs': [], 'chartData': {'dates': [], 'cumulative': {}, 'daily': {}},
            'insights': [], 'achievements': None, 'timeline': [],
            '_meta': _ma_meta(),
        }

    # Group events by track
    track_map = {t: {'events': [], 'vs': {}} for t in tracks}
    for e in music_events:
        t = e['props']['track']
        td = track_map[t]
        td['events'].append(e)
        vis = e.get('visitor_id', '')
        sid = e.get('session_id', '')
        if vis not in td['vs']:
            td['vs'][vis] = set()
        td['vs'][vis].add(sid)

    # Chart data
    first_event_date = _ma_to_jst_date(music_events[0]['ts']) if music_events else today
    all_dates = _ma_date_range(first_event_date, today)
    date_idx  = {d: i for i, d in enumerate(all_dates)}

    daily_counts = {t: [0] * len(all_dates) for t in tracks}
    for e in music_events:
        d   = _ma_to_jst_date(e['ts'])
        idx = date_idx.get(d)
        if idx is not None:
            daily_counts[e['props']['track']][idx] += 1

    cumulative = {}
    for t in tracks:
        running = 0
        cum = []
        for n in daily_counts[t]:
            running += n
            cum.append(running)
        cumulative[t] = cum

    # Per-song metrics
    songs = []
    for track in tracks:
        td  = track_map[track]
        ev  = td['events']
        vs  = td['vs']

        first_seen    = _ma_to_jst_date(ev[0]['ts'])
        last_play     = _ma_to_jst_date(ev[-1]['ts'])
        total_plays   = len(ev)
        unique_list   = len(vs)
        returning_cnt = sum(1 for s in vs.values() if len(s) >= 2)
        ret_rate      = round(returning_cnt / unique_list * 100) if unique_list else 0

        plays_today  = sum(1 for e in ev if _ma_to_jst_date(e['ts']) == today)
        plays_yest   = sum(1 for e in ev if _ma_to_jst_date(e['ts']) == yesterday)
        plays_week   = sum(1 for e in ev if _ma_to_jst_date(e['ts']) >= week_start)
        plays_month  = sum(1 for e in ev if _ma_to_jst_date(e['ts']) >= month_start)

        dow_counts = [0] * 7
        for e in ev:
            dow_counts[_ma_to_jst_dow(e['ts'])] += 1

        # Milestones
        ms_levels = [100, 500, 1000, 5000, 10000]
        milestones = {}
        for n in ms_levels:
            milestones[str(n)] = _ma_to_jst_date(ev[n-1]['ts']) if len(ev) >= n else None

        # Release impact
        first_ts_ms = _ma_ts_to_ms(ev[0]['ts'])
        def impact(ms_window):
            w = [e for e in ev if _ma_ts_to_ms(e['ts']) - first_ts_ms <= ms_window]
            return {'plays': len(w), 'uniqueListeners': len({e.get('visitor_id') for e in w})}

        release_impact = {
            'h24': impact(24 * 3600 * 1000),
            'd7':  impact(7  * 86400 * 1000),
            'd30': impact(30 * 86400 * 1000),
        }

        # Stability: plays after day 30 / total
        after_d30 = sum(1 for e in ev if _ma_ts_to_ms(e['ts']) - first_ts_ms > 30 * 86400 * 1000)
        stability = round(after_d30 / total_plays * 100) if total_plays else 0

        songs.append({
            'track': track, 'firstSeenDate': first_seen, 'lastPlayDate': last_play,
            'totalPlays': total_plays, 'uniqueListeners': unique_list,
            'retRate': ret_rate,
            'playsToday': plays_today, 'playsYest': plays_yest,
            'playsThisWeek': plays_week, 'playsThisMonth': plays_month,
            'dowCounts': dow_counts,
            'milestones': milestones, 'releaseImpact': release_impact,
            'stabilityRate': stability,
            'avgDuration': None, 'completionRate': None,
        })

    songs.sort(key=lambda s: -s['totalPlays'])

    # Overview
    all_vis = {e.get('visitor_id') for e in music_events}
    overview = {
        'totalSongs':      len(tracks),
        'totalPlays':      len(music_events),
        'uniqueListeners': len(all_vis),
        'playsToday':      sum(1 for e in music_events if _ma_to_jst_date(e['ts']) == today),
        'playsThisWeek':   sum(1 for e in music_events if _ma_to_jst_date(e['ts']) >= week_start),
        'playsThisMonth':  sum(1 for e in music_events if _ma_to_jst_date(e['ts']) >= month_start),
        'avgDuration': None, 'avgCompletion': None,
    }

    insights    = _ma_insights(songs, music_events, lives, all_dates, daily_counts)
    achievements = _ma_achievements(songs)
    timeline    = _ma_timeline(songs, lives, diaries, today)

    return {
        'overview': overview,
        'songs': songs,
        'chartData': {'dates': all_dates, 'cumulative': cumulative, 'daily': daily_counts},
        'insights': insights,
        'achievements': achievements,
        'timeline': timeline,
        '_meta': _ma_meta(),
    }


def _ma_ts_to_ms(ts):
    try:
        dt = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return dt.timestamp() * 1000
    except Exception:
        return 0


def _ma_insights(songs, all_music_ev, lives, all_dates, daily):
    ins = []
    today = _ma_today_str()

    if songs:
        top = songs[0]
        ins.append({'id': 'top_song', 'icon': '🎵',
            'text': f'「{top["track"]}」が最も多く再生されています（{top["totalPlays"]:,}回）。'})

    # Live → plays spike
    recent_lives = [l for l in lives if l.get('date')][-5:]
    spike_count = 0
    for l in recent_lives:
        d = l['date'][:10]
        if d not in all_dates:
            continue
        idx_after = all_dates.index(d) + 1
        if idx_after >= len(all_dates):
            continue
        next_day = sum(daily.get(s['track'], [0])[idx_after] if idx_after < len(daily.get(s['track'], [])) else 0
                       for s in songs)
        prev_7 = []
        for s in songs:
            dc = daily.get(s['track'], [])
            prev_7.extend(dc[max(0, idx_after-7):idx_after])
        avg = sum(prev_7) / max(1, len(prev_7)) * len(songs)
        if next_day > avg * 1.3:
            spike_count += 1
    if len(recent_lives) >= 2 and spike_count / len(recent_lives) >= 0.5:
        ins.append({'id': 'live_spike', 'icon': '🎤',
            'text': 'ライブ翌日に Music 再生数が最も伸びています。'})

    # Sustained
    sustained = [s for s in songs if s['stabilityRate'] >= 50 and s['totalPlays'] >= 20]
    if sustained:
        ins.append({'id': 'sustained', 'icon': '📈',
            'text': f'「{sustained[0]["track"]}」は公開30日以降も安定して再生されています。'})

    # Fastest growing
    thirty_ago = _ma_add_days(today, -30)
    with_recent = []
    for s in songs:
        if s['totalPlays'] < 10:
            continue
        recent = s.get('playsThisMonth', 0)
        with_recent.append({**s, 'recentRate': recent / max(1, s['totalPlays'])})
    with_recent.sort(key=lambda s: -s['recentRate'])
    if len(with_recent) >= 2 and with_recent[0]['recentRate'] > 0.6:
        ins.append({'id': 'fastest_growing', 'icon': '🚀',
            'text': f'「{with_recent[0]["track"]}」が最近の30日間で最も伸びています。'})

    # Loyal listeners
    by_loyal = sorted(songs, key=lambda s: -s['retRate'])
    if by_loyal and by_loyal[0]['retRate'] >= 30:
        s = by_loyal[0]
        ins.append({'id': 'loyal', 'icon': '❤️',
            'text': f'「{s["track"]}」はリピーターが多く、ファンに継続的に愛されています（Returning {s["retRate"]}%）。'})

    return ins[:5]


def _ma_achievements(songs):
    if not songs:
        return None
    by_plays  = songs[0]
    by_loyal  = sorted(songs, key=lambda s: -s['retRate'])[0]
    growing   = sorted([s for s in songs if s['playsThisMonth'] > 0],
                       key=lambda s: -(s['playsThisMonth'] / max(1, s['totalPlays'])))
    by_growth = growing[0] if growing else None

    def days_active(s):
        try:
            return (datetime.date.fromisoformat(s['lastPlayDate'])
                    - datetime.date.fromisoformat(s['firstSeenDate'])).days
        except Exception:
            return 0

    by_active = sorted(songs, key=lambda s: -days_active(s))[0]

    return {
        'mostPlayed':     {'track': by_plays['track'],  'value': by_plays['totalPlays'],    'unit': 'Plays'},
        'fastestGrowing': {'track': by_growth['track'], 'value': by_growth['playsThisMonth'], 'unit': '直近30日再生'} if by_growth else None,
        'mostLoyal':      {'track': by_loyal['track'],  'value': by_loyal['retRate'],         'unit': '% Returning'},
        'longestActive':  {'track': by_active['track'], 'value': days_active(by_active),       'unit': '日間'},
    }


def _ma_timeline(songs, lives, diaries, today):
    cutoff = _ma_add_days(today, -180)
    items  = []

    for s in songs:
        d = s['firstSeenDate']
        if d >= cutoff:
            items.append({'date': d, 'type': 'release', 'icon': '💿', 'title': s['track'], 'track': s['track']})

    for l in lives:
        d = (l.get('date') or '')[:10]
        if d >= cutoff:
            items.append({'date': d, 'type': 'live', 'icon': '🎤', 'title': l.get('venue') or 'ライブ', 'track': None})

    for d in (diaries or []):
        if d.get('status') != 'published':
            continue
        dt = (d.get('createdAt') or d.get('date') or '')[:10]
        if dt >= cutoff:
            items.append({'date': dt, 'type': 'diary', 'icon': '📔', 'title': d.get('title') or '(untitled)', 'track': None})

    for s in songs:
        for n in [100, 500, 1000]:
            dt = s['milestones'].get(str(n))
            if dt and dt >= cutoff:
                items.append({'date': dt, 'type': 'milestone', 'icon': '🏆',
                              'title': f'「{s["track"]}」{n} Plays', 'track': s['track']})

    items = [i for i in items if i.get('date')]
    items.sort(key=lambda x: x['date'], reverse=True)
    return items[:30]


def _ma_meta():
    return {
        'dataSources': ['analytics'],
        'futureDataSources': ['spotify', 'apple_music', 'youtube'],
        'trackedFields': ['plays', 'unique_listeners', 'returning_rate', 'release_date'],
        'untrackedFields': ['duration', 'completion_rate'],
    }


# ── Request handler ───────────────────────────────────────────────────────────

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):

    # ── Routing ───────────────────────────────────────────────────────────────

    def send_error(self, code, message=None, explain=None):
        """404 は custom 404.html を返す。それ以外はデフォルト動作。"""
        if code == 404:
            filepath = os.path.join(_ROOT, '404.html')
            try:
                with open(filepath, 'rb') as f:
                    body = f.read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.end_headers()
                self.wfile.write(body)
                return
            except FileNotFoundError:
                pass
        super().send_error(code, message, explain)

    def do_GET(self):
        path = self.path.split('?')[0].rstrip('/')
        if self.path.startswith('/api/weather'):
            self._handle_weather()
        elif path == '/api/auth':
            self._handle_auth_get()
        elif path == '/afterhours/analytics':
            self._serve_template('afterhours-analytics.html')
        elif path == '/afterhours/milestones':
            self._serve_template('afterhours-milestones.html')
        elif path == '/api/milestones':
            self._handle_milestones_read()
        elif path == '/afterhours/insights':
            self._serve_template('afterhours-insights.html')
        elif path == '/api/insights':
            self._handle_insights_read()
        elif path == '/afterhours/music':
            self._serve_template('afterhours-music.html')
        elif path == '/api/music-analytics':
            self._handle_music_analytics_read()
        elif path == '/afterhours/diary':
            self._handle_afterhours_diary()
        elif path == '/afterhours/live':
            self._serve_template('afterhours-live.html')
        elif path == '/afterhours/login':
            self._serve_template('login.html')
        elif path == '/afterhours':
            self._handle_afterhours()
        elif path == '/api/diary':
            self._handle_diary_list()
        elif path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_get(item_id)
            else:
                self.send_error(404)
        elif path == '/api/live':
            self._handle_live_list()
        elif path.startswith('/api/live/'):
            item_id = path[len('/api/live/'):]
            if item_id and '/' not in item_id:
                self._handle_live_get(item_id)
            else:
                self.send_error(404)
        elif path == '/api/analytics':
            self._handle_analytics_read()
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                parsed_qs = urllib.parse.urlparse(self.path)
                qs_params = urllib.parse.parse_qs(parsed_qs.query)
                slot_id   = qs_params.get('s', [None])[0]
                self._handle_flyer_get(item_id, slot_id)
            else:
                self.send_error(404)
        elif path == '/sw.js':
            # Service worker must never be cached by HTTP cache
            self._serve_static_nocache('sw.js', 'application/javascript')
        else:
            super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/api/auth':
            self._handle_auth_post()
        elif path == '/api/diary':
            self._handle_diary_create()
        elif path == '/api/live':
            self._handle_live_create()
        elif path == '/api/analytics':
            self._handle_analytics_track()
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                self._handle_flyer_post(item_id)
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_PUT(self):
        path = self.path.split('?')[0].rstrip('/')
        if path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_update(item_id)
                return
        elif path.startswith('/api/live/'):
            item_id = path[len('/api/live/'):]
            if item_id and '/' not in item_id:
                self._handle_live_update(item_id)
                return
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                self._handle_flyer_put(item_id)
                return
        self.send_error(404)

    def do_DELETE(self):
        path = self.path.split('?')[0].rstrip('/')
        if path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_delete(item_id)
                return
        elif path.startswith('/api/live/'):
            item_id = path[len('/api/live/'):]
            if item_id and '/' not in item_id:
                self._handle_live_delete(item_id)
                return
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                parsed_qs = urllib.parse.urlparse(self.path)
                qs_params = urllib.parse.parse_qs(parsed_qs.query)
                slot_id   = qs_params.get('s', [None])[0]
                self._handle_flyer_delete(item_id, slot_id)
                return
        self.send_error(404)

    # ── No-cache headers for HTML ─────────────────────────────────────────────

    def end_headers(self):
        path = self.path.split('?')[0]
        if path.endswith('.html') or path in ('/', '') or not os.path.splitext(path)[1]:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.send_header(
                'Content-Security-Policy',
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' https://fonts.googleapis.com; "
                "font-src https://fonts.gstatic.com; "
                "img-src 'self' data:; "
                "connect-src 'self' https://ipapi.co https://freeipapi.com "
                "https://api.openweathermap.org; "
                "frame-ancestors 'self' https://*.replit.dev https://*.replit.co "
                "https://*.replit.com https://replit.com;"
            )
        super().end_headers()

    # ── /afterhours ───────────────────────────────────────────────────────────

    def _handle_afterhours(self):
        self._serve_template('afterhours.html')

    def _handle_afterhours_diary(self):
        self._serve_template('afterhours-diary.html')

    def _serve_static_nocache(self, filename, content_type):
        filepath = os.path.join(_ROOT, filename)
        try:
            with open(filepath, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Service-Worker-Allowed', '/')
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_error(404)

    def _serve_template(self, filename):
        filepath = os.path.join(_TEMPLATES, filename)
        try:
            with open(filepath, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_error(404)

    # ── GET /api/auth  (session check) ────────────────────────────────────────

    def _handle_auth_get(self):
        member = self._get_authed_member()
        if member is None:
            self._write_json(401, {'ok': False})
            return
        comment = _get_member_comment(member)
        self._write_json(200, {'ok': True, 'member': member, 'comment': comment})

    # ── POST /api/auth  (login / logout) ──────────────────────────────────────

    def _handle_auth_post(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return

        action = body.get('action')

        if action == 'login':
            given   = str(body.get('password', ''))
            matched = None
            for m in _get_members():
                pw = str(m.get('password', ''))
                g  = given.encode()
                p  = pw.encode() if pw else b'\x00'
                same_len = bool(pw) and len(g) == len(p)
                is_match = same_len and hmac.compare_digest(g, p)
                if is_match and matched is None:
                    matched = m
            if not matched:
                self._write_json(401, {'ok': False})
                return
            member_name = matched.get('name', '')
            token = _make_token(member_name)
            self._write_json_with_cookie(
                200,
                {'ok': True, 'token': token, 'member': member_name},
                _cookie_header(token)
            )
            return

        if action == 'logout':
            self._write_json_with_cookie(200, {'ok': True}, _cookie_header(None))
            return

        self._write_json(400, {'error': 'Unknown action'})

    # ── Auth shortcut ─────────────────────────────────────────────────────────

    def _get_authed_member(self):
        """Returns member name (str) if authenticated, None otherwise."""
        auth_header = self.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            result = _verify_token(auth_header[7:])
            if result is not None:
                return result
        cookies = _parse_cookies(self.headers.get('Cookie', ''))
        result = _verify_token(cookies.get(_COOKIE_NAME, ''))
        if result is not None:
            return result
        return None

    def _is_authed(self):
        return self._get_authed_member() is not None

    # ── GET /api/diary ────────────────────────────────────────────────────────

    def _handle_diary_list(self):
        authed = self._is_authed()
        posts  = _load_diary()
        if _auto_promote_scheduled(posts):
            _save_diary(posts)
        if not authed:
            posts = [p for p in posts if p.get('status') == 'published']
        posts.sort(
            key=lambda p: (p.get('date', ''), p.get('scheduledAt', '')),
            reverse=True
        )
        self._write_json(200, posts)

    # ── GET /api/diary/<id> ───────────────────────────────────────────────────

    def _handle_diary_get(self, item_id):
        authed = self._is_authed()
        posts  = _load_diary()
        if _auto_promote_scheduled(posts):
            _save_diary(posts)
        post = next((p for p in posts if p.get('id') == item_id), None)
        if not post:
            self._write_json(404, {'error': 'Not found'})
            return
        if post.get('status') != 'published' and not authed:
            self._write_json(404, {'error': 'Not found'})
            return
        self._write_json(200, post)

    # ── POST /api/diary ───────────────────────────────────────────────────────

    def _handle_diary_create(self):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        now    = time.strftime('%Y-%m-%dT%H:%M:%S')
        status = body.get('status', 'draft')
        if status not in ('published', 'draft', 'scheduled'):
            status = 'draft'
        raw_date = str(body.get('date', ''))
        if raw_date and not _DATE_RE.match(raw_date):
            self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
            return
        raw_sched = str(body.get('scheduledAt', '')).strip()
        if status == 'scheduled':
            if not raw_sched or not _SCHED_AT_RE.match(raw_sched):
                self._write_json(400, {'error': 'scheduledAt required (YYYY-MM-DDTHH:MM)'})
                return
        else:
            raw_sched = ''
        post = {
            'id':          str(_uuid_mod.uuid4()),
            'title':       str(body.get('title', '')).strip(),
            'body':        str(body.get('body',  '')).strip(),
            'date':        _valid_date(raw_date),
            'status':      status,
            'scheduledAt': raw_sched,
            'createdAt':   now,
            'updatedAt':   now,
        }
        posts = _load_diary()
        posts.insert(0, post)
        _save_diary(posts)
        self._write_json(201, post)

    # ── PUT /api/diary/<id> ───────────────────────────────────────────────────

    def _handle_diary_update(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        posts = _load_diary()
        idx   = next((i for i, p in enumerate(posts) if p.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        prev   = posts[idx]
        status = body.get('status', prev.get('status', 'draft'))
        if status not in ('published', 'draft', 'scheduled'):
            status = prev.get('status', 'draft')
        if 'date' in body:
            raw_date = str(body['date'])
            if not _DATE_RE.match(raw_date):
                self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
                return
        raw_sched = str(body['scheduledAt']).strip() if 'scheduledAt' in body \
                    else prev.get('scheduledAt', '')
        if status == 'scheduled':
            if not raw_sched or not _SCHED_AT_RE.match(raw_sched):
                self._write_json(400, {'error': 'scheduledAt required (YYYY-MM-DDTHH:MM)'})
                return
        else:
            raw_sched = ''
        updated = {
            **prev,
            'title':       str(body['title']).strip()  if 'title' in body else prev.get('title', ''),
            'body':        str(body['body']).strip()   if 'body'  in body else prev.get('body',  ''),
            'date':        body['date']                if 'date'  in body else prev.get('date',  _today_iso()),
            'status':      status,
            'scheduledAt': raw_sched,
            'updatedAt':   time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        posts[idx] = updated
        _save_diary(posts)
        self._write_json(200, updated)

    # ── DELETE /api/diary/<id> ────────────────────────────────────────────────

    def _handle_diary_delete(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        posts = _load_diary()
        idx   = next((i for i, p in enumerate(posts) if p.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        posts.pop(idx)
        _save_diary(posts)
        self._write_json(200, {'ok': True})

    # ── GET /api/live ─────────────────────────────────────────────────────────

    def _handle_live_list(self):
        authed = self._is_authed()
        lives  = _load_lives()
        if not authed:
            lives = [l for l in lives if l.get('status') == 'published']
        self._write_json(200, lives)

    # ── GET /api/live/<id> ────────────────────────────────────────────────────

    def _handle_live_get(self, item_id):
        authed = self._is_authed()
        lives  = _load_lives()
        live   = next((l for l in lives if l.get('id') == item_id), None)
        if not live:
            self._write_json(404, {'error': 'Not found'})
            return
        if live.get('status') != 'published' and not authed:
            self._write_json(404, {'error': 'Not found'})
            return
        self._write_json(200, live)

    # ── POST /api/live ────────────────────────────────────────────────────────

    def _handle_live_create(self):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        now    = time.strftime('%Y-%m-%dT%H:%M:%S')
        status = body.get('status', 'draft')
        if status not in ('published', 'draft'):
            status = 'draft'
        raw_date = str(body.get('date', ''))
        if raw_date and not _DATE_RE.match(raw_date):
            self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
            return
        lives = _load_lives()
        # Default sort_order: one higher than current max
        max_order = max((l.get('sort_order', 0) for l in lives), default=-1)
        raw_order = body.get('sort_order', max_order + 1)
        try:
            sort_order = int(raw_order)
        except (TypeError, ValueError):
            self._write_json(400, {'error': 'sort_order must be an integer'})
            return
        live = {
            'id':         str(_uuid_mod.uuid4()),
            'date':       _valid_date(raw_date),
            'venue':      str(body.get('venue',  '')).strip(),
            'open':       _valid_time(str(body.get('open',  '')).strip()),
            'start':      _valid_time(str(body.get('start', '')).strip()),
            'ticket':     str(body.get('ticket', '')).strip(),
            'status':     status,
            'sort_order': sort_order,
            'createdAt':  now,
            'updatedAt':  now,
        }
        lives.append(live)
        _save_lives(lives)
        self._write_json(201, live)

    # ── PUT /api/live/<id> ────────────────────────────────────────────────────

    def _handle_live_update(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        lives = _load_lives()
        idx   = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        prev   = lives[idx]
        status = body.get('status', prev.get('status', 'draft'))
        if status not in ('published', 'draft'):
            status = prev.get('status', 'draft')
        if 'date' in body:
            raw_date = str(body['date'])
            if raw_date and not _DATE_RE.match(raw_date):
                self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
                return
        if 'sort_order' in body:
            try:
                new_order = int(body['sort_order'])
            except (TypeError, ValueError):
                self._write_json(400, {'error': 'sort_order must be an integer'})
                return
        else:
            new_order = prev.get('sort_order', idx)
        updated = {
            **prev,
            'date':       body['date']                               if 'date'   in body else prev.get('date', _today_iso()),
            'venue':      str(body['venue']).strip()                 if 'venue'  in body else prev.get('venue',  ''),
            'open':       _valid_time(str(body['open']).strip())     if 'open'   in body else prev.get('open',   ''),
            'start':      _valid_time(str(body['start']).strip())    if 'start'  in body else prev.get('start',  ''),
            'ticket':     str(body['ticket']).strip()                if 'ticket' in body else prev.get('ticket', ''),
            'status':     status,
            'sort_order': new_order,
            'updatedAt':  time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        lives[idx] = updated
        _save_lives(lives)
        self._write_json(200, updated)

    # ── DELETE /api/live/<id> ─────────────────────────────────────────────────

    def _handle_live_delete(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        lives = _load_lives()
        idx   = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        lives.pop(idx)
        _save_lives(lives)
        self._write_json(200, {'ok': True})


    # -- POST /api/analytics -- collect event ----------------------------

    _ANALYTICS_UUID_RE = re.compile(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)
    _ANALYTICS_EVENTS = frozenset(
        ['page_view', 'music_play', 'diary_view', 'live_view', 'contact_view'])

    def _handle_analytics_track(self):
        """POST /api/analytics -- store one analytics event (no auth required)."""
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Invalid JSON'})
            return

        visitor_id     = str(body.get('visitor_id', '')).strip()
        session_id     = str(body.get('session_id', '')).strip()
        page           = str(body.get('page', '/')).strip()[:300]
        event          = str(body.get('event', '')).strip()
        is_new_visitor = bool(body.get('is_new_visitor', False))
        props          = body.get('props', {})

        if not self._ANALYTICS_UUID_RE.match(visitor_id):
            self._write_json(400, {'error': 'Invalid visitor_id'})
            return
        if not self._ANALYTICS_UUID_RE.match(session_id):
            self._write_json(400, {'error': 'Invalid session_id'})
            return
        if event not in self._ANALYTICS_EVENTS:
            self._write_json(400, {'error': 'Invalid event'})
            return
        if not isinstance(props, dict):
            props = {}

        now      = datetime.datetime.now(datetime.timezone.utc)
        jst_date = (now + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')
        entry    = {
            'id':             str(_uuid_mod.uuid4()),
            'ts':             now.isoformat(),
            'visitor_id':     visitor_id,
            'session_id':     session_id,
            'page':           page,
            'event':          event,
            'is_new_visitor': is_new_visitor,
            'props':          props,
        }

        analytics_dir = os.path.join(_DATA_DIR, 'analytics')
        os.makedirs(analytics_dir, exist_ok=True)
        file_path = os.path.join(analytics_dir, jst_date + '.json')

        events = []
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                if isinstance(data, list):
                    events = data
            except Exception:
                pass

        events.append(entry)
        try:
            with open(file_path, 'w', encoding='utf-8') as fh:
                json.dump(events, fh, ensure_ascii=False)
        except Exception:
            self._write_json(500, {'error': 'Storage error'})
            return

        self.send_response(204)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    # -- GET /api/analytics -- query events (admin only) ------------------

    def _handle_analytics_read(self):
        """GET /api/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD -- return events."""
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return

        _DATE_RE = re.compile(r'\d{4}-\d{2}-\d{2}')
        today    = (datetime.datetime.now(datetime.timezone.utc)
                    + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')

        parsed = urllib.parse.urlparse(self.path)
        qs     = urllib.parse.parse_qs(parsed.query)
        start  = qs.get('start', [today])[0]
        end    = qs.get('end',   [today])[0]
        if not _DATE_RE.fullmatch(start):
            start = today
        if not _DATE_RE.fullmatch(end):
            end = today

        analytics_dir = os.path.join(_DATA_DIR, 'analytics')
        all_events    = []
        cur  = datetime.date.fromisoformat(start)
        last = datetime.date.fromisoformat(end)
        days = 0
        while cur <= last and days < 90:
            fp = os.path.join(analytics_dir, cur.isoformat() + '.json')
            if os.path.exists(fp):
                try:
                    with open(fp, 'r', encoding='utf-8') as fh:
                        data = json.load(fh)
                    if isinstance(data, list):
                        all_events.extend(data)
                except Exception:
                    pass
            cur  += datetime.timedelta(days=1)
            days += 1

        all_events.sort(key=lambda e: e.get('ts', ''))
        self._write_json(200, {
            'start':  start,
            'end':    end,
            'count':  len(all_events),
            'events': all_events,
        })

    # -- GET /api/milestones -- lifetime milestone state (admin only) ----------

    def _handle_milestones_read(self):
        """GET /api/milestones -- return all milestone states with achievement dates."""
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return

        # ── 1. Load all-time analytics events ────────────────────────────────
        analytics_dir = os.path.join(_DATA_DIR, 'analytics')
        all_events    = []
        meta_path     = os.path.join(analytics_dir, 'meta.json')
        first_date    = None
        if os.path.exists(meta_path):
            try:
                first_date = json.load(open(meta_path, encoding='utf-8')).get('firstDate')
            except Exception:
                pass

        if first_date and os.path.isdir(analytics_dir):
            today_jst = (datetime.datetime.now(datetime.timezone.utc)
                         + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')
            cur  = datetime.date.fromisoformat(first_date)
            last = datetime.date.fromisoformat(today_jst)
            while cur <= last:
                fp = os.path.join(analytics_dir, cur.isoformat() + '.json')
                if os.path.exists(fp):
                    try:
                        data = json.load(open(fp, encoding='utf-8'))
                        if isinstance(data, list):
                            all_events.extend(data)
                    except Exception:
                        pass
                cur += datetime.timedelta(days=1)

        all_events.sort(key=lambda e: e.get('ts', ''))

        # ── 2. Load content data ──────────────────────────────────────────────
        diaries, lives = [], []
        for path_, target in (('diary.json', None), ('lives.json', None)):
            fp = os.path.join(_DATA_DIR, path_)
            try:
                data = json.load(open(fp, encoding='utf-8'))
                if path_ == 'diary.json':
                    diaries = data if isinstance(data, list) else []
                else:
                    lives   = data if isinstance(data, list) else []
            except Exception:
                pass

        # ── 3. Compute current values ─────────────────────────────────────────
        values = _ms_compute_values(all_events, diaries, lives)

        # ── 4. Load / update achievement dates (FS cache) ─────────────────────
        ms_cache_path = os.path.join(_DATA_DIR, 'milestones.json')
        achieved_cache = {}
        if os.path.exists(ms_cache_path):
            try:
                achieved_cache = json.load(open(ms_cache_path, encoding='utf-8'))
            except Exception:
                pass

        cache_dirty = False
        milestones_out = []
        for ms in _MILESTONES_DEFS:
            current     = values.get(ms['metric'], 0)
            is_achieved = current >= ms['target']
            achieved_at = achieved_cache.get(ms['id'])

            if is_achieved and not achieved_at:
                achieved_at = _ms_find_date(ms['metric'], ms['target'],
                                            all_events, diaries, lives)
                if not achieved_at:
                    achieved_at = datetime.datetime.now(
                        datetime.timezone.utc).isoformat()
                achieved_cache[ms['id']] = achieved_at
                cache_dirty = True

            milestones_out.append({
                'id':         ms['id'],
                'cat':        ms['cat'],
                'catIcon':    ms['catIcon'],
                'label':      ms['label'],
                'target':     ms['target'],
                'unit':       ms['unit'],
                'current':    current,
                'achieved':   is_achieved,
                'achievedAt': achieved_at,
                'diff':       max(0, ms['target'] - current),
            })

        if cache_dirty:
            try:
                with open(ms_cache_path, 'w', encoding='utf-8') as fh:
                    json.dump(achieved_cache, fh, ensure_ascii=False, indent=2)
            except Exception:
                pass

        self._write_json(200, {'milestones': milestones_out})

    # ── Flyer storage helpers ─────────────────────────────────────────────────

    def _normalize_flyer(self, live):
        """Normalise live['flyer'] → list of slot IDs."""
        f = live.get('flyer')
        if not f:
            return []
        if f is True:
            return ['0']
        if isinstance(f, list):
            return f
        return []

    def _read_flyer_slot(self, item_id, slot_id):
        """Read data URL for a slot; falls back to legacy file for slot '0'."""
        for base in ['/tmp', os.getcwd()]:
            p = os.path.join(base, 'data', 'flyers', item_id, slot_id + '.b64')
            if os.path.exists(p):
                try:
                    return open(p, 'r', encoding='utf-8').read().strip()
                except OSError:
                    pass
        if slot_id == '0':
            for base in ['/tmp', os.getcwd()]:
                p = os.path.join(base, 'data', 'flyers', item_id + '.b64')
                if os.path.exists(p):
                    try:
                        return open(p, 'r', encoding='utf-8').read().strip()
                    except OSError:
                        pass
        return None

    def _write_flyer_slot(self, item_id, slot_id, data_url):
        """Write data URL for a slot."""
        for base in [_DATA_DIR, '/tmp']:
            try:
                d = os.path.join(base, 'flyers', item_id)
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, slot_id + '.b64'), 'w', encoding='utf-8') as fh:
                    fh.write(data_url)
                return
            except OSError:
                pass
        raise OSError('Could not write flyer slot %s/%s' % (item_id, slot_id))

    def _delete_flyer_slot(self, item_id, slot_id):
        """Delete data for a slot (including legacy file for slot '0')."""
        for base in [_DATA_DIR, '/tmp']:
            p = os.path.join(base, 'flyers', item_id, slot_id + '.b64')
            try:
                os.remove(p)
            except OSError:
                pass
        if slot_id == '0':
            for base in [_DATA_DIR, '/tmp']:
                p = os.path.join(base, 'flyers', item_id + '.b64')
                try:
                    os.remove(p)
                except OSError:
                    pass

    # ── GET /api/flyer/<id>[?s=SLOT] ─────────────────────────────────────────

    def _handle_flyer_get(self, item_id, slot_id=None):
        import base64 as _b64
        lives = _load_lives()
        live  = next((l for l in lives if l.get('id') == item_id), None)
        if not live:
            self.send_error(404)
            return
        if live.get('status') != 'published' and not self._is_authed():
            self.send_error(404)
            return

        images = self._normalize_flyer(live)
        if not images:
            self.send_error(404)
            return

        target_slot = slot_id if slot_id else images[0]
        if target_slot not in images:
            self.send_error(404)
            return

        flyer_data = self._read_flyer_slot(item_id, target_slot)
        if not flyer_data:
            self.send_error(404)
            return

        try:
            sep = ';base64,'
            if not flyer_data.startswith('data:') or sep not in flyer_data:
                self.send_error(500)
                return
            header, b64data = flyer_data.split(sep, 1)
            mime_type = header[len('data:'):]
            img_data  = _b64.b64decode(b64data)
            self.send_response(200)
            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(len(img_data)))
            self.send_header('Cache-Control', 'public, max-age=86400')
            http.server.BaseHTTPRequestHandler.end_headers(self)
            self.wfile.write(img_data)
        except Exception as e:
            print('[flyer] GET error: %s' % e)
            self.send_error(500)

    # ── POST /api/flyer/<id> — add new image ──────────────────────────────────

    def _handle_flyer_post(self, item_id):
        import random
        import string as _string
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        length = int(self.headers.get('Content-Length', 0))
        if length > 6 * 1024 * 1024:
            self._write_json(413, {'error': 'Image too large (max ~4 MB)'})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return
        data_url = body.get('dataUrl', '')
        if not isinstance(data_url, str) or not data_url.startswith('data:image/'):
            self._write_json(400, {'error': 'Invalid image dataUrl'})
            return
        if ';base64,' not in data_url:
            self._write_json(400, {'error': 'dataUrl must be base64 encoded'})
            return
        lives = _load_lives()
        idx = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Live not found'})
            return
        current_images = self._normalize_flyer(lives[idx])
        if len(current_images) >= 20:
            self._write_json(400, {'error': '画像は最大20枚までです'})
            return
        slot_id = ''.join(random.choices(_string.ascii_lowercase + _string.digits, k=6))
        try:
            self._write_flyer_slot(item_id, slot_id, data_url)
        except OSError as e:
            print('[flyer] POST write error: %s' % e)
            self._write_json(500, {'error': 'Failed to save image'})
            return
        new_images = current_images + [slot_id]
        lives[idx] = dict(lives[idx], flyer=new_images,
                          updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S'))
        _save_lives(lives)
        self._write_json(200, {'ok': True, 'slotId': slot_id, 'images': new_images})

    # ── PUT /api/flyer/<id> — backward compat: set slot '0' ──────────────────

    def _handle_flyer_put(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        length = int(self.headers.get('Content-Length', 0))
        if length > 6 * 1024 * 1024:
            self._write_json(413, {'error': 'Image too large (max ~4 MB)'})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return
        data_url = body.get('dataUrl', '')
        if not isinstance(data_url, str) or not data_url.startswith('data:image/'):
            self._write_json(400, {'error': 'Invalid image dataUrl'})
            return
        if ';base64,' not in data_url:
            self._write_json(400, {'error': 'dataUrl must be base64 encoded'})
            return
        lives = _load_lives()
        idx = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Live not found'})
            return
        try:
            self._write_flyer_slot(item_id, '0', data_url)
        except OSError as e:
            print('[flyer] PUT write error: %s' % e)
            self._write_json(500, {'error': 'Failed to save flyer'})
            return
        current_images = self._normalize_flyer(lives[idx])
        new_images = current_images if '0' in current_images else ['0'] + current_images
        lives[idx] = dict(lives[idx], flyer=new_images,
                          updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S'))
        _save_lives(lives)
        self._write_json(200, {'ok': True, 'images': new_images})

    # ── DELETE /api/flyer/<id>[?s=SLOT] ──────────────────────────────────────

    def _handle_flyer_delete(self, item_id, slot_id=None):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        lives = _load_lives()
        idx = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Live not found'})
            return
        current_images = self._normalize_flyer(lives[idx])
        if slot_id:
            if slot_id not in current_images:
                self._write_json(404, {'error': 'Slot not found'})
                return
            self._delete_flyer_slot(item_id, slot_id)
            new_images = [s for s in current_images if s != slot_id]
        else:
            # Delete ALL slots
            for s in current_images:
                self._delete_flyer_slot(item_id, s)
            # Also clean up any legacy file
            for base in [_DATA_DIR, '/tmp']:
                p = os.path.join(base, 'flyers', item_id + '.b64')
                try:
                    os.remove(p)
                except OSError:
                    pass
            new_images = []
        lives[idx] = dict(lives[idx], flyer=new_images,
                          updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S'))
        _save_lives(lives)
        self._write_json(200, {'ok': True, 'images': new_images})

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return None

    def _write_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        http.server.BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(body)

    def _write_json_with_cookie(self, status, payload, cookie):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Set-Cookie', cookie)
        self.send_header('Cache-Control', 'no-store')
        http.server.BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(body)

    # ── Weather ───────────────────────────────────────────────────────────────

    def _handle_weather(self):
        t_total = time.monotonic()
        parsed  = urllib.parse.urlparse(self.path)
        params  = urllib.parse.parse_qs(parsed.query)
        lat_raw = params.get('lat', [None])[0]
        lon_raw = params.get('lon', [None])[0]
        api_key = os.environ.get('OPENWEATHERMAP_API_KEY', '')

        lat = lon = None

        if lat_raw and lon_raw:
            try:
                lat = float(lat_raw)
                lon = float(lon_raw)
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError('out of bounds')
                print('[weather/coords] explicit lat=%s lon=%s' % (lat, lon))
            except (TypeError, ValueError):
                self._write_json(400, {'condition': None})
                return
        else:
            forwarded = self.headers.get('X-Forwarded-For', '')
            ip = forwarded.split(',')[0].strip() if forwarded else self.client_address[0]
            t_geo  = time.monotonic()
            geo_ok = False

            try:
                path = ip if ip else 'json'
                with urllib.request.urlopen('https://ipapi.co/%s/json/' % path, timeout=3) as resp:
                    geo = json.loads(resp.read())
                if geo.get('latitude') is not None and geo.get('longitude') is not None and not geo.get('error'):
                    lat    = geo['latitude']
                    lon    = geo['longitude']
                    geo_ok = True
                    print('[weather/geo]   %dms  ipapi.co lat=%s lon=%s' % (int((time.monotonic()-t_geo)*1000), lat, lon))
                else:
                    print('[weather/geo]   ipapi.co no coords: %s' % geo.get('reason', '?'))
            except Exception as e:
                print('[weather/geo]   ipapi.co error: %s' % e)

            if not geo_ok:
                try:
                    url2 = 'https://freeipapi.com/api/json/%s' % (ip or '')
                    with urllib.request.urlopen(url2, timeout=3) as resp:
                        geo2 = json.loads(resp.read())
                    if geo2.get('latitude') is not None and geo2.get('longitude') is not None:
                        lat    = geo2['latitude']
                        lon    = geo2['longitude']
                        geo_ok = True
                        print('[weather/geo]   %dms  freeipapi lat=%s lon=%s' % (int((time.monotonic()-t_geo)*1000), lat, lon))
                    else:
                        print('[weather/geo]   freeipapi.com no coords')
                except Exception as e:
                    print('[weather/geo]   freeipapi.com error: %s' % e)

            if not geo_ok:
                print('[weather/geo]   both services failed')
                self._write_json(200, {'condition': None})
                return

        condition = None
        if api_key:
            t_owm = time.monotonic()
            try:
                qs  = urllib.parse.urlencode({'lat': lat, 'lon': lon, 'appid': api_key, 'units': 'metric'})
                url = 'https://api.openweathermap.org/data/2.5/weather?' + qs
                with urllib.request.urlopen(url, timeout=5) as resp:
                    data = json.loads(resp.read())
                condition = data['weather'][0]['main']
                temp_c = data.get('main', {}).get('temp')  # °C (units=metric)
                print('[weather/owm]   %dms  condition=%s temp=%.1f' % (int((time.monotonic()-t_owm)*1000), condition, temp_c if temp_c is not None else 0))
            except Exception as e:
                print('[weather/owm]   %dms  error: %s' % (int((time.monotonic()-t_owm)*1000), e))

        print('[weather/total] %dms' % int((time.monotonic()-t_total)*1000))
        self._write_json(200, {'condition': condition, 'temp': temp_c})

    # -- GET /api/insights -- rule-based insights (admin only) ------------------

    def _handle_insights_read(self):
        """GET /api/insights -- return rule-based insights for the Insights page."""
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return

        analytics_dir = os.path.join(_DATA_DIR, 'analytics')
        today    = _ins_today_str()
        yesterday = _ins_add_days(today, -1)

        # Week bounds
        this_week_start = _ins_week_monday(today)
        last_week_start = _ins_add_days(this_week_start, -7)
        last_week_end   = _ins_add_days(this_week_start, -1)

        # Month bounds
        this_month_start        = today[:7] + '-01'
        prev_month_s, prev_month_e = _ins_prev_month_bounds(today)

        # All-time first date
        meta_path  = os.path.join(analytics_dir, 'meta.json')
        first_date = None
        if os.path.exists(meta_path):
            try:
                first_date = json.load(open(meta_path, encoding='utf-8')).get('firstDate')
            except Exception:
                pass

        all_dates = _ins_date_range(first_date, today) if first_date else []

        def load(dates):
            return _ins_read_analytics_days(analytics_dir, dates)

        today_ev      = load([today])
        yest_ev       = load([yesterday])
        this_week_ev  = load(_ins_date_range(this_week_start, today))
        last_week_ev  = load(_ins_date_range(last_week_start, last_week_end))
        this_month_ev = load(_ins_date_range(this_month_start, today))
        last_month_ev = load(_ins_date_range(prev_month_s, prev_month_e))
        all_ev        = load(all_dates) if all_dates else []

        all_by_date = _ins_group_by_date(all_ev)

        # Content data
        diaries, lives = [], []
        for fname, target in (('diary.json', 'diary'), ('lives.json', 'live')):
            fp = os.path.join(_DATA_DIR, fname)
            try:
                data = json.load(open(fp, encoding='utf-8'))
                if isinstance(data, list):
                    (diaries if target == 'diary' else lives).__iadd__(data)
            except Exception:
                pass

        # Milestone achievement cache
        ms_cache = {}
        ms_cache_path = os.path.join(_DATA_DIR, 'milestones.json')
        if os.path.exists(ms_cache_path):
            try:
                ms_cache = json.load(open(ms_cache_path, encoding='utf-8'))
            except Exception:
                pass

        recent_lives = [l for l in lives
                        if l.get('date') and l['date'][:10] >= _ins_add_days(today, -7)]

        today_sec   = _ins_build_today(today_ev, yest_ev, this_week_ev, last_week_ev,
                                       all_by_date, recent_lives, today)
        weekly_sec  = _ins_build_weekly(this_week_ev, last_week_ev,
                                        this_week_start, last_week_start, today)
        monthly_sec = _ins_build_monthly(this_month_ev, last_month_ev,
                                         lives, diaries, today[:7])
        ach_sec     = _ins_build_achievements(ms_cache)
        rec_sec     = _ins_build_recommendations(all_ev, lives, diaries, all_by_date)
        tl_sec      = _ins_build_timeline(diaries, lives, ms_cache)

        self._write_json(200, {
            'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'today':        today_sec,
            'weekly':       weekly_sec,
            'monthly':      monthly_sec,
            'achievements': ach_sec,
            'recommendations': rec_sec,
            'timeline':     tl_sec,
        })

    # -- GET /api/music-analytics -- music analytics (admin only) ---------------

    def _handle_music_analytics_read(self):
        if not self._require_auth():
            return
        try:
            analytics_dir = os.path.join(os.path.dirname(__file__), 'data', 'analytics')
            lives_path    = os.path.join(os.path.dirname(__file__), 'data', 'lives.json')
            diary_path    = os.path.join(os.path.dirname(__file__), 'data', 'diary.json')

            lives   = _ma_read_json(lives_path)   or []
            diaries = _ma_read_json(diary_path)   or []

            today     = _ma_today_str()
            first_dt  = _ma_first_analytics_date(analytics_dir)
            all_dates = _ma_date_range(first_dt, today) if first_dt else []
            all_events = _ma_read_analytics_days(analytics_dir, all_dates)

            data = _ma_build(all_events, lives, diaries, today)
            self._send_json(data)
        except Exception as e:
            import traceback; traceback.print_exc()
            self._send_json({'error': str(e)}, 500)

    def log_message(self, format, *args):
        print(format % args)


if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 5000), NoCacheHandler)
    print('Serving on http://0.0.0.0:5000')
    server.serve_forever()
