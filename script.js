// Time-based greeting shown on the home page
const greeting = document.getElementById("greeting");

if (greeting) {
    const hour = new Date().getHours();

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
