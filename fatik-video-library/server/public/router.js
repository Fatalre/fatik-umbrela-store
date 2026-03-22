import { renderFolderPage } from "./components/media-grid.js";
import { renderPlayerPage } from "./components/player-view.js";

export function initRouter(appRoot) {
    function handleRoute() {
        const hash = window.location.hash || "#/folder/";

        if (hash.startsWith("#/watch-by-path/")) {
            const relativePath = decodeURIComponent(hash.replace("#/watch-by-path/", ""));
            renderPlayerPage(appRoot, relativePath);
            return;
        }

        if (hash.startsWith("#/watch/")) {
            const legacyValue = decodeURIComponent(hash.replace("#/watch/", ""));
            renderPlayerPage(appRoot, legacyValue);
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