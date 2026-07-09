/**
 * After Hours — Analytics Tracker  v1
 *
 * Auto-tracks:  page_view on every page load
 * Custom:       window.AH.track(event, props)
 *
 * Identifiers
 *   visitor_id  — localStorage '_ah_vid'   (persists across sessions → Visitor / New / Returning)
 *   session_id  — sessionStorage '_ah_sid' (new per browser session)
 *   is_new_visitor — true on first ever page_view for this browser
 *
 * Built-in auto-tracking
 *   page_view  — fires immediately on every page load
 *   track_view — fires when a .song-link element is clicked (楽曲詳細ページへの遷移)
 *
 * Outbound: POST /api/analytics  (sendBeacon preferred, fetch fallback)
 */
;(function () {
  'use strict';

  var ENDPOINT = '/api/analytics';
  var VID_KEY  = '_ah_vid';
  var SID_KEY  = '_ah_sid';

  // Registry of valid event types (must mirror EVENT_HANDLERS in api/analytics.js).
  // To add a new event: add the key here AND add a handler in api/analytics.js.
  var VALID_EVENTS = {
    visit:        true,
    page_view:    true,
    music_play:   true,
    track_view:   true,   // 楽曲詳細ページへの遷移（再生とは別カウント）
    diary_view:   true,
    live_view:    true,
    contact_view: true,
    qr_scan:      true,   // fired once per session when visitor arrives via ?ref=qr
  };

  // ── Identity ────────────────────────────────────────────────────────────────

  function _genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  var _isNew = false;

  function _getVisitorId() {
    try {
      var id = localStorage.getItem(VID_KEY);
      if (!id) {
        id = _genId();
        localStorage.setItem(VID_KEY, id);
        _isNew = true;                // first ever visit from this browser
      }
      return id;
    } catch (_) {
      _isNew = true;
      return _genId();               // private browsing / storage blocked
    }
  }

  function _getSessionId() {
    try {
      var id = sessionStorage.getItem(SID_KEY);
      if (!id) { id = _genId(); sessionStorage.setItem(SID_KEY, id); }
      return id;
    } catch (_) { return _genId(); }
  }

  var _vid = _getVisitorId();
  var _sid = _getSessionId();

  // ── Transport ───────────────────────────────────────────────────────────────

  function _send(payload) {
    try {
      var body = JSON.stringify(payload);
      // sendBeacon survives page unload; returns false if browser refuses the payload
      var sent = navigator.sendBeacon
        ? navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
        : false;
      if (!sent) {
        // Fallback: fetch with keepalive (works mid-session; may be dropped on unload)
        fetch(ENDPOINT, {
          method:    'POST',
          headers:   { 'Content-Type': 'application/json' },
          body:      body,
          keepalive: true
        }).catch(function () {});
      }
    } catch (_) {}
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Track a custom event.
   * @param {string} event  One of: visit | page_view | music_play | track_view | diary_view | live_view | contact_view
   * @param {object} props  Optional extra properties (track name, post id, etc.)
   */
  function track(event, props) {
    if (!VALID_EVENTS[event]) return;
    _send({
      visitor_id:     _vid,
      session_id:     _sid,
      page:           location.pathname,
      event:          event,
      is_new_visitor: _isNew,
      props:          (props && typeof props === 'object' && !Array.isArray(props)) ? props : {}
    });
  }

  // ── Auto: page_view ─────────────────────────────────────────────────────────

  function _autoPageView() {
    track('page_view', { referrer: document.referrer || '' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoPageView);
  } else {
    _autoPageView();
  }

  // ── Auto: track_view — .song-link click ──────────────────────────────────────
  // Fires in capture phase so sendBeacon survives navigation to the song page.
  // This counts "楽曲詳細ページへの遷移" — separate from actual audio playback
  // (music_play), which is fired by track.js when the play button is pressed.

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('song-link')) {
        var nameEl = el.querySelector('.song-name');
        track('track_view', { track: nameEl ? nameEl.textContent.trim() : '' });
        return;
      }
      el = el.parentNode;
    }
  }, true);

  // ── Auto: qr_scan — QR code landing detection ───────────────────────────────
  // Fires once per browser session when the URL contains ?ref=qr.
  // Props: { edition } — set from ?edition= for per-card analysis (future).
  //
  // Slight delay (80 ms) ensures page_view fires first so the QR scan event
  // shares the same session_id context that has already been established.

  (function () {
    var QR_FLAG = '_ah_qrs';   // sessionStorage key — prevents double-fire
    try {
      var params = new URLSearchParams(location.search);
      if (params.get('ref') === 'qr' && !sessionStorage.getItem(QR_FLAG)) {
        sessionStorage.setItem(QR_FLAG, '1');
        var props = {};
        var ed = params.get('edition');
        if (ed) props.edition = String(ed).slice(0, 50);
        setTimeout(function () { track('qr_scan', props); }, 80);
      }
    } catch (_) {}
  }());

  // ── Export ──────────────────────────────────────────────────────────────────

  window.AH = window.AH || {};
  window.AH.track = track;

}());
