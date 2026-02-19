(() => {
  const frame = document.getElementById("viewFrame");
  const openLink = document.getElementById("openCurrent");
  const buttons = [...document.querySelectorAll("button[data-view]")];
  if (!frame || buttons.length === 0) return;

  const KEY = "task_view_selected";
  const allowed = new Set(["list", "kanban", "process"]);
  const initial = localStorage.getItem(KEY);
  let current = allowed.has(initial) ? initial : "list";

  function setActive(view) {
    current = view;
    const src = `./${view}.html`;
    frame.src = src;
    if (openLink) openLink.href = src;
    localStorage.setItem(KEY, view);
    buttons.forEach((btn) => {
      if (btn.dataset.view === view) btn.classList.add("active");
      else btn.classList.remove("active");
    });
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (!view || !allowed.has(view)) return;
      setActive(view);
    });
  });

  setActive(current);
})();
