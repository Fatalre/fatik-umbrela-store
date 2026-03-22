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

function getProgressPercent(video) {
    const position = Number(video.state?.progress?.position || 0);
    const duration = Number(video.state?.progress?.duration || 0);

    if (!duration || duration <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((position / duration) * 100)));
}

function videoCard(video) {
    const metadata = video.metadata || {};
    const watched = video.state?.watched === true;
    const progressPercent = getProgressPercent(video);

    return `
    <a class="media-card" href="#/watch/${encodeURIComponent(video.id)}">
      <div style="position:relative;">
        <img
          class="poster"
          src="/api/poster/${encodeURIComponent(video.id)}"
          alt="${escapeHtml(video.title)}"
          loading="lazy"
          onerror="this.onerror=null;this.src='/assets/placeholder-poster.svg';"
        />
        ${progressPercent > 0 && progressPercent < 100 ? `
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${progressPercent}%"></div>
          </div>
        ` : ""}
      </div>

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

function renderContinueWatching(items) {
    if (!items.length) return "";

    return `
    <section style="margin-bottom: 28px;">
      <h2 class="section-title">Continue watching</h2>
      <div class="media-grid">
        ${items.map(videoCard).join("")}
      </div>
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
        const continueWatching = folderPath === "" ? await api.getContinueWatching(8) : [];

        const folders = Array.isArray(data.folders) ? data.folders : [];
        const videos = Array.isArray(data.videos) ? data.videos : [];
        const hasContent = folders.length > 0 || videos.length > 0 || continueWatching.length > 0;

        pageRoot.innerHTML = `
      ${renderBreadcrumb(folderPath)}

      ${!hasContent ? renderEmptyState("Nothing here", "This folder is empty.") : ""}

      ${folderPath === "" ? renderContinueWatching(continueWatching) : ""}

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