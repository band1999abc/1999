// Whale scroll animation — lerp (linear interpolation) for smooth inertia.
// Each rAF tick, current position moves 10% closer to target.
// This gives natural easing without any layout reads during animation.
(function () {
    'use strict';

    const card  = document.querySelector('.card');
    const whale = document.querySelector('.whale-bg');
    if (!card || !whale) return;

    const LERP_FACTOR = 0.10; // 0.0–1.0: lower = more inertia, higher = snappier

    let cardTop0  = 0;   // card distance from document top (cached)
    let targetY   = 0;   // where the whale should end up
    let currentY  = 0;   // where the whale is right now (lerped)
    let rafId     = null;

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

    function onScroll() {
        targetY = Math.max(0, window.scrollY - cardTop0);
        if (rafId === null) {
            rafId = requestAnimationFrame(tick);
        }
    }

    cacheCardTop();
    window.addEventListener('resize', function () {
        cacheCardTop();
        onScroll();
    }, { passive: true });

    window.addEventListener('scroll', onScroll, { passive: true });

    // Set initial state without animation
    targetY  = Math.max(0, window.scrollY - cardTop0);
    currentY = targetY;
    whale.style.transform = 'translate3d(0,' + currentY + 'px,0)';
}());
