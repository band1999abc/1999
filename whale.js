// Keep the whale image visually fixed within the card as the page scrolls
(function () {
    const card  = document.querySelector('.card');
    const whale = document.querySelector('.whale-bg');
    if (!card || !whale) return;

    function positionWhale() {
        const cardTop = card.getBoundingClientRect().top;
        whale.style.top = Math.max(0, -cardTop) + 'px';
    }

    window.addEventListener('scroll', positionWhale, { passive: true });
    positionWhale();
}());
