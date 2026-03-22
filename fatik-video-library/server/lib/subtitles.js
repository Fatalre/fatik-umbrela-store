const fs = require("fs");
const path = require("path");

const { getSafeLibraryAbsolutePath } = require("./paths");
const { config } = require("./config");

function getSubtitleBaseName(fileName) {
    return path.basename(fileName, path.extname(fileName));
}

function parseSubtitleLanguage(fileName, videoBaseName) {
    const subtitleBase = getSubtitleBaseName(fileName);

    if (subtitleBase === videoBaseName) {
        return "Unknown";
    }

    const suffix = subtitleBase.slice(videoBaseName.length).replace(/^[.\-_ ]+/, "").trim();
    if (!suffix) {
        return "Unknown";
    }

    return suffix;
}

function findExternalSubtitleFiles(relativeVideoPath) {
    const videoPath = getSafeLibraryAbsolutePath(relativeVideoPath);
    const videoDir = path.dirname(videoPath);
    const videoBaseName = path.basename(videoPath, path.extname(videoPath));

    if (!fs.existsSync(videoDir)) {
        return [];
    }

    const files = fs.readdirSync(videoDir, { withFileTypes: true });
    const subtitles = [];

    for (const entry of files) {
        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (!config.SUBTITLE_EXTENSIONS.includes(ext)) continue;

        const subtitleBase = path.basename(entry.name, ext);

        if (
            subtitleBase === videoBaseName ||
            subtitleBase.startsWith(`${videoBaseName}.`) ||
            subtitleBase.startsWith(`${videoBaseName}_`) ||
            subtitleBase.startsWith(`${videoBaseName}-`) ||
            subtitleBase.startsWith(`${videoBaseName} `)
        ) {
            subtitles.push({
                fileName: entry.name,
                extension: ext,
                language: parseSubtitleLanguage(entry.name, videoBaseName)
            });
        }
    }

    return subtitles.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function srtToVtt(srtText) {
    const normalized = String(srtText || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/^\uFEFF/, "");

    const converted = normalized.replace(
        /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
        "$1.$2"
    );

    return `WEBVTT\n\n${converted}`;
}

function getSubtitleAbsolutePath(relativeVideoPath, fileName) {
    const videoPath = getSafeLibraryAbsolutePath(relativeVideoPath);
    const videoDir = path.dirname(videoPath);
    const absolute = path.join(videoDir, path.basename(fileName));
    return absolute;
}

function readSubtitleAsVtt(relativeVideoPath, fileName) {
    const absolutePath = getSubtitleAbsolutePath(relativeVideoPath, fileName);

    if (!fs.existsSync(absolutePath)) {
        throw new Error("Subtitle file not found");
    }

    const ext = path.extname(fileName).toLowerCase();
    const raw = fs.readFileSync(absolutePath, "utf8");

    if (ext === ".vtt") {
        return raw.startsWith("WEBVTT") ? raw : `WEBVTT\n\n${raw}`;
    }

    if (ext === ".srt") {
        return srtToVtt(raw);
    }

    throw new Error("Unsupported subtitle format");
}

module.exports = {
    findExternalSubtitleFiles,
    getSubtitleAbsolutePath,
    readSubtitleAsVtt
};