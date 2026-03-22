import { api } from "../api.js";
import { renderEmptyState } from "./empty-state.js";
import { renderBreadcrumb } from "./breadcrumb.js";
import { formatBytes, formatDuration, formatResolution, escapeHtml } from "../utils.js";

export async function renderPlayerPage(appRoot, itemId) {
    const pageRoot = document.getElementById("page-root");
    pageRoot.innerHTML = `<div class="card empty-state">Loading video...</div>`;

    try {
        const item = await api.getItem(itemId);
        const metadata = item.metadata || {};
        const streamUrl = api.getOriginalStreamUrl(item.id);

        pageRoot.innerHTML = `
      ${renderBreadcrumb(item.parentPath || "")}

      <div class="player-layout">
        <div class="card player-box">
          <video
            id="video-player"
            class="video-element"
            controls
            preload="metadata"
            src="${streamUrl}"
          ></video>
        </div>

        <aside class="card player-panel">
          <span class="status-badge">${escapeHtml(item.kind || "video")}</span>
          <h1 class="player-title">${escapeHtml(item.title)}</h1>

          <div class="meta-list">
            <div><strong>File:</strong> ${escapeHtml(item.fileName || "")}</div>
            <div><strong>Path:</strong> ${escapeHtml(item.relativePath || "")}</div>
            <div><strong>Duration:</strong> ${formatDuration(metadata.durationSeconds || 0)}</div>
            <div><strong>Resolution:</strong> ${formatResolution(metadata.resolution)}</div>
            <div><strong>Codec:</strong> ${escapeHtml(metadata.videoCodec || "Unknown")}</div>
            <div><strong>Size:</strong> ${formatBytes(item.sizeBytes || 0)}</div>
          </div>

          <div class="actions-row">
            <button id="watched-button" class="secondary-button" type="button">
              Mark as watched
            </button>
            <a class="secondary-button" href="#/folder/${encodeURIComponent(item.parentPath || "")}">
              Back to folder
            </a>
          </div>
        </aside>
      </div>
    `;

        const video = document.getElementById("video-player");
        const watchedButton = document.getElementById("watched-button");

        watchedButton?.addEventListener("click", async () => {
            try {
                await api.setWatched(item.id, true);
                watchedButton.textContent = "Watched";
                watchedButton.disabled = true;
            } catch (error) {
                alert(error.message);
            }
        });

        let lastSave = 0;
        video?.addEventListener("timeupdate", async () => {
            const now = Date.now();
            if (now - lastSave < 10000) return;
            lastSave = now;

            try {
                await api.saveProgress(item.id, video.currentTime, video.duration || 0);
            } catch {
            }
        });
    } catch (error) {
        pageRoot.innerHTML = renderEmptyState("Failed to load video", error.message);
    }
}