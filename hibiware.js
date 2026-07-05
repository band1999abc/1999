// Play button interaction for ひび割れ
const button = document.getElementById("playButton");
const status = document.getElementById("status");

if (button && status) {
    button.addEventListener("click", () => {
        status.textContent = "Coming Soon...";
    });
}
