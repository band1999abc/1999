/**
 * admin.js — client-side auth for /afterhours pages
 *
 * Auth strategy
 * ─────────────
 * Token is stored in sessionStorage and sent as
 * "Authorization: Bearer <token>" on every API call.
 * This works in Replit's iframe preview where third-party cookies are blocked.
 * An HttpOnly cookie is still set as a fallback for direct (non-iframe) access.
 *
 * data-page values handled here:
 *   "login"            → /afterhours/login
 *   "afterhours"       → /afterhours (dashboard)
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

    function authFetch(url, opts) {
        const token = getToken();
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {});
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, opts);
    }

    /* ── Login page (/afterhours/login) ───────────────────────────── */

    if (page === 'login') {
        // If already logged in, skip straight to dashboard
        if (getToken()) {
            window.location.replace(DASH_URL);
            return;
        }

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
                    errorEl.textContent = 'The passphrase is incorrect.';
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

    /* ── Gated pages (afterhours dashboard + sub-pages) ──────────── */

    if (page === 'afterhours' || page === 'afterhours-diary') {

        // Auth gate — runs immediately on page load
        (async function gate() {
            const token = getToken();
            if (!token) {
                window.location.replace(LOGIN_URL);
                return;
            }
            try {
                const res = await authFetch('/api/auth');
                if (!res.ok) {
                    sessionStorage.removeItem(SESSION_KEY);
                    window.location.replace(LOGIN_URL);
                }
            } catch {
                // Network hiccup — stay on page; next real action will re-check
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

}());
