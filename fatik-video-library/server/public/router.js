import { renderFolderPage } from "./components/media-grid.js";
import { renderPlayerPage } from "./components/player-view.js";

export function initRouter(appRoot) {
    function handleRoute() {
        const hash = window.location.hash || "#/folder/";

        if (hash.startsWith("#/watch/")) {
            const itemId = decodeURIComponent(hash.replace("#/watch/", ""));
            renderPlayerPage(appRoot, itemId);
            return;
        }

        if (hash.startsWith("#/folder/")) {
            const folderPath = decodeURIComponent(hash.replace("#/folder/", ""));
            renderFolderPage(appRoot, folderPath);
            return;
        }

        window.location.hash = "#/folder/";
    }

    window.addEventListener("hashchange", handleRoute);
    handleRoute();
}