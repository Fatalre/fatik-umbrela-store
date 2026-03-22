import { api } from "../api.js";
import { state } from "../state.js";
import { renderSidebarTree } from "./sidebar-tree.js";
import { renderBreadcrumb } from "./breadcrumb.js";
import { renderEmptyState } from "./empty-state.js";
import { formatBytes, formatDuration, formatResolution, escapeHtml } from "../utils.js";

function folderCard(folder) {
    return `
    <a class="folder-card" href="#/folder/${encodeURIComponent(folder.relativePath)}">
      <h3 class="folder-title">${escapeHtml(folder.name)}</h3>
      <div class="folder-meta">${folder.videoCount} video(s)</div>
    </a>
  `;
}

function videoCard(video) {
    const metadata = video.metadata || {};
    const watched = video.state?.watched === true;

    return `
    <a class="media-card" href="#/watch/${encodeURIComponent(video.id)}">
      <img
        class="poster"
        src="/api/poster/${encodeURIComponent(video.id)}"
        alt="${escapeHtml(video.title)}"
        loading="lazy"
        onerror="this.onerror=null;this.src='/assets/placeholder-poster.svg';"
      />
      <div class="media-body">
        ${watched ? `<div class="status-badge" style="margin-bottom:8px;">Watched</div>` : ""}
        <h3 class="media-title">${escapeHtml(video.title)}</h3>
        <div class="media-meta">${escapeHtml(video.kind || "video")}</div>
        <div class="media-meta">${formatDuration(metadata.durationSeconds || 0)}</div>
        <div class="media-meta">${formatResolution(metadata.resolution)}</div>
        <div class="media-meta">${formatBytes(video.sizeBytes || 0)}</div>
      </div>
    </a>
  `;
}

function renderSearchResults(videos) {
    return `
    ${renderBreadcrumb("")}
    <section>
      <h2 class="section-title">Search results</h2>
      ${videos.length
        ? `<div class="media-grid">${videos.map(videoCard).join("")}</div>`
        : renderEmptyState("Nothing found", "No videos match your search.")}
    </section>
  `;
}

export async function renderFolderPage(appRoot, folderPath = "") {
    state.currentFolderPath = folderPath;

    const pageRoot = document.getElementById("page-root");
    const sidebarRoot = document.getElementById("sidebar-root");

    renderSidebarTree(sidebarRoot);

    pageRoot.innerHTML = `<div class="card empty-state">Loading folder...</div>`;

    try {
        if (state.searchQuery) {
            pageRoot.innerHTML = renderSearchResults(state.searchResults || []);
            return;
        }

        const data = await api.getFolder(folderPath);

        const folders = Array.isArray(data.folders) ? data.folders : [];
        const videos = Array.isArray(data.videos) ? data.videos : [];
        const hasContent = folders.length > 0 || videos.length > 0;

        pageRoot.innerHTML = `
      ${renderBreadcrumb(folderPath)}

      ${!hasContent ? renderEmptyState("Nothing here", "This folder is empty.") : ""}

      ${folders.length ? `
        <section>
          <h2 class="section-title">Folders</h2>
          <div class="folder-grid">
            ${folders.map(folderCard).join("")}
          </div>
        </section>
      ` : ""}

      ${videos.length ? `
        <section style="margin-top: 24px;">
          <h2 class="section-title">Videos</h2>
          <div class="media-grid">
            ${videos.map(videoCard).join("")}
          </div>
        </section>
      ` : ""}
    `;
    } catch (error) {
        pageRoot.innerHTML = renderEmptyState("Failed to load folder", error.message);
    }
}