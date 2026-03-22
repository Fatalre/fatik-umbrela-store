const fs = require("fs");
const path = require("path");
const { config } = require("./config");

function pathExists(targetPath) {
    return fs.existsSync(targetPath);
}

function statSafe(targetPath) {
    try {
        return fs.statSync(targetPath);
    } catch {
        return null;
    }
}

function readDirSafe(targetPath) {
    try {
        return fs.readdirSync(targetPath, { withFileTypes: true });
    } catch {
        return [];
    }
}

function isVideoFile(fileName) {
    return config.VIDEO_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

function isSubtitleFile(fileName) {
    return config.SUBTITLE_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

function ensureDir(targetPath) {
    fs.mkdirSync(targetPath, { recursive: true });
}

function walkDirectoryRecursive(rootPath, onFile) {
    const entries = readDirSafe(rootPath);

    for (const entry of entries) {
        const fullPath = path.join(rootPath, entry.name);

        if (entry.isDirectory()) {
            walkDirectoryRecursive(fullPath, onFile);
            continue;
        }

        if (entry.isFile()) {
            onFile(fullPath);
        }
    }
}

module.exports = {
    pathExists,
    statSafe,
    readDirSafe,
    isVideoFile,
    isSubtitleFile,
    ensureDir,
    walkDirectoryRecursive
};