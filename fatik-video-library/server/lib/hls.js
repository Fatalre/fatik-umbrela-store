const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

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

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderr = "";

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 20000) {
                stderr = stderr.slice(-20000);
            }
        });

        child.on("error", (error) => {
            reject(error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr || `ffmpeg exited with code ${code}`));
        });
    });
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

    const args = [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
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
        "-sn",
        "-f",
        "hls",
        "-hls_time",
        "6",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        segmentPattern,
        playlistPath
    ];

    await runFfmpeg(args);

    return playlistPath;
}

module.exports = {
    buildVariantByPath,
    getVariantPlaylistPath,
    getHlsFilePathByPath
};