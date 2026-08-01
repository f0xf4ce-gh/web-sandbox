const loadCount = Number(sessionStorage.getItem("preview-check-loads") || "0") + 1;
sessionStorage.setItem("preview-check-loads", String(loadCount));
document.body.dataset.loadCount = String(loadCount);
document.querySelector("#version").textContent = "JS version two";
console.log("preview-check", { loadCount });
window.setTimeout(() => console.info("preview-check-ready", { loadCount }), 0);
document.querySelector("#log-button").addEventListener("click", () => console.log("manual preview log", { loadCount }));
