const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const { config } = require("./config");
const { ensureDir } = require("./fs-utils");
const { getSafeLibraryAbsolutePath } = require("./paths");

function getItemHlsDir(item) {
    return path.join(config.HLS_DIR, item.id);
}

function getHlsMasterPath(item) {
    return path.join(getItemHlsDir(item), "master.m3u8");
}

function getHlsFilePath(item, fileName) {
    return path.join(getItemHlsDir(item), path.basename(fileName));
}

function buildMasterPlaylist(item) {
    const itemDir = getItemHlsDir(item);
    const masterPath = getHlsMasterPath(item);

    const variants = [
        {
            name: "1080p",
            bandwidth: 5200000,
            resolution: "1920x1080",
            file: "1080p.m3u8"
        },
        {
            name: "720p",
            bandwidth: 3000000,
            resolution: "1280x720",
            file: "720p.m3u8"
        },
        {
            name: "480p",
            bandwidth: 1400000,
            resolution: "854x480",
            file: "480p.m3u8"
        }
    ].filter((variant) => fs.existsSync(path.join(itemDir, variant.file)));

    const lines = ["#EXTM3U"];

    for (const variant of variants) {
        lines.push(
            `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution},NAME="${variant.name}"`
        );
        lines.push(`/api/hls/${item.id}/${variant.file}`);
    }

    fs.writeFileSync(masterPath, `${lines.join("\n")}\n`, "utf8");
}

async function buildVariant(item, profile) {
    const outputDir = getItemHlsDir(item);
    ensureDir(outputDir);

    const inputPath = getSafeLibraryAbsolutePath(item.relativePath);
    const playlistPath = path.join(outputDir, `${profile.name}.m3u8`);
    const segmentPattern = path.join(outputDir, `${profile.name}_%03d.ts`);

    if (fs.existsSync(playlistPath)) {
        return;
    }

    await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        inputPath,
        "-vf",
        `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        profile.videoBitrate,
        "-c:a",
        "aac",
        "-b:a",
        profile.audioBitrate,
        "-f",
        "hls",
        "-hls_time",
        "6",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        segmentPattern,
        playlistPath
    ]);
}

async function ensureHlsForItem(item) {
    const outputDir = getItemHlsDir(item);
    ensureDir(outputDir);

    for (const profile of config.HLS_PROFILES) {
        try {
            await buildVariant(item, profile);
        } catch (error) {
            console.error(`Failed to build HLS profile ${profile.name} for ${item.id}:`, error.message);
        }
    }

    buildMasterPlaylist(item);
}

module.exports = {
    ensureHlsForItem,
    getHlsMasterPath,
    getHlsFilePath
};