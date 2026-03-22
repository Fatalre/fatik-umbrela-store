const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { config } = require("./config");
const { ensureDir } = require("./fs-utils");
const { getSafeLibraryAbsolutePath } = require("./paths");
const { createStableId } = require("./ids");

function getTranscodeKey(relativePath) {
    return createStableId(`mp4:${relativePath}`);
}

function getOutputPath(relativePath) {
    const key = getTranscodeKey(relativePath);
    return path.join(config.CACHE_DIR, "mp4", `${key}.mp4`);
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", args);

        ff.stderr.on("data", () => {}); // игнор

        ff.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error("ffmpeg failed"));
        });
    });
}

async function ensureMp4(relativePath) {
    const input = getSafeLibraryAbsolutePath(relativePath);
    const output = getOutputPath(relativePath);

    if (fs.existsSync(output)) {
        return output;
    }

    ensureDir(path.dirname(output));

    await runFfmpeg([
        "-y",
        "-i", input,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        output
    ]);

    return output;
}

module.exports = {
    ensureMp4,
    getOutputPath
};