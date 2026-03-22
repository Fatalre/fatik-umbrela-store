const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const { config } = require("./config");
const { ensureDir } = require("./fs-utils");
const { getSafeLibraryAbsolutePath } = require("./paths");
const { createStableId } = require("./ids");

function getHlsKeyFromRelativePath(relativePath) {
    return createStableId(`hls:${relativePath}`);
}

function getItemHlsDirByPath(relativePath) {
    const key = getHlsKeyFromRelativePath(relativePath);
    return path.join(config.HLS_DIR, key);
}

function getHlsMasterPathByPath(relativePath) {
    return path.join(getItemHlsDirByPath(relativePath), "master.m3u8");
}

function getHlsFilePathByPath(relativePath, fileName) {
    return path.join(getItemHlsDirByPath(relativePath), path.basename(fileName));
}

function buildMasterPlaylistByPath(relativePath) {
    const itemDir = getItemHlsDirByPath(relativePath);
    const masterPath = getHlsMasterPathByPath(relativePath);

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

    const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

    for (const variant of variants) {
        lines.push(
            `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution}`
        );
        lines.push(
            `/api/hls-by-path/file?path=${encodeURIComponent(relativePath)}&file=${encodeURIComponent(variant.file)}`
        );
    }

    fs.writeFileSync(masterPath, `${lines.join("\n")}\n`, "utf8");
}

async function buildVariantByPath(relativePath, profile) {
    const outputDir = getItemHlsDirByPath(relativePath);
    ensureDir(outputDir);

    const inputPath = getSafeLibraryAbsolutePath(relativePath);
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

async function ensureHlsForPath(relativePath) {
    const outputDir = getItemHlsDirByPath(relativePath);
    ensureDir(outputDir);

    for (const profile of config.HLS_PROFILES) {
        try {
            await buildVariantByPath(relativePath, profile);
        } catch (error) {
            console.error(`Failed to build HLS profile ${profile.name} for ${relativePath}:`, error.message);
        }
    }

    buildMasterPlaylistByPath(relativePath);
}

module.exports = {
    ensureHlsForPath,
    getHlsMasterPathByPath,
    getHlsFilePathByPath
};