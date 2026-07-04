const sub = document.querySelector(".sub");

if (sub) {
  const hour = new Date().getHours();

  if (hour >= 6 && hour < 10) {
    sub.textContent = "Good morning.";
  } else if (hour >= 10 && hour < 15) {
    sub.textContent = "Welcome.";
  } else if (hour >= 15 && hour < 17) {
    sub.textContent = "Take a break.";
  } else {
    sub.textContent = "Good evening.";
  }
}
