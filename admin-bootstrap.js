/**
 * Independent, fail-closed loader guard for management pages.
 * No network requests and no authentication decisions are made here.
 */
(function () {
    'use strict';
    var page = document.body.dataset.page || '';
    if (page !== 'afterhours' && !page.startsWith('afterhours-')) return;

    function lock() {
        document.body.classList.add('auth-hidden');
        for (var child of document.body.children) {
            if (child.id !== 'auth-status' && !['SCRIPT', 'STYLE'].includes(child.tagName)) child.inert = true;
        }
    }
    function unavailable() {
        if (window._adminGateBootFailed) return;
        window._adminGateBootFailed = true;
        lock();
        new MutationObserver(lock).observe(document.body, { childList: true });
        if (document.getElementById('auth-status')) return;
        var panel = document.createElement('div');
        panel.id = 'auth-status';
        panel.style.cssText = 'visibility:visible;position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;';
        var card = document.createElement('div');
        card.className = 'card';
        card.style.animation = 'none';
        card.style.transform = 'none';
        var message = document.createElement('p');
        message.setAttribute('role', 'alert');
        message.textContent = '認証スクリプトを読み込めませんでした。管理画面は利用できません。再試行してください。';
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'admin-btn';
        retry.textContent = '再試行';
        retry.addEventListener('click', function () { window.location.reload(); });
        card.append(message, retry);
        panel.appendChild(card);
        document.body.appendChild(panel);
        retry.focus();
    }
    window._adminGateFailed = unavailable;
    // Replaced by admin.js only after its initialization completes.
    window._adminAuthFetch = function () {
        unavailable();
        return Promise.resolve(new Response(JSON.stringify({ error: 'Authentication script unavailable' }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
        }));
    };
    window.addEventListener('error', function (event) {
        if (event.target && event.target.tagName === 'SCRIPT' &&
            /\/admin\.js(?:\?|$)/.test(event.target.src)) unavailable();
    }, true);
    document.addEventListener('DOMContentLoaded', function () {
        if (window._adminGateInitialized !== true) unavailable();
    });
}());
