// Keep the whale image visually fixed within the card as the page scrolls.
// Optimised for 60fps:
//   - card top is cached once (no layout read on every scroll)
//   - window.scrollY is read in the scroll handler (no reflow)
//   - transform: translate3d() is written in rAF (GPU-composited, no reflow)
//   - passive scroll listener + ticking flag prevent redundant rAF calls
(function () {
    'use strict';

    const card  = document.querySelector('.card');
    const whale = document.querySelector('.whale-bg');
    if (!card || !whale) return;

    let cardTop0 = 0;   // card's distance from document top (cached)
    let lastY    = 0;
    let ticking  = false;

    // Read the card's document-relative top once, without triggering a
    // forced synchronous layout on every scroll event.
    function cacheCardTop() {
        let el = card, top = 0;
        while (el) {
            top += el.offsetTop;
            el = el.offsetParent;
        }
        cardTop0 = top;
    }

    // Runs inside rAF — safe to write style here.
    function update() {
        const offset = Math.max(0, lastY - cardTop0);
        whale.style.transform = 'translate3d(0,' + offset + 'px,0)';
        ticking = false;
    }

    // Scroll handler: only read scrollY (no reflow), defer write to rAF.
    function onScroll() {
        lastY = window.scrollY;
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(update);
        }
    }

    // Cache once at load, refresh on resize (layout may shift).
    cacheCardTop();
    window.addEventListener('resize', function () {
        cacheCardTop();
        onScroll();
    }, { passive: true });

    window.addEventListener('scroll', onScroll, { passive: true });

    // Set initial position synchronously so there's no flash on load.
    lastY = window.scrollY;
    update();
}());
