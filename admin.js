/**
 * admin.js — client-side logic for /afterhours (login + dashboard)
 *
 * Detects which page is active via data-page on <body>:
 *   data-page="login"      → handle login form submission
 *   data-page="afterhours" → handle sign-out
 */
(function () {
    'use strict';

    const page = document.body.dataset.page;

    /* ── Login page ───────────────────────────────────────────── */
    if (page === 'login') {
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
                    window.location.href = '/afterhours';
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

    /* ── Admin dashboard ──────────────────────────────────────── */
    if (page === 'afterhours') {
        const signoutBtn = document.getElementById('signout-btn');

        if (signoutBtn) {
            signoutBtn.addEventListener('click', async function () {
                this.disabled = true;
                try {
                    await fetch('/api/auth', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ action: 'logout' })
                    });
                } finally {
                    window.location.href = '/';
                }
            });
        }
    }
}());
