(function () {
    "use strict";

    const DAY_ART = `
        <svg class="site-footer__art site-footer__art--day" viewBox="0 0 1024 531"
             preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <defs>
                <filter id="footer-day-soft" x="-2%" y="-2%" width="104%" height="104%">
                    <feGaussianBlur stdDeviation="1.8"/>
                </filter>
                <mask id="footer-day-scene" maskUnits="userSpaceOnUse"
                      x="0" y="0" width="1024" height="531">
                    <rect width="1024" height="531" fill="black"/>
                    <path filter="url(#footer-day-soft)" fill="white" d="
                        M-8 139 L36 155 L68 144 L103 137 L128 124 L165 115
                        L200 126 L244 140 L280 156 L317 164 L354 179 L385 186
                        L411 179 L446 169 L462 166 L491 176 L523 194 L558 214
                        L592 237 L623 258 L650 264 L686 257 L726 274 L762 289
                        L799 295 L830 302 L850 306 L865 299 L889 274 L925 253
                        L954 244 L984 239 L975 251 L960 271 L941 289 L915 309
                        L905 318 L915 330 L940 346 L958 369 L975 383 L989 399
                        L973 397 L952 392 L932 379 L915 366 L897 355 L875 343
                        L862 340 L848 341 L829 354 L805 371 L781 382 L751 389
                        L722 389 L695 385 L670 380 L640 370 L611 360 L580 346
                        L550 334 L520 323 L484 312 L451 306 L415 306 L386 311
                        L350 313 L320 321 L296 332 L278 348 L259 364 L235 373
                        L214 378 L188 378 L159 369 L132 358 L109 350 L84 343
                        L67 343 L41 352 L15 358 L-8 363 Z"/>
                </mask>
                <mask id="footer-day-trail" maskUnits="userSpaceOnUse"
                      x="0" y="0" width="1024" height="531">
                    <rect width="1024" height="531" fill="black"/>
                    <path d="M580 220 C616 190 643 180 677 173
                        C714 166 746 183 777 159 C803 144 829 144 862 152
                        C875 155 883 154 889 153"
                        fill="none" stroke="white" stroke-width="22" filter="url(#footer-day-soft)"
                        stroke-linecap="round" stroke-linejoin="round"/>
                </mask>
                <mask id="footer-day-butterfly" maskUnits="userSpaceOnUse"
                      x="0" y="0" width="1024" height="531">
                    <rect width="1024" height="531" fill="black"/>
                    <rect x="880" y="115" width="64" height="75" rx="13"
                          filter="url(#footer-day-soft)" fill="white"/>
                </mask>
            </defs>
            <image data-src="/assets/footer/day-desaturated-butterfly-v2.webp" x="0" y="0" width="1024" height="531"
                   preserveAspectRatio="none" mask="url(#footer-day-scene)"/>
            <image data-src="/assets/footer/day-desaturated-butterfly-v2.webp" x="0" y="0" width="1024" height="531"
                   preserveAspectRatio="none" mask="url(#footer-day-trail)"/>
            <image data-src="/assets/footer/day-desaturated-butterfly-v2.webp" x="0" y="0" width="1024" height="531"
                   preserveAspectRatio="none" mask="url(#footer-day-butterfly)"/>
        </svg>`;

    const NIGHT_ART = `
        <svg class="site-footer__art site-footer__art--night" viewBox="0 0 1024 530"
             preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <defs>
                <filter id="footer-night-soft" x="-2%" y="-2%" width="104%" height="104%">
                    <feGaussianBlur stdDeviation="1.8"/>
                </filter>
                <mask id="footer-night-scene" maskUnits="userSpaceOnUse"
                      x="0" y="0" width="1024" height="530">
                    <rect width="1024" height="530" fill="black"/>
                    <path filter="url(#footer-night-soft)" fill="white" d="
                        M-8 152 L38 163 L65 168 L98 156 L132 141 L165 130
                        L198 137 L230 151 L260 166 L287 178 L322 171 L355 180
                        L385 190 L413 191 L446 181 L466 180 L491 194 L525 210
                        L557 231 L588 250 L616 267 L649 274 L679 271 L711 280
                        L743 294 L778 309 L809 317 L830 321 L847 315 L864 303
                        L883 285 L910 268 L940 252 L969 243 L961 258 L947 278
                        L929 297 L909 310 L897 320 L908 333 L927 345 L947 370
                        L975 401 L965 403 L949 398 L929 388 L909 375 L889 361
                        L869 348 L849 341 L832 345 L808 362 L786 380 L763 392
                        L742 395 L720 394 L693 391 L668 384 L641 375 L615 365
                        L590 355 L562 343 L539 334 L513 328 L486 325 L459 322
                        L434 320 L413 321 L391 326 L365 333 L342 344 L321 355
                        L301 369 L281 381 L254 390 L226 391 L206 389 L186 381
                        L165 374 L145 368 L124 359 L105 354 L83 355 L59 361
                        L35 370 L-8 378 Z"/>
                </mask>
                <mask id="footer-night-trail" maskUnits="userSpaceOnUse"
                      x="0" y="0" width="1024" height="530">
                    <rect width="1024" height="530" fill="black"/>
                    <path d="M590 245 C625 210 660 205 696 216
                        C735 227 773 192 803 173 C832 171 862 180 896 180"
                        fill="none" stroke="white" stroke-width="22" filter="url(#footer-night-soft)"
                        stroke-linecap="round" stroke-linejoin="round"/>
                </mask>
                <mask id="footer-night-star" maskUnits="userSpaceOnUse"
                      x="0" y="0" width="1024" height="530">
                    <rect width="1024" height="530" fill="black"/>
                    <path fill="white" d="M917 157 L922 169 L936 170 L925 179
                        L929 194 L917 186 L905 194 L909 179 L898 170 L912 169 Z"/>
                </mask>
            </defs>
            <image data-src="/assets/footer/original-night.webp" x="0" y="0" width="1024" height="530"
                   preserveAspectRatio="none" mask="url(#footer-night-scene)"/>
            <image data-src="/assets/footer/original-night.webp" x="0" y="0" width="1024" height="530"
                   preserveAspectRatio="none" mask="url(#footer-night-trail)"/>
            <image data-src="/assets/footer/original-night.webp" x="0" y="0" width="1024" height="530"
                   preserveAspectRatio="none" mask="url(#footer-night-star)"/>
        </svg>`;

    function setTextureAlignment(card, footer) {
        const cardStyle = window.getComputedStyle(card);
        const cardRect = card.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const offsetX = footerRect.left - cardRect.left - card.clientLeft;
        const offsetY = footerRect.top - cardRect.top - card.clientTop;
        const shiftPositions = (value) => value.split(",").map((position) => {
            const [x = "0px", y = "0px"] = position.trim().split(/\s+/);
            return `${(Number.parseFloat(x) || 0) - offsetX}px ${(Number.parseFloat(y) || 0) - offsetY}px`;
        }).join(", ");

        footer.style.backgroundPosition = shiftPositions(cardStyle.backgroundPosition);
        footer.style.setProperty("--site-footer-bleed-x", `${cardStyle.paddingLeft}`);
        footer.style.setProperty("--site-footer-bleed-right", `${cardStyle.paddingRight}`);
    }

    function initializeCard(card) {
        if (card.dataset.siteFooterInitialized === "true") return;
        card.dataset.siteFooterInitialized = "true";

        const footer = document.createElement("footer");
        footer.className = "site-footer";
        footer.setAttribute("aria-label", "1999");
        footer.innerHTML = `${DAY_ART}${NIGHT_ART}<span class="site-footer__mark">1999</span>`;
        const artwork = {
            day: footer.querySelector(".site-footer__art--day"),
            night: footer.querySelector(".site-footer__art--night"),
        };
        const currentTheme = () => document.body.classList.contains("night") ? "night" : "day";
        const showArtwork = (theme) => {
            // Only the illustration waits for its resource; the global theme,
            // paper surface and caption continue following body.night normally.
            artwork.day.style.opacity = theme === "day" ? "1" : "0";
            artwork.night.style.opacity = theme === "night" ? "1" : "0";
            footer.dataset.artTheme = theme;
        };
        showArtwork(currentTheme());
        card.appendChild(footer);

        const loads = new Map();
        let requestedTheme;
        let generation = 0;
        const loadArtwork = (theme) => {
            if (loads.has(theme)) return loads.get(theme);
            const pending = Promise.all([...artwork[theme].querySelectorAll("image")].map((image) =>
                new Promise((resolve, reject) => {
                    const cleanup = () => {
                        image.removeEventListener("load", loaded);
                        image.removeEventListener("error", failed);
                    };
                    const loaded = () => { cleanup(); resolve(); };
                    const failed = () => {
                        cleanup();
                        image.removeAttribute("href");
                        reject(new Error(`Could not load ${theme} footer artwork`));
                    };
                    image.addEventListener("load", loaded, { once: true });
                    image.addEventListener("error", failed, { once: true });
                    image.setAttribute("href", image.getAttribute("data-src"));
                })
            )).then(() => new Promise(resolve => window.requestAnimationFrame(resolve)));
            loads.set(theme, pending);
            // A later user-initiated theme change may retry a failed resource,
            // but do not schedule retries or change the currently visible art.
            pending.catch(() => loads.delete(theme));
            return pending;
        };
        const syncTheme = () => {
            const theme = currentTheme();
            if (theme === requestedTheme) return;
            requestedTheme = theme;
            const request = ++generation;
            loadArtwork(theme).then(() => {
                if (request !== generation || theme !== currentTheme()) return;
                showArtwork(theme);
                footer.dataset.artReady = "true";
                delete footer.dataset.artError;
            }).catch(error => {
                if (request !== generation) return;
                footer.dataset.artError = theme;
                console.warn("[footer]", error.message);
            });
        };
        const themeObserver = new MutationObserver(syncTheme);
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        syncTheme();

        const alignTexture = () => setTextureAlignment(card, footer);
        alignTexture();
        if ("ResizeObserver" in window) {
            const observer = new ResizeObserver(alignTexture);
            observer.observe(card);
            observer.observe(footer);
        }
        window.addEventListener("resize", alignTexture, { passive: true });
    }

    function bootstrap() {
        document.querySelectorAll(".card").forEach(initializeCard);
    }

    window.init1999SiteFooters = bootstrap;
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();
