const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const { getSafeLibraryAbsolutePath } = require("./paths");

function detectKindFromPath(relativePath) {
    const normalized = relativePath.toLowerCase();

    if (/s\d{1,2}e\d{1,2}/i.test(relativePath)) {
        return "episode";
    }

    if (normalized.includes("/season ") || normalized.includes("\\season ")) {
        return "episode";
    }

    return "movie";
}

function extractTitleFromPath(relativePath) {
    const baseName = path.basename(relativePath, path.extname(relativePath));
    return baseName.replace(/[._]/g, " ").trim();
}

async function getLocalVideoMetadata(relativePath) {
    const filePath = getSafeLibraryAbsolutePath(relativePath);

    const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration,size:stream=index,codec_type,codec_name,width,height,channels",
        "-of",
        "json",
        filePath
    ]);

    const parsed = JSON.parse(stdout || "{}");
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const format = parsed.format || {};

    const videoStream = streams.find((stream) => stream.codec_type === "video");
    const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
    const subtitleStreams = streams.filter((stream) => stream.codec_type === "subtitle");

    return {
        title: extractTitleFromPath(relativePath),
        kind: detectKindFromPath(relativePath),
        durationSeconds: Number(format.duration || 0),
        sizeBytes: Number(format.size || 0),
        resolution: videoStream
            ? {
                width: Number(videoStream.width || 0),
                height: Number(videoStream.height || 0)
            }
            : null,
        videoCodec: videoStream ? videoStream.codec_name || null : null,
        audioTracks: audioStreams.map((stream) => ({
            index: stream.index,
            codec: stream.codec_name || null,
            channels: Number(stream.channels || 0)
        })),
        subtitleTracks: subtitleStreams.map((stream) => ({
            index: stream.index,
            codec: stream.codec_name || null
        }))
    };
}

module.exports = {
    getLocalVideoMetadata,
    detectKindFromPath,
    extractTitleFromPath
};