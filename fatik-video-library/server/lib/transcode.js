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

function isCacheFresh(sourcePath, outputPath) {
    if (!fs.existsSync(outputPath)) {
        return false;
    }

    const sourceStat = fs.statSync(sourcePath);
    const outputStat = fs.statSync(outputPath);

    return outputStat.mtimeMs >= sourceStat.mtimeMs;
}

function runFfmpeg(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const args = [
            "-y",
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            inputPath,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-movflags",
            "+faststart",
            outputPath
        ];

        const child = spawn("ffmpeg", args, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderrTail = "";

        child.stderr.on("data", (chunk) => {
            stderrTail += chunk.toString();
            if (stderrTail.length > 20000) {
                stderrTail = stderrTail.slice(-20000);
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

            reject(new Error(stderrTail || `ffmpeg exited with code ${code}`));
        });
    });
}

async function ensureMp4(relativePath) {
    const inputPath = getSafeLibraryAbsolutePath(relativePath);

    if (!fs.existsSync(inputPath)) {
        throw new Error("Source file not found");
    }

    const outputPath = getOutputPath(relativePath);

    if (isCacheFresh(inputPath, outputPath)) {
        return outputPath;
    }

    ensureDir(path.dirname(outputPath));

    await runFfmpeg(inputPath, outputPath);

    return outputPath;
}

function getCachedMp4Info(relativePath) {
    const sourcePath = getSafeLibraryAbsolutePath(relativePath);
    const outputPath = getOutputPath(relativePath);

    if (!fs.existsSync(sourcePath)) {
        return {
            exists: false,
            fresh: false,
            outputPath
        };
    }

    const fresh = isCacheFresh(sourcePath, outputPath);

    return {
        exists: fs.existsSync(outputPath),
        fresh,
        outputPath
    };
}

module.exports = {
    ensureMp4,
    getOutputPath,
    getCachedMp4Info
};
