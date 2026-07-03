alert("script loaded");

const hour = new Date().getHours();

alert("hour = " + hour);

alert(sub);

const sub = document.querySelector(".sub");

if (!sub) {
    // .sub がなければ何もしない
} else if (window.location.pathname.endsWith("index.html") || window.location.pathname.endsWith("/1999/")) {

    if (hour >= 6 && hour < 12) {
        sub.textContent = "Good morning.";
    } else if (hour >= 12 && hour < 18) {
        sub.textContent = "Welcome.";
    } else if (hour >= 18 && hour < 20) {
        sub.textContent = "Take a break.";
    } else {
        sub.textContent = "Good evening.";
    }

}
