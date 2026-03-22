import { api } from "./api.js";
import { state } from "./state.js";
import { renderApp } from "./components/layout.js";
import { initRouter } from "./router.js";

async function bootstrap() {
  const appRoot = document.getElementById("app");

  state.tree = await api.getTree();
  renderApp(appRoot);
  initRouter(appRoot);
}

bootstrap().catch((error) => {
  const appRoot = document.getElementById("app");
  appRoot.innerHTML = `
    <div class="page">
      <div class="card empty-state">
        <h2>Failed to start the app</h2>
        <p>${error.message}</p>
      </div>
    </div>
  `;
});