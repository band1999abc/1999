// Whale scroll animation — lerp (linear interpolation) for smooth inertia.
// Each rAF tick, current position moves 10% closer to target.
// This gives natural easing without any layout reads during animation.
(function () {
    'use strict';

    const card  = document.querySelector('.card');
    const whale = document.querySelector('.whale-bg');
    if (!card || !whale) return;

    const isHibiware = document.body.dataset.page === 'hibiware';
    const LERP_FACTOR = 0.10; // 0.0–1.0: lower = more inertia, higher = snappier

    let cardTop0  = 0;   // card distance from document top (cached)
    let targetY   = 0;   // where the whale should end up
    let currentY  = 0;   // where the whale is right now (lerped)
    let rafId     = null;
    let layoutRaf = null;

    function cacheCardTop() {
        let el = card, top = 0;
        while (el) { top += el.offsetTop; el = el.offsetParent; }
        cardTop0 = top;
    }

    function tick() {
        // Lerp current toward target
        currentY += (targetY - currentY) * LERP_FACTOR;

        // Apply — translate3d keeps the element on its GPU compositing layer
        whale.style.transform = 'translate3d(0,' + currentY.toFixed(2) + 'px,0)';

        // Keep animating until close enough (< 0.1px residual)
        if (Math.abs(targetY - currentY) > 0.1) {
            rafId = requestAnimationFrame(tick);
        } else {
            // Snap to exact target and stop the loop
            currentY = targetY;
            whale.style.transform = 'translate3d(0,' + currentY + 'px,0)';
            rafId = null;
        }
    }

    function getTargetY() {
        if (isHibiware) return window.scrollY;
        return Math.max(0, window.scrollY - cardTop0);
    }

    function onScroll() {
        targetY = getTargetY();
        if (isHibiware && window.scrollY === 0) {
            currentY = 0;
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            whale.style.transform = 'translate3d(0,0,0)';
            return;
        }
        if (rafId === null) {
            rafId = requestAnimationFrame(tick);
        }
    }

    function syncPosition() {
        cacheCardTop();
        targetY = getTargetY();
        currentY = targetY;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        whale.style.transform = 'translate3d(0,' + currentY + 'px,0)';
    }

    function scheduleLayoutRefresh() {
        if (layoutRaf !== null) return;
        layoutRaf = requestAnimationFrame(function () {
            layoutRaf = null;
            cacheCardTop();
            onScroll();
        });
    }

    cacheCardTop();
    window.addEventListener('resize', scheduleLayoutRefresh, { passive: true });
    window.addEventListener('orientationchange', scheduleLayoutRefresh, { passive: true });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleLayoutRefresh, { passive: true });
    }

    if ('ResizeObserver' in window) {
        const cardObserver = new ResizeObserver(scheduleLayoutRefresh);
        cardObserver.observe(card);
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    // Set initial state without animation
    targetY  = getTargetY();
    currentY = targetY;
    whale.style.transform = 'translate3d(0,' + currentY + 'px,0)';

    if (isHibiware) {
        // Reconcile browser-restored scroll and the final Android viewport.
        window.addEventListener('load', syncPosition, { once: true });
        window.addEventListener('pageshow', syncPosition);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(syncPosition);
        }
    }
}());
