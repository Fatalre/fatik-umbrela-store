import { api } from "../api.js";
import { state } from "../state.js";

export function renderTopbar(root) {
    root.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <img src="/assets/logo.svg" alt="Logo" />
        <span>Fatik Video Library</span>
      </div>

      <input
        id="search-input"
        class="search-input"
        type="text"
        placeholder="Search videos..."
        value="${state.searchQuery || ""}"
      />

      <button id="rescan-button" class="secondary-button" type="button">
        Rescan
      </button>
    </div>
  `;

    const searchInput = document.getElementById("search-input");
    const rescanButton = document.getElementById("rescan-button");

    searchInput?.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") return;

        const value = event.target.value.trim();
        state.searchQuery = value;

        if (!value) {
            state.searchResults = [];
            window.dispatchEvent(new Event("hashchange"));
            return;
        }

        try {
            state.searchResults = await api.search(value);
            window.location.hash = "#/folder/";
            window.dispatchEvent(new Event("hashchange"));
        } catch (error) {
            alert(error.message);
        }
    });

    rescanButton?.addEventListener("click", async () => {
        rescanButton.disabled = true;
        rescanButton.textContent = "Rescanning...";

        try {
            const result = await api.rescan();
            state.tree = result.tree;
            state.searchResults = [];
            window.dispatchEvent(new Event("hashchange"));
        } catch (error) {
            alert(error.message);
        } finally {
            rescanButton.disabled = false;
            rescanButton.textContent = "Rescan";
        }
    });
}