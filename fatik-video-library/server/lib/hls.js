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

function getVariantPlaylistPath(relativePath, quality) {
    return path.join(getItemHlsDirByPath(relativePath), `${quality}.m3u8`);
}

function getHlsFilePathByPath(relativePath, fileName) {
    return path.join(getItemHlsDirByPath(relativePath), path.basename(fileName));
}

function getProfileByName(name) {
    return config.HLS_PROFILES.find((profile) => profile.name === name) || null;
}

async function buildVariantByPath(relativePath, quality) {
    const profile = getProfileByName(quality);
    if (!profile) {
        throw new Error(`Unknown HLS quality: ${quality}`);
    }

    const outputDir = getItemHlsDirByPath(relativePath);
    ensureDir(outputDir);

    const inputPath = getSafeLibraryAbsolutePath(relativePath);
    const playlistPath = getVariantPlaylistPath(relativePath, profile.name);
    const segmentPattern = path.join(outputDir, `${profile.name}_%03d.ts`);

    if (fs.existsSync(playlistPath)) {
        return playlistPath;
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

    return playlistPath;
}

module.exports = {
    buildVariantByPath,
    getVariantPlaylistPath,
    getHlsFilePathByPath
};