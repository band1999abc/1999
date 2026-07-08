/**
 * admin.js — client-side auth for /afterhours pages
 *
 * Auth strategy
 * ─────────────
 * Primary: token in sessionStorage → "Authorization: Bearer <token>" header.
 *          Works in Replit's iframe preview where third-party cookies are blocked.
 * Fallback: HttpOnly cookie for direct (non-iframe) browser tab access.
 *           Server checks cookie when no Bearer header is present.
 *
 * The gate always calls GET /api/auth so the cookie fallback is honoured.
 *
 * data-page values:
 *   "login"            → /afterhours/login
 *   "afterhours"       → /afterhours  (dashboard)
 *   "afterhours-diary" → /afterhours/diary
 */
(function () {
    'use strict';

    const SESSION_KEY = 'admin_token';
    const LOGIN_URL   = '/afterhours/login';
    const DASH_URL    = '/afterhours';

    const page = document.body.dataset.page;

    /* ── Helpers ──────────────────────────────────────────────────── */

    function getToken() {
        return sessionStorage.getItem(SESSION_KEY) || '';
    }

    /**
     * Fetch with optional Bearer header.
     * On 401: clear sessionStorage token and redirect to login.
     * @param {string} url
     * @param {RequestInit} [opts]
     * @param {boolean} [noRedirectOn401] — set true for the gate check itself
     */
    async function authFetch(url, opts, noRedirectOn401) {
        const token = getToken();
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {});
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(url, opts);
        if (res.status === 401 && !noRedirectOn401) {
            sessionStorage.removeItem(SESSION_KEY);
            window.location.replace(LOGIN_URL);
        }
        return res;
    }

    /* ── Login page (/afterhours/login) ───────────────────────────── */

    if (page === 'login') {
        // Probe the server first — a valid cookie session (direct tab) skips login
        (async function checkExisting() {
            try {
                // No bearer token on login page; server falls back to cookie
                const res = await fetch('/api/auth');
                if (res.ok) {
                    window.location.replace(DASH_URL);
                }
            } catch {
                // network error — stay on login page
            }
        })();

        const form    = document.getElementById('login-form');
        const input   = document.getElementById('admin-password');
        const errorEl = document.getElementById('admin-error');
        const btn     = form && form.querySelector('.admin-btn');

        if (!form) return;

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            errorEl.textContent = '';
            if (btn) btn.disabled = true;

            try {
                const res = await fetch('/api/auth', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ action: 'login', password: input.value })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.token) {
                        sessionStorage.setItem(SESSION_KEY, data.token);
                    }
                    window.location.href = DASH_URL;
                } else {
                    errorEl.textContent = 'The password is incorrect.';
                    input.value = '';
                    input.focus();
                }
            } catch {
                errorEl.textContent = 'Unable to connect. Please try again.';
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }

    /* ── Gated pages (dashboard + sub-pages) ─────────────────────── */

    if (page === 'afterhours' || page === 'afterhours-diary' || page === 'afterhours-live' || page === 'afterhours-analytics' || page === 'afterhours-music' || page === 'afterhours-messages') {

        // Always call the server — honours both Bearer token AND cookie fallback
        (async function gate() {
            try {
                const res = await authFetch('/api/auth', {}, /* noRedirect */ true);
                if (!res.ok) {
                    sessionStorage.removeItem(SESSION_KEY);
                    window.location.replace(LOGIN_URL);
                    return;
                }
                // Auth confirmed — reveal the page
                document.body.classList.remove('auth-hidden');
                // Show personalized greeting on the dashboard
                if (page === 'afterhours') {
                    try {
                        const data = await res.json();
                        const el = document.getElementById('member-greeting');
                        if (el) {
                            el.textContent = data.comment ||
                                (data.member ? `おかえり、${data.member}さん。` : '');
                        }
                    } catch { /* ignore parse errors */ }
                }
            } catch {
                // Network hiccup — reveal anyway so the page isn't stuck hidden
                document.body.classList.remove('auth-hidden');
            }
        })();

        // Sign-out button
        const signoutBtn = document.getElementById('signout-btn');
        if (signoutBtn) {
            signoutBtn.addEventListener('click', async function () {
                this.disabled = true;
                try {
                    await authFetch('/api/auth', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ action: 'logout' })
                    });
                } finally {
                    sessionStorage.removeItem(SESSION_KEY);
                    window.location.href = '/';
                }
            });
        }
    }

    // Expose authFetch for diary-admin.js (same document scope)
    window._adminAuthFetch = authFetch;

}());
