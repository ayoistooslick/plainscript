let scoreEl = document.querySelector("#score");
let historyEl = document.querySelector("#history");
let clickButton = document.querySelector("#click-button");
let logButton = document.querySelector("#log-button");
let entryCount = 0;
console.log("PlainScript clicker dashboard ready");
clickButton.addEventListener("click", function (event) {
  let current = parseInt(scoreEl.textContent);
  let updated = current + 10;
  scoreEl.innerHTML = String(updated);
  if (updated >= 50) {
    clickButton.classList.add("level-up");
  }
});
logButton.addEventListener("click", function (event) {
  entryCount = entryCount + 1;
  let item = document.createElement("li");
  item.textContent = ((("Entry " + entryCount) + " (score ") + scoreEl.textContent) + ")";
  historyEl.appendChild(item);
});
document.addEventListener("keydown", function (e) {
  if (e.key === "r" || e.key === "R") {
    scoreEl.textContent = "0";
    clickButton.classList.remove("level-up");
    historyEl.innerHTML = "";
  }
});