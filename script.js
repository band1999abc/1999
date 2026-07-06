// Time-based greeting and night mode
// Night: 19:00 – 06:59  |  Day: 07:00 – 18:59
// Debug: append ?night=1 to any page URL to force night mode

(function () {
    const hour = new Date().getHours();

    // ?night=1 forces night mode regardless of time (dev/preview only)
    const debugNight = new URLSearchParams(window.location.search).get('night');
    const isNight = true; // TODO: revert → debugNight === '1' || hour >= 19 || hour < 7

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
}());
