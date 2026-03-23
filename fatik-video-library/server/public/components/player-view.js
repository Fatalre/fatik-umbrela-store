import { api } from "../api.js";
import { renderEmptyState } from "./empty-state.js";
import { renderBreadcrumb } from "./breadcrumb.js";
import { formatBytes, formatDuration, formatResolution, escapeHtml } from "../utils.js";

function getResumePosition(item) {
    const position = Number(item.state?.progress?.position || 0);
    const duration = Number(item.state?.progress?.duration || item.metadata?.durationSeconds || 0);

    if (!Number.isFinite(position) || position <= 5) {
        return 0;
    }

    if (Number.isFinite(duration) && duration > 0 && position >= duration - 30) {
        return 0;
    }

    return position;
}

function renderSubtitleInfo(subtitles) {
    if (!subtitles.length) {
        return `<div><strong>Subtitles:</strong> None</div>`;
    }

    return `
    <div>
      <strong>Subtitles:</strong>
      ${subtitles.map((item) => escapeHtml(item.language || item.fileName)).join(", ")}
    </div>
  `;
}

function attachSubtitleTracks(video, item, subtitles) {
    const existingTracks = Array.from(video.querySelectorAll("track"));
    for (const track of existingTracks) {
        track.remove();
    }

    subtitles.forEach((subtitle, index) => {
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = subtitle.language || subtitle.fileName;
        track.srclang = (subtitle.language || "en").slice(0, 2).toLowerCase();
        track.src = `/api/subtitles/${encodeURIComponent(item.id)}/${encodeURIComponent(subtitle.fileName)}`;

        if (index === 0) {
            track.default = true;
        }

        video.appendChild(track);
    });
}

function clearVideoSource(video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
}

function setVideoSource(video, src, resumePosition = 0) {
    video.src = src;
    video.load();

    video.addEventListener(
        "loadedmetadata",
        () => {
            if (resumePosition > 0 && Number.isFinite(resumePosition)) {
                video.currentTime = resumePosition;
            }

            video.play().catch(() => {});
        },
        { once: true }
    );
}

export async function renderPlayerPage(appRoot, relativePath) {
    const pageRoot = document.getElementById("page-root");
    pageRoot.innerHTML = `<div class="card empty-state">Loading video...</div>`;

    try {
        const item = await api.getItemByPath(relativePath);
        const subtitles = await api.getSubtitles(item.id);
        const metadata = item.metadata || {};
        const resumePosition = getResumePosition(item);

        pageRoot.innerHTML = `
      ${renderBreadcrumb(item.parentPath || "")}

      <div class="player-layout">
        <div class="card player-box">
          <video
            id="video-player"
            class="video-element"
            controls
            preload="metadata"
          ></video>
          <div id="player-status" class="player-status" hidden></div>
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
            ${resumePosition > 0 ? `<div><strong>Resume from:</strong> ${formatDuration(resumePosition)}</div>` : ""}
            ${renderSubtitleInfo(subtitles)}
          </div>

          <div class="actions-row">
            <button id="watched-button" class="secondary-button" type="button">
              ${item.state?.watched ? "Watched" : "Mark as watched"}
            </button>
            <button id="restart-button" class="secondary-button" type="button">
              Restart
            </button>
            <a class="secondary-button" href="#/folder/${encodeURIComponent(item.parentPath || "")}">
              Back to folder
            </a>
          </div>
        </aside>
      </div>
    `;

        const video = document.getElementById("video-player");
        const playerStatus = document.getElementById("player-status");
        const watchedButton = document.getElementById("watched-button");
        const restartButton = document.getElementById("restart-button");

        attachSubtitleTracks(video, item, subtitles);

        const showStatus = (message, type = "info", action = null) => {
            playerStatus.hidden = false;
            playerStatus.className = `player-status ${type}`;
            playerStatus.innerHTML = "";

            const text = document.createElement("p");
            text.textContent = message;
            playerStatus.appendChild(text);

            if (action) {
                playerStatus.appendChild(action);
            }
        };

        const hideStatus = () => {
            playerStatus.hidden = true;
            playerStatus.innerHTML = "";
            playerStatus.className = "player-status";
        };

        const loadMediaSource = async () => {
            const source = await api.getMediaSource(item.relativePath);

            if (source.type === "original" || source.type === "converted") {
                hideStatus();
                setVideoSource(video, source.url, resumePosition);
                return;
            }

            clearVideoSource(video);

            const prepareButton = document.createElement("button");
            prepareButton.type = "button";
            prepareButton.className = "primary-button";
            prepareButton.textContent = "Prepare for browser playback";

            prepareButton.addEventListener("click", async () => {
                prepareButton.disabled = true;
                showStatus(
                    "Preparing video for browser playback. This may take a long time on low-power devices.",
                    "info"
                );

                try {
                    const result = await api.prepareTranscode(item.relativePath);
                    hideStatus();
                    setVideoSource(video, result.url, resumePosition);
                } catch (error) {
                    showStatus(
                        "Failed to prepare video for browser playback.",
                        "error"
                    );
                    prepareButton.disabled = false;
                }
            });

            showStatus(
                "This file is not supported for direct browser playback.",
                "warning",
                prepareButton
            );
        };

        await loadMediaSource();

        watchedButton?.addEventListener("click", async () => {
            try {
                await api.setWatched(item.id, true);
                watchedButton.textContent = "Watched";
                watchedButton.disabled = true;
            } catch (error) {
                alert(error.message);
            }
        });

        restartButton?.addEventListener("click", async () => {
            video.currentTime = 0;

            try {
                await api.saveProgress(item.id, 0, video.duration || 0);
            } catch {
                // no-op
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
                // no-op
            }
        });

        video?.addEventListener("ended", async () => {
            try {
                await api.setWatched(item.id, true);
                await api.saveProgress(item.id, 0, video.duration || 0);
            } catch {
                // no-op
            }
        });
    } catch (error) {
        pageRoot.innerHTML = renderEmptyState("Failed to load video", error.message);
    }
}
