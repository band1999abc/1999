// Time-based greeting and night mode
// Night: 18:00 – 05:59  |  Day: 06:00 – 17:59
// Debug: append ?night=1 to any page URL to force night mode

(function () {
    const hour = new Date().getHours();

    // ?night=1 forces night mode regardless of time (dev/preview only)
    const debugNight = new URLSearchParams(window.location.search).get('night');
    const isNight = debugNight === '1' || hour >= 18 || hour < 6;

    if (isNight) {
        document.body.classList.add('night');
    }

    // Time-based greeting (index.html only)
    const greeting = document.getElementById("greeting");
    if (greeting) {
        const greetings = {
            morning: [
                "Good morning.",
                "Rise and shine.",
                "Morning.",
                "A new day.",
                "Still half asleep?",
            ],
            midday: [
                "Welcome.",
                "Hello.",
                "Hey.",
                "What's up.",
                "Good to see you.",
            ],
            afternoon: [
                "Take a break.",
                "Afternoon.",
                "Still here?",
                "How's the day going.",
                "Almost there.",
            ],
            evening: [
                "Good evening.",
                "Evening.",
                "The night is young.",
                "Welcome back.",
                "Night owl.",
            ],
            latenight: [
                "Still up?",
                "Can't sleep?",
                "Late night.",
                "Just you and the dark.",
                "Night shift.",
            ],
            dawn: [
                "Up already?",
                "Almost morning.",
                "The sun's coming.",
                "Early bird.",
                "Dawn breaking.",
            ],
        };

        let pool;
        if (hour >= 6 && hour < 10) {
            pool = greetings.morning;
        } else if (hour >= 10 && hour < 15) {
            pool = greetings.midday;
        } else if (hour >= 15 && hour < 18) {
            pool = greetings.afternoon;
        } else if (hour >= 18 && hour < 23) {
            pool = greetings.evening;
        } else if (hour >= 4) {
            pool = greetings.dawn;
        } else {
            pool = greetings.latenight;
        }

        greeting.textContent = pool[Math.floor(Math.random() * pool.length)];
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
