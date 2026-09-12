(function () {
    'use strict';

    var listEl = document.getElementById('diary-list');
    var paginationEl = document.getElementById('diary-pagination');
    var allPosts = [];
    var currentPage = 1;
    var PAGE_SIZE = 10;

    // YYYY-MM-DD → YYYY.MM.DD (validates format; returns '' if unexpected)
    function fmtDate(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
        return iso.replace(/-/g, '.');
    }

    function renderPagination(pageCount) {
        paginationEl.innerHTML = '';
        paginationEl.hidden = pageCount <= 1;
        if (pageCount <= 1) return;

        for (var page = 1; page <= pageCount; page++) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'public-pagination-button';
            button.textContent = String(page);
            button.setAttribute('aria-label', page + 'ページ目');
            if (page === currentPage) {
                button.classList.add('is-current');
                button.setAttribute('aria-current', 'page');
            }
            button.addEventListener('click', (function (nextPage) {
                return function () {
                    currentPage = nextPage;
                    render();
                };
            }(page)));
            paginationEl.appendChild(button);
        }

        if (currentPage < pageCount) {
            var next = document.createElement('button');
            next.type = 'button';
            next.className = 'public-pagination-button public-pagination-next';
            next.textContent = '→';
            next.setAttribute('aria-label', '次のページ');
            next.addEventListener('click', function () {
                currentPage++;
                render();
            });
            paginationEl.appendChild(next);
        }
    }

    function render() {
        var pageCount = Math.max(1, Math.ceil(allPosts.length / PAGE_SIZE));
        currentPage = Math.min(currentPage, pageCount);
        var start = (currentPage - 1) * PAGE_SIZE;
        var posts = allPosts.slice(start, start + PAGE_SIZE);

        listEl.innerHTML = '';
        if (!posts || !posts.length) {
            var empty = document.createElement('div');
            empty.className = 'diary-entry';
            var ep = document.createElement('p');
            ep.style.cssText = 'color:var(--text-muted);font-size:14px;';
            ep.textContent = 'まだ投稿がありません。';
            empty.appendChild(ep);
            listEl.appendChild(empty);
            renderPagination(pageCount);
            return;
        }
        posts.forEach(function (p, i) {
            var entry = document.createElement('div');
            entry.className = 'diary-entry';

            // date
            var dateEl = document.createElement('div');
            dateEl.className = 'diary-date';
            dateEl.textContent = fmtDate(p.date);
            entry.appendChild(dateEl);

            // title (optional)
            if (p.title) {
                var titleEl = document.createElement('div');
                titleEl.className = 'diary-entry-title';
                titleEl.textContent = p.title;
                entry.appendChild(titleEl);
            }

            // body — safe multi-line render via text nodes + <br>
            var bodyEl = document.createElement('p');
            var lines = String(p.body || '').split('\n');
            lines.forEach(function (line, li) {
                bodyEl.appendChild(document.createTextNode(line));
                if (li < lines.length - 1) {
                    bodyEl.appendChild(document.createElement('br'));
                }
            });
            entry.appendChild(bodyEl);

            listEl.appendChild(entry);

            if (i < posts.length - 1) {
                var divider = document.createElement('div');
                divider.className = 'diary-divider';
                listEl.appendChild(divider);
            }
        });
        renderPagination(pageCount);
    }

    // credentials:'omit' ensures admin cookies are never sent from the public
    // diary page, so the API always returns only published entries here.
    fetch('/api/diary', { credentials: 'omit' })
        .then(function (r) { return r.json(); })
        .then(function (posts) {
            allPosts = Array.isArray(posts) ? posts.slice() : [];
            allPosts.sort(function (a, b) {
                var byDate = String(b.date || '').localeCompare(String(a.date || ''));
                if (byDate !== 0) return byDate;
                return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
            });
            render();
        })
        .catch(function () {
            listEl.innerHTML =
                '<div class="diary-entry"><p style="color:var(--text-muted);font-size:14px;">読み込みに失敗しました。</p></div>';
        });
}());
