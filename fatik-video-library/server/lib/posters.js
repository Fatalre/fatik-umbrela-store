const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const { config } = require("./config");
const { ensureDir } = require("./fs-utils");
const { getSafeLibraryAbsolutePath } = require("./paths");

function getPosterPathForItem(item) {
    return path.join(config.POSTERS_DIR, `${item.id}.jpg`);
}

async function ensurePosterForItem(item) {
    const posterPath = getPosterPathForItem(item);

    if (fs.existsSync(posterPath)) {
        return posterPath;
    }

    ensureDir(config.POSTERS_DIR);

    const sourcePath = getSafeLibraryAbsolutePath(item.relativePath);

    await execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        "00:00:10",
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        posterPath
    ]);

    return posterPath;
}

module.exports = {
    getPosterPathForItem,
    ensurePosterForItem
};