const hour = new Date().getHours();

const sub = document.querySelector(".sub");

if (!sub) {
  return;
}

if (hour >= 6 && hour < 12) {
  sub.textContent = "Good morning.";
} else if (hour >= 12 && hour < 18) {
  sub.textContent = "Welcome.";
} else if (hour >= 18 && hour < 20) {
  sub.textContent = "Take a break.";
} else {
  sub.textContent = "Good evening.";
}
