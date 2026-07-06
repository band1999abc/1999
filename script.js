// Time-based greeting and night mode
// Night: 19:00 – 06:59  |  Day: 07:00 – 18:59
// Debug: append ?night=1 to any page URL to force night mode

(function () {
    const hour = new Date().getHours();

    // ?night=1 forces night mode regardless of time (dev/preview only)
    const debugNight = new URLSearchParams(window.location.search).get('night');
    const isNight = debugNight === '1' || hour >= 19 || hour < 7;

    if (isNight) {
        document.body.classList.add('night');
    }

    // Time-based greeting (index.html only)
    const greeting = document.getElementById("greeting");
    if (greeting) {
        if (hour >= 6 && hour < 10) {
            greeting.textContent = "Good morning.";
        } else if (hour >= 10 && hour < 15) {
            greeting.textContent = "Welcome.";
        } else if (hour >= 15 && hour < 17) {
            greeting.textContent = "Take a break.";
        } else {
            greeting.textContent = "Good evening.";
        }
    }
    // ── Hidden admin entry: 5 clicks on h1 within 3 seconds ──
    // Regular visitors never see a button or hint — just works silently.
    const h1 = document.querySelector('h1');
    if (h1) {
        let _n = 0, _t = null;
        h1.addEventListener('click', function () {
            _n++;
            clearTimeout(_t);
            _t = setTimeout(function () { _n = 0; }, 3000);
            if (_n >= 5) {
                _n = 0;
                clearTimeout(_t);
                window.location.href = '/afterhours';
            }
        });
    }
}());
