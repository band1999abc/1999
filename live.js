/**
 * live.js — public Live Information page
 */
(function () {
    'use strict';

    const listEl = document.getElementById('live-list');
    if (!listEl) return;

    // ── Flyer modal ───────────────────────────────────────────────────────────
    let modal = null;
    let modalImg = null;

    function buildModal() {
        modal = document.createElement('div');
        modal.className = 'live-flyer-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'フライヤー拡大表示');

        modalImg = document.createElement('img');
        modalImg.className = 'live-flyer-modal-img';
        modalImg.alt = 'フライヤー';
        modal.appendChild(modalImg);

        // Close on backdrop click
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeModal();
        });

        // Close on Escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeModal();
        });

        document.body.appendChild(modal);
    }

    function openModal(src) {
        if (!modal) buildModal();
        modalImg.src = src;
        modal.classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('is-open');
        document.body.style.overflow = '';
        setTimeout(function () { modalImg.src = ''; }, 300);
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

    // ── Build flyer image element ─────────────────────────────────────────────
    function buildFlyerImg(liveId) {
        const img = document.createElement('img');
        img.className = 'live-flyer-img';
        img.alt = 'フライヤー';
        img.src = '/api/flyer/' + liveId;
        img.title = 'クリックで拡大';
        img.addEventListener('click', function () {
            openModal('/api/flyer/' + liveId);
        });
        return img;
    }

    // ── Render upcoming entry ─────────────────────────────────────────────────
    function renderEntry(live, badge) {
        const el = document.createElement('div');
        el.className = 'live-entry' + (badge ? ' live-entry-next' : '');

        // Flyer image at top
        if (live.flyer) {
            el.appendChild(buildFlyerImg(live.id));
        }

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

        return el;
    }

    // ── Render past entry ─────────────────────────────────────────────────────
    function renderPastEntry(live) {
        const el = document.createElement('div');
        el.className = 'live-entry live-entry-past';

        // Flyer image for past entries too
        if (live.flyer) {
            el.appendChild(buildFlyerImg(live.id));
        }

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
