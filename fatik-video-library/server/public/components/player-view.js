import { api } from "../api.js";
import { renderEmptyState } from "./empty-state.js";
import { renderBreadcrumb } from "./breadcrumb.js";
import { renderQualitySelector } from "./quality-selector.js";
import { formatBytes, formatDuration, formatResolution, escapeHtml } from "../utils.js";

function getSavedQuality(itemId) {
    return localStorage.getItem(`fatik-video-library:quality:${itemId}`) || "original";
}

function saveQuality(itemId, value) {
    localStorage.setItem(`fatik-video-library:quality:${itemId}`, value);
}

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

async function ensureHlsBuilt(itemId) {
    await api.buildHls(itemId);
    return api.getHlsMasterUrl(itemId);
}

async function attachSource(video, item, quality, resumePosition = 0) {
    const wasPaused = video.paused;

    if (video._hlsInstance) {
        video._hlsInstance.destroy();
        video._hlsInstance = null;
    }

    if (quality === "original") {
        video.src = api.getOriginalStreamUrlByPath(item.relativePath);
        video.load();

        video.addEventListener(
            "loadedmetadata",
            () => {
                if (resumePosition > 0 && Number.isFinite(resumePosition)) {
                    video.currentTime = resumePosition;
                }
            },
            { once: true }
        );

        if (!wasPaused) {
            video.play().catch(() => {});
        }

        return;
    }

    const masterUrl = await ensureHlsBuilt(item.id);

    if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls();
        video._hlsInstance = hls;

        hls.loadSource(masterUrl);
        hls.attachMedia(video);

        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            const levels = hls.levels || [];
            const qualityIndex = levels.findIndex((level) => `${level.height}p` === quality);

            if (qualityIndex >= 0) {
                hls.currentLevel = qualityIndex;
                hls.nextLevel = qualityIndex;
                hls.loadLevel = qualityIndex;
            }

            if (resumePosition > 0 && Number.isFinite(resumePosition)) {
                video.currentTime = resumePosition;
            }

            if (!wasPaused) {
                video.play().catch(() => {});
            }
        });

        return;
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = masterUrl;
        video.load();

        video.addEventListener(
            "loadedmetadata",
            () => {
                if (resumePosition > 0 && Number.isFinite(resumePosition)) {
                    video.currentTime = resumePosition;
                }
            },
            { once: true }
        );

        if (!wasPaused) {
            video.play().catch(() => {});
        }

        return;
    }

    throw new Error("HLS playback is not supported in this browser");
}

export async function renderPlayerPage(appRoot, itemId) {
    const pageRoot = document.getElementById("page-root");
    pageRoot.innerHTML = `<div class="card empty-state">Loading video...</div>`;

    try {
        const item = await api.getItem(itemId);
        const subtitles = await api.getSubtitles(item.id);
        const metadata = item.metadata || {};
        const selectedQuality = getSavedQuality(item.id);
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

          ${renderQualitySelector(selectedQuality)}

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
        const watchedButton = document.getElementById("watched-button");
        const restartButton = document.getElementById("restart-button");
        const qualitySelect = document.getElementById("quality-select");

        attachSubtitleTracks(video, item, subtitles);
        await attachSource(video, item, selectedQuality, resumePosition);

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
            }
        });

        qualitySelect?.addEventListener("change", async (event) => {
            const quality = event.target.value;
            const currentTime = video.currentTime || 0;

            saveQuality(item.id, quality);

            qualitySelect.disabled = true;
            try {
                await attachSource(video, item, quality, currentTime);
            } catch (error) {
                alert(error.message);
            } finally {
                qualitySelect.disabled = false;
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

        video?.addEventListener("ended", async () => {
            try {
                await api.setWatched(item.id, true);
                await api.saveProgress(item.id, 0, video.duration || 0);
            } catch {
            }
        });
    } catch (error) {
        pageRoot.innerHTML = renderEmptyState("Failed to load video", error.message);
    }
}