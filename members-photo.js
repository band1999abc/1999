(function () {
    'use strict';
    var wrap = document.getElementById('members-main-photo-wrap');
    var img = document.getElementById('members-main-photo');
    if (!wrap || !img) return;
    img.onload = function () { wrap.hidden = false; };
    img.onerror = function () {
        wrap.hidden = true;
        img.removeAttribute('src');
    };
    img.src = '/api/member-photo/main';
}());