import { escapeHtml } from "../utils.js";

export function renderBreadcrumb(folderPath = "") {
    const parts = folderPath ? folderPath.split("/").filter(Boolean) : [];
    const items = [`<a href="#/folder/">Library</a>`];

    let current = "";

    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        items.push(`<a href="#/folder/${encodeURIComponent(current)}">${escapeHtml(part)}</a>`);
    }

    return `<nav class="breadcrumb">${items.join("<span>/</span>")}</nav>`;
}