import { api } from "../api.js";
import { state } from "../state.js";
import { renderSidebarTree } from "./sidebar-tree.js";
import { renderBreadcrumb } from "./breadcrumb.js";
import { renderEmptyState } from "./empty-state.js";
import {
    formatBytes,
    formatDuration,
    formatResolution,
    escapeHtml,
    parseEpisodeInfo
} from "../utils.js";

function getProgressPercent(video) {
    const position = Number(video.state?.progress?.position || 0);
    const duration = Number(video.state?.progress?.duration || video.metadata?.durationSeconds || 0);

    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
        return 0;
    }

    return Math.max(0, Math.min(100, Math.round((position / duration) * 100)));
}

function folderCard(folder) {
    return `
    <a class="folder-card" href="#/folder/${encodeURIComponent(folder.relativePath)}">
      <h3 class="folder-title">${escapeHtml(folder.name)}</h3>
      <div class="folder-meta">${folder.videoCount} video(s)</div>
    </a>
  `;
}

function videoCard(video, options = {}) {
    const metadata = video.metadata || {};
    const watched = video.state?.watched === true;
    const progressPercent = getProgressPercent(video);
    const showProgress = options.showProgress === true && progressPercent > 0;

    return `
    <a class="media-card" href="#/watch/${encodeURIComponent(video.id)}">
      <img
        class="poster"
        src="/api/poster/${encodeURIComponent(video.id)}"
        alt="${escapeHtml(video.title)}"
        loading="lazy"
        onerror="this.onerror=null;this.src='/assets/placeholder-poster.svg';"
      />
      ${showProgress ? `
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${progressPercent}%"></div>
        </div>
      ` : ""}
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

function episodeRow(video) {
    const metadata = video.metadata || {};
    const watched = video.state?.watched === true;
    const progressPercent = getProgressPercent(video);
    const parsed = parseEpisodeInfo(video.fileName || video.title || "");
    const episodeLabel = parsed
        ? `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`
        : "Episode";

    return `
    <a class="episode-row" href="#/watch/${encodeURIComponent(video.id)}">
      <div class="episode-main">
        <div class="episode-code">${escapeHtml(episodeLabel)}</div>
        <div class="episode-info">
          <div class="episode-title">${escapeHtml(video.title)}</div>
          <div class="episode-meta">
            ${formatDuration(metadata.durationSeconds || 0)}
            <span>•</span>
            ${formatResolution(metadata.resolution)}
            <span>•</span>
            ${formatBytes(video.sizeBytes || 0)}
          </div>
        </div>
      </div>
      <div class="episode-side">
        ${watched ? `<span class="status-badge">Watched</span>` : ""}
        ${progressPercent > 0 ? `
          <div class="episode-progress">
            <div class="episode-progress-fill" style="width:${progressPercent}%"></div>
          </div>
        ` : ""}
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
        ? `<div class="media-grid">${videos.map((video) => videoCard(video, { showProgress: true })).join("")}</div>`
        : renderEmptyState("Nothing found", "No videos match your search.")}
    </section>
  `;
}

function renderContinueWatching(items) {
    if (!items.length) return "";

    return `
    <section style="margin-bottom: 28px;">
      <h2 class="section-title">Continue Watching</h2>
      <div class="media-grid">
        ${items.map((video) => videoCard(video, { showProgress: true })).join("")}
      </div>
    </section>
  `;
}

function splitFolderVideos(videos) {
    const episodes = [];
    const regularVideos = [];

    for (const video of videos) {
        const parsed = parseEpisodeInfo(video.fileName || video.title || "");
        if (video.kind === "episode" || parsed) {
            episodes.push(video);
        } else {
            regularVideos.push(video);
        }
    }

    episodes.sort((a, b) => {
        const aInfo = parseEpisodeInfo(a.fileName || a.title || "");
        const bInfo = parseEpisodeInfo(b.fileName || b.title || "");

        if (!aInfo && !bInfo) return a.title.localeCompare(b.title);
        if (!aInfo) return 1;
        if (!bInfo) return -1;

        if (aInfo.season !== bInfo.season) {
            return aInfo.season - bInfo.season;
        }

        if (aInfo.episode !== bInfo.episode) {
            return aInfo.episode - bInfo.episode;
        }

        return a.title.localeCompare(b.title);
    });

    return { episodes, regularVideos };
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
        const { episodes, regularVideos } = splitFolderVideos(videos);
        const hasContent = folders.length > 0 || videos.length > 0;

        let continueWatchingHtml = "";
        if (!folderPath) {
            const continueWatchingItems = await api.getContinueWatching();
            continueWatchingHtml = renderContinueWatching(continueWatchingItems || []);
        }

        pageRoot.innerHTML = `
      ${renderBreadcrumb(folderPath)}
      ${continueWatchingHtml}

      ${!hasContent ? renderEmptyState("Nothing here", "This folder is empty.") : ""}

      ${folders.length ? `
        <section>
          <h2 class="section-title">Folders</h2>
          <div class="folder-grid">
            ${folders.map(folderCard).join("")}
          </div>
        </section>
      ` : ""}

      ${episodes.length ? `
        <section style="margin-top: 24px;">
          <h2 class="section-title">Episodes</h2>
          <div class="episodes-list">
            ${episodes.map(episodeRow).join("")}
          </div>
        </section>
      ` : ""}

      ${regularVideos.length ? `
        <section style="margin-top: 24px;">
          <h2 class="section-title">Videos</h2>
          <div class="media-grid">
            ${regularVideos.map((video) => videoCard(video, { showProgress: true })).join("")}
          </div>
        </section>
      ` : ""}
    `;
    } catch (error) {
        pageRoot.innerHTML = renderEmptyState("Failed to load folder", error.message);
    }
}