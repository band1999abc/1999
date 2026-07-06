/**
 * live.js — public Live Information page
 */
(function () {
    'use strict';

    const listEl = document.getElementById('live-list');
    if (!listEl) return;

    // ── Flyer helpers ─────────────────────────────────────────────────────────

    /**
     * Normalise live.flyer → string[]
     *   false / null / undefined → []
     *   true                     → ['0']  (legacy single-image)
     *   string[]                 → as-is
     */
    function getFlyerSlots(live) {
        const f = live.flyer;
        if (!f) return [];
        if (f === true) return ['0'];
        if (Array.isArray(f)) return f;
        return [];
    }

    function flyerUrl(liveId, slotId) {
        return '/api/flyer/' + liveId + '?s=' + encodeURIComponent(slotId);
    }

    // ── Flyer modal ───────────────────────────────────────────────────────────
    let modal    = null;
    let modalImg = null;
    let closeBtn = null;
    let prevBtn  = null;
    let nextBtn  = null;

    let currentUrls = [];
    let currentIdx  = 0;

    function buildModal() {
        modal = document.createElement('div');
        modal.className = 'live-flyer-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'フライヤー拡大表示');

        // Close button
        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'live-flyer-modal-close';
        closeBtn.setAttribute('aria-label', '閉じる');
        closeBtn.innerHTML = '&#215;';
        closeBtn.addEventListener('click', closeModal);
        modal.appendChild(closeBtn);

        // Prev button
        prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'live-flyer-modal-nav live-flyer-modal-prev';
        prevBtn.setAttribute('aria-label', '前の画像');
        prevBtn.innerHTML = '&#8249;';
        prevBtn.addEventListener('click', function () { navigate(-1); });
        modal.appendChild(prevBtn);

        // Main image
        modalImg = document.createElement('img');
        modalImg.className = 'live-flyer-modal-img';
        modalImg.alt = 'フライヤー';
        modal.appendChild(modalImg);

        // Next button
        nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'live-flyer-modal-nav live-flyer-modal-next';
        nextBtn.setAttribute('aria-label', '次の画像');
        nextBtn.innerHTML = '&#8250;';
        nextBtn.addEventListener('click', function () { navigate(1); });
        modal.appendChild(nextBtn);

        // Close on backdrop click
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeModal();
        });

        // Keyboard navigation
        document.addEventListener('keydown', function (e) {
            if (!modal || !modal.classList.contains('is-open')) return;
            if (e.key === 'Escape')      closeModal();
            if (e.key === 'ArrowLeft')   navigate(-1);
            if (e.key === 'ArrowRight')  navigate(1);
        });

        document.body.appendChild(modal);
    }

    function syncModal() {
        modalImg.src = currentUrls[currentIdx];
        const multi = currentUrls.length > 1;
        prevBtn.style.visibility = (multi && currentIdx > 0) ? 'visible' : 'hidden';
        nextBtn.style.visibility = (multi && currentIdx < currentUrls.length - 1) ? 'visible' : 'hidden';
    }

    function navigate(dir) {
        const next = currentIdx + dir;
        if (next < 0 || next >= currentUrls.length) return;
        currentIdx = next;
        syncModal();
    }

    function openModal(urls, idx) {
        if (!modal) buildModal();
        currentUrls = urls;
        currentIdx  = idx;
        syncModal();
        modal.classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('is-open');
        document.body.style.overflow = '';
        setTimeout(function () {
            modalImg.src = '';
            currentUrls  = [];
        }, 300);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function todayIso() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function fmtDate(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
        const [y, m, d] = iso.split('-');
        return `${y}.${m}.${d}`;
    }

    // ── Build flyer element(s) ────────────────────────────────────────────────
    function buildFlyerElement(live) {
        const slots = getFlyerSlots(live);
        if (slots.length === 0) return null;

        const urls = slots.map(function (s) { return flyerUrl(live.id, s); });

        if (slots.length === 1) {
            // Single image — full-width, same as original
            const img = document.createElement('img');
            img.className = 'live-flyer-img';
            img.alt = 'フライヤー';
            img.src = urls[0];
            img.title = 'クリックで拡大';
            img.addEventListener('click', function () { openModal(urls, 0); });
            return img;
        }

        // Multiple images — thumbnail grid
        const gallery = document.createElement('div');
        gallery.className = 'live-flyer-gallery';
        slots.forEach(function (_, i) {
            const img = document.createElement('img');
            img.className = 'live-flyer-gallery-img';
            img.alt = 'フライヤー ' + (i + 1);
            img.src = urls[i];
            img.title = 'クリックで拡大';
            img.addEventListener('click', (function (idx) {
                return function () { openModal(urls, idx); };
            }(i)));
            gallery.appendChild(img);
        });
        return gallery;
    }

    // ── Attach flyer click behaviour to an entry element ─────────────────────
    function attachFlyerClick(el, live) {
        const slots = getFlyerSlots(live);
        if (slots.length === 0) return;
        const urls = slots.map(function (s) { return flyerUrl(live.id, s); });
        el.classList.add('has-flyer');
        el.addEventListener('click', function () { openModal(urls, 0); });

        const ind = document.createElement('div');
        ind.className = 'live-flyer-indicator';
        ind.textContent = 'FLYER';
        el.appendChild(ind);
    }

    // ── Render upcoming entry ─────────────────────────────────────────────────
    function renderEntry(live, badge) {
        const el = document.createElement('div');
        el.className = 'live-entry' + (badge ? ' live-entry-next' : '');

        if (badge) {
            const b = document.createElement('span');
            b.className = 'live-next-badge';
            b.textContent = 'NEXT LIVE';
            el.appendChild(b);
        }

        const dateEl = document.createElement('div');
        dateEl.className = 'live-date';
        dateEl.textContent = fmtDate(live.date);
        el.appendChild(dateEl);

        const venueEl = document.createElement('div');
        venueEl.className = 'live-venue';
        venueEl.textContent = live.venue || '';
        el.appendChild(venueEl);

        const hasTimes = live.open || live.start;
        const hasTicket = live.ticket;

        if (hasTimes || hasTicket) {
            const meta = document.createElement('div');
            meta.className = 'live-meta';
            if (hasTimes) {
                const s = document.createElement('span');
                s.textContent = 'OPEN ' + (live.open || '—') + ' / START ' + (live.start || '—');
                meta.appendChild(s);
            }
            if (hasTicket) {
                const s = document.createElement('span');
                s.textContent = live.ticket;
                meta.appendChild(s);
            }
            el.appendChild(meta);
        }

        attachFlyerClick(el, live);
        return el;
    }

    // ── Render past entry ─────────────────────────────────────────────────────
    function renderPastEntry(live) {
        const el = document.createElement('div');
        el.className = 'live-entry live-entry-past';

        const dateEl = document.createElement('div');
        dateEl.className = 'live-date';
        dateEl.textContent = fmtDate(live.date);
        el.appendChild(dateEl);

        const venueEl = document.createElement('div');
        venueEl.className = 'live-venue live-venue-past';
        venueEl.textContent = live.venue || '';
        el.appendChild(venueEl);

        if (live.open || live.start) {
            const meta = document.createElement('div');
            meta.className = 'live-meta live-meta-past';
            const s = document.createElement('span');
            s.textContent = 'OPEN ' + (live.open || '—') + ' / START ' + (live.start || '—');
            meta.appendChild(s);
            el.appendChild(meta);
        }

        attachFlyerClick(el, live);
        return el;
    }

    // ── Load & render ─────────────────────────────────────────────────────────
    async function load() {
        try {
            const res = await fetch('/api/live');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const all = await res.json();

            const today = todayIso();

            const upcoming = all
                .filter(l => l.date >= today)
                .sort((a, b) => {
                    const so = (a.sort_order != null ? a.sort_order : 9999) -
                               (b.sort_order != null ? b.sort_order : 9999);
                    return so !== 0 ? so : a.date.localeCompare(b.date);
                });

            const past = all
                .filter(l => l.date < today)
                .sort((a, b) => b.date.localeCompare(a.date));

            listEl.innerHTML = '';

            if (upcoming.length === 0) {
                const p = document.createElement('p');
                p.className = 'live-empty';
                p.textContent = 'No live scheduled.';
                listEl.appendChild(p);
            } else {
                listEl.appendChild(renderEntry(upcoming[0], true));
                for (let i = 1; i < upcoming.length; i++) {
                    const div = document.createElement('div');
                    div.className = 'live-divider';
                    listEl.appendChild(div);
                    listEl.appendChild(renderEntry(upcoming[i], false));
                }
            }

            if (past.length > 0) {
                const label = document.createElement('div');
                label.className = 'live-archive-label';
                label.textContent = 'Archive';
                listEl.appendChild(label);
                past.forEach(l => listEl.appendChild(renderPastEntry(l)));
            }

        } catch (e) {
            console.error('[live]', e);
            listEl.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'live-empty';
            p.textContent = '読み込みに失敗しました。';
            listEl.appendChild(p);
        }
    }

    load();
}());
