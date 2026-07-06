(function () {
    'use strict';

    var listEl = document.getElementById('diary-list');

    // YYYY-MM-DD → YYYY.MM.DD (validates format; returns '' if unexpected)
    function fmtDate(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
        return iso.replace(/-/g, '.');
    }

    function render(posts) {
        listEl.innerHTML = '';
        if (!posts || !posts.length) {
            var empty = document.createElement('div');
            empty.className = 'diary-entry';
            var ep = document.createElement('p');
            ep.style.cssText = 'color:var(--text-muted);font-size:14px;';
            ep.textContent = 'まだ投稿がありません。';
            empty.appendChild(ep);
            listEl.appendChild(empty);
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
    }

    fetch('/api/diary')
        .then(function (r) { return r.json(); })
        .then(render)
        .catch(function () {
            listEl.innerHTML =
                '<div class="diary-entry"><p style="color:var(--text-muted);font-size:14px;">読み込みに失敗しました。</p></div>';
        });
}());
