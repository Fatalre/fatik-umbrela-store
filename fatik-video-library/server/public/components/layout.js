import { renderSidebarTree } from "./sidebar-tree.js";
import { renderTopbar } from "./topbar.js";

export function renderApp(appRoot) {
    appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div id="sidebar-root"></div>
      </aside>
      <main class="main">
        <div id="topbar-root"></div>
        <div id="page-root" class="page"></div>
      </main>
    </div>
  `;

    renderSidebarTree(document.getElementById("sidebar-root"));
    renderTopbar(document.getElementById("topbar-root"));
}