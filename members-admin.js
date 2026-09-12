(function () {
    'use strict';
    if (document.body.dataset.page !== 'afterhours-members') return;

    var fileEl = document.getElementById('mphoto-file');
    var selectBtn = document.getElementById('mphoto-select');
    var deleteBtn = document.getElementById('mphoto-delete');
    var saveBtn = document.getElementById('mphoto-save');
    var previewWrap = document.getElementById('mphoto-preview-wrap');
    var preview = document.getElementById('mphoto-preview');
    var empty = document.getElementById('mphoto-empty');
    var status = document.getElementById('mphoto-status');
    var pendingDataUrl = null;
    var pendingDelete = false;
    var hasSavedPhoto = false;
    var processing = false;

    function authFetch(url, options) {
        return window._adminAuthFetch(url, options);
    }

    function showPhoto(src) {
        if (src && preview.src !== src) preview.src = src;
        previewWrap.classList.remove('mphoto-hidden');
        empty.classList.add('mphoto-hidden');
        deleteBtn.classList.remove('mphoto-hidden');
    }

    function showEmpty() {
        preview.removeAttribute('src');
        previewWrap.classList.add('mphoto-hidden');
        empty.classList.remove('mphoto-hidden');
        deleteBtn.classList.add('mphoto-hidden');
    }

    function updateSave() {
        saveBtn.disabled = processing || (!pendingDataUrl && !pendingDelete);
        selectBtn.disabled = processing;
    }

    function loadImage(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () { resolve(img); };
                img.onerror = function () { reject(new Error('画像を読み込めませんでした。')); };
                img.src = reader.result;
            };
            reader.onerror = function () { reject(new Error('画像ファイルを読み込めませんでした。')); };
            reader.readAsDataURL(file);
        });
    }

    function processImage(file) {
        if (!file.type || !file.type.startsWith('image/')) {
            return Promise.reject(new Error('画像ファイルを選択してください。'));
        }
        return loadImage(file).then(function (img) {
            var sw = img.naturalWidth || img.width;
            var sh = img.naturalHeight || img.height;
            var scale = Math.min(1, 1600 / Math.max(sw, sh));
            var width = Math.max(1, Math.round(sw * scale));
            var height = Math.max(1, Math.round(sh * scale));
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var qualities = [0.88, 0.80, 0.72, 0.64, 0.56, 0.48];
            if (!ctx) throw new Error('このブラウザでは画像を処理できません。');
            for (var attempt = 0; attempt < 5; attempt++) {
                canvas.width = width;
                canvas.height = height;
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                for (var i = 0; i < qualities.length; i++) {
                    var result = canvas.toDataURL('image/jpeg', qualities[i]);
                    if (result.length <= 2 * 1024 * 1024) return result;
                }
                width = Math.max(1, Math.round(width * 0.8));
                height = Math.max(1, Math.round(height * 0.8));
            }
            throw new Error('画像を2MB以下に圧縮できませんでした。');
        });
    }

    function loadCurrent() {
        preview.onload = function () {
            hasSavedPhoto = true;
            showPhoto(preview.src);
        };
        preview.onerror = function () {
            hasSavedPhoto = false;
            showEmpty();
        };
        preview.src = '/api/member-photo/main?t=' + Date.now();
    }

    selectBtn.addEventListener('click', function () { fileEl.click(); });
    fileEl.addEventListener('change', function () {
        var file = fileEl.files && fileEl.files[0];
        if (!file) return;
        processing = true;
        status.textContent = '画像処理中…';
        updateSave();
        processImage(file).then(function (dataUrl) {
            pendingDataUrl = dataUrl;
            pendingDelete = false;
            showPhoto(dataUrl);
            status.textContent = '保存すると公開ページへ反映されます。';
        }).catch(function (error) {
            status.textContent = error.message;
        }).finally(function () {
            processing = false;
            fileEl.value = '';
            updateSave();
        });
    });

    deleteBtn.addEventListener('click', function () {
        pendingDataUrl = null;
        pendingDelete = hasSavedPhoto;
        showEmpty();
        status.textContent = hasSavedPhoto ? '保存すると画像を削除します。' : '';
        updateSave();
    });

    saveBtn.addEventListener('click', function () {
        saveBtn.disabled = true;
        status.textContent = '保存中…';
        var request = pendingDelete
            ? authFetch('/api/member-photo/main', { method: 'DELETE' })
            : authFetch('/api/member-photo/main', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: pendingDataUrl }),
            });
        request.then(function (response) {
            if (!response.ok) return response.json().then(function (b) {
                throw new Error(b.error || '保存できませんでした。');
            });
            pendingDataUrl = null;
            pendingDelete = false;
            hasSavedPhoto = !previewWrap.classList.contains('mphoto-hidden');
            status.textContent = '保存しました。';
            if (hasSavedPhoto) loadCurrent();
        }).catch(function (error) {
            status.textContent = error.message;
        }).finally(updateSave);
    });

    loadCurrent();
}());