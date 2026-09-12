/**
 * weather-phrases-admin.js
 * Client-side management for /afterhours/weather-phrases.
 */
(function () {
    'use strict';

    if (document.body.dataset.page !== 'afterhours-weather-phrases') return;

    var categories = [
        { id: 'sunny',         en: 'Sunny',         ja: '晴れ',           detail: 'Clear / clouds 0–30%' },
        { id: 'partly_cloudy', en: 'Partly Cloudy', ja: '晴れ時々曇り',     detail: 'Clouds 31–60%' },
        { id: 'mostly_cloudy', en: 'Mostly Cloudy', ja: '曇り寄り',         detail: 'Clouds 61–80%' },
        { id: 'cloudy',        en: 'Cloudy',        ja: '曇り',             detail: 'Clouds 81–100%' },
        { id: 'rainy',         en: 'Rainy',         ja: '雨',               detail: 'Rain / drizzle / squall / tornado' },
        { id: 'snowy',         en: 'Snowy',         ja: '雪',               detail: 'Snow' },
        { id: 'foggy',         en: 'Foggy',         ja: '霧・霞',            detail: 'Mist / fog / haze / smoke / dust / sand / ash' }
    ];

    var listEl       = document.getElementById('wp-list');
    var countEl      = document.getElementById('wp-count');
    var editorEl     = document.getElementById('wp-editor');
    var editorHdEl   = document.getElementById('wp-editor-heading');
    var backDashBtn  = document.getElementById('wp-back-dash');
    var editorBack   = document.getElementById('wp-editor-back');
    var addBtn       = document.getElementById('wp-add-btn');
    var formEl       = document.getElementById('wp-form');
    var categoryEl   = document.getElementById('wp-category');
    var textEl       = document.getElementById('wp-text');
    var orderEl      = document.getElementById('wp-sort-order');
    var enabledEl    = document.getElementById('wp-enabled');
    var enabledLabel = document.getElementById('wp-enabled-label');
    var saveBtn      = document.getElementById('wp-save-btn');
    var deleteBtn    = document.getElementById('wp-delete-btn');

    var phrases = [];
    var editingId = null;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function authFetch(url, opts) {
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {});
        var token = sessionStorage.getItem('admin_token') || '';
        if (token) opts.headers.Authorization = 'Bearer ' + token;
        return fetch(url, opts).then(function (response) {
            if (response.status === 401) window.location.replace('/afterhours/login');
            return response;
        });
    }

    function jsonOrError(response) {
        return response.json().then(function (data) {
            if (!response.ok) return Promise.reject(data);
            return data;
        });
    }

    function renderList() {
        var enabledCount = phrases.filter(function (phrase) { return phrase.enabled !== false; }).length;
        countEl.textContent = phrases.length + '件（有効 ' + enabledCount + '件）';

        listEl.innerHTML = categories.map(function (category) {
            var items = phrases.filter(function (phrase) { return phrase.category === category.id; });
            items.sort(function (a, b) {
                return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
                    String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
            });
            return '<section class="wp-category" data-category="' + category.id + '">' +
                '<div class="wp-category-header">' +
                  '<div><h2>' + esc(category.en) + ' <span>' + esc(category.ja) + '</span></h2>' +
                  '<code>' + esc(category.id) + '</code></div>' +
                  '<small>' + esc(category.detail) + ' · ' + items.length + '件</small>' +
                '</div>' +
                (items.length ? items.map(renderItem).join('') :
                    '<p class="wp-category-empty">このカテゴリにフレーズはありません。</p>') +
            '</section>';
        }).join('');
    }

    function renderItem(phrase) {
        var off = phrase.enabled === false ? ' wp-item--disabled' : '';
        var status = phrase.enabled === false ? '無効' : '有効';
        return '<article class="wp-item' + off + '" data-id="' + esc(phrase.id) + '">' +
            '<div class="wp-item-main"><div class="wp-item-text">' + esc(phrase.text) + '</div>' +
            '<div class="wp-item-meta"><span>sort_order ' + esc(phrase.sort_order) + '</span>' +
            '<span class="wp-status">' + status + '</span></div></div>' +
            '<div class="wp-item-actions">' +
              '<button type="button" class="wp-action-btn" data-action="edit" data-id="' + esc(phrase.id) + '">編集</button>' +
              '<button type="button" class="wp-action-btn wp-action-danger" data-action="delete" data-id="' + esc(phrase.id) + '">削除</button>' +
            '</div></article>';
    }

    function loadPhrases() {
        authFetch('/api/weather-phrases')
            .then(jsonOrError)
            .then(function (data) {
                phrases = Array.isArray(data) ? data : [];
                renderList();
            })
            .catch(function (error) {
                listEl.innerHTML = '<p class="wp-empty wp-error">' +
                    esc(error && error.error ? error.error : '読み込みに失敗しました。') + '</p>';
            });
    }

    function openEditor(phrase) {
        editingId = phrase ? phrase.id : null;
        editorHdEl.textContent = phrase ? 'フレーズを編集' : '新しいフレーズ';
        categoryEl.value = phrase ? phrase.category : 'sunny';
        textEl.value = phrase ? phrase.text : '';
        if (phrase) {
            orderEl.value = String(phrase.sort_order);
        } else {
            var categoryItems = phrases.filter(function (item) {
                return item.category === categoryEl.value;
            });
            var nextOrder = categoryItems.reduce(function (max, item) {
                return Math.max(max, Number(item.sort_order) || 0);
            }, -1) + 1;
            orderEl.value = String(nextOrder);
        }
        enabledEl.checked = !phrase || phrase.enabled !== false;
        deleteBtn.classList.toggle('da-hidden', !phrase);
        updateEnabledLabel();
        editorEl.classList.remove('da-hidden');
        listEl.classList.add('da-hidden');
        addBtn.classList.add('da-hidden');
        textEl.focus();
    }

    function closeEditor() {
        editorEl.classList.add('da-hidden');
        listEl.classList.remove('da-hidden');
        addBtn.classList.remove('da-hidden');
        editingId = null;
    }

    function updateEnabledLabel() {
        enabledLabel.textContent = enabledEl.checked ? '有効' : '無効';
    }

    function savePhrase(event) {
        event.preventDefault();
        var text = textEl.value.trim();
        var sortOrder = Number(orderEl.value);
        if (!text) {
            textEl.focus();
            return;
        }
        if (!Number.isInteger(sortOrder)) {
            orderEl.focus();
            return;
        }

        var payload = {
            category: categoryEl.value,
            text: text,
            enabled: enabledEl.checked,
            sort_order: sortOrder
        };
        var url = editingId ? '/api/weather-phrases/' + encodeURIComponent(editingId) : '/api/weather-phrases';
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';
        authFetch(url, {
            method: editingId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(jsonOrError).then(function (saved) {
            var index = phrases.findIndex(function (phrase) { return phrase.id === saved.id; });
            if (index >= 0) phrases[index] = saved; else phrases.push(saved);
            renderList();
            closeEditor();
        }).catch(function (error) {
            alert(error && error.error ? error.error : '保存に失敗しました。');
        }).finally(function () {
            saveBtn.disabled = false;
            saveBtn.textContent = '保存';
        });
    }

    function deletePhrase(id) {
        var phrase = phrases.find(function (item) { return item.id === id; });
        if (!phrase || !confirm('「' + phrase.text + '」を削除しますか？')) return;
        authFetch('/api/weather-phrases/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(jsonOrError)
            .then(function () {
                phrases = phrases.filter(function (item) { return item.id !== id; });
                renderList();
                if (editingId === id) closeEditor();
            })
            .catch(function (error) {
                alert(error && error.error ? error.error : '削除に失敗しました。');
            });
    }

    backDashBtn.addEventListener('click', function () { window.location.href = '/afterhours'; });
    addBtn.addEventListener('click', function () { openEditor(null); });
    editorBack.addEventListener('click', closeEditor);
    enabledEl.addEventListener('change', updateEnabledLabel);
    formEl.addEventListener('submit', savePhrase);
    deleteBtn.addEventListener('click', function () { if (editingId) deletePhrase(editingId); });
    listEl.addEventListener('click', function (event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var phrase = phrases.find(function (item) { return item.id === button.dataset.id; });
        if (!phrase) return;
        if (button.dataset.action === 'edit') openEditor(phrase);
        if (button.dataset.action === 'delete') deletePhrase(phrase.id);
    });

    loadPhrases();
})();