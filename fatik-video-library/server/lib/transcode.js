const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { config } = require("./config");
const { ensureDir } = require("./fs-utils");
const { getSafeLibraryAbsolutePath, normalizeRelativeLibraryPath } = require("./paths");
const { createStableId } = require("./ids");

const TRANSCODE_SUBDIR = "mp4";
const activeJobs = new Map();

function getTranscodeKey(relativePath) {
    const normalized = normalizeRelativeLibraryPath(relativePath);
    return createStableId(`mp4:${normalized}`);
}

function getCachedMp4Path(relativePath) {
    const key = getTranscodeKey(relativePath);
    return path.join(config.CACHE_DIR, TRANSCODE_SUBDIR, `${key}.mp4`);
}

function needsRebuild(sourcePath, outputPath) {
    if (!fs.existsSync(outputPath)) {
        return true;
    }

    const sourceStat = fs.statSync(sourcePath);
    const outputStat = fs.statSync(outputPath);

    return sourceStat.mtimeMs > outputStat.mtimeMs;
}

function runFfmpegToMp4(sourcePath, outputPath) {
    return new Promise((resolve, reject) => {
        const tempOutputPath = `${outputPath}.tmp`;
        const outputDir = path.dirname(outputPath);
        ensureDir(outputDir);

        if (fs.existsSync(tempOutputPath)) {
            fs.rmSync(tempOutputPath, { force: true });
        }

        const args = [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            sourcePath,
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ac",
            "2",
            tempOutputPath
        ];

        const ffmpeg = spawn("ffmpeg", args, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderrBuffer = "";

        ffmpeg.stderr.on("data", (chunk) => {
            const text = chunk.toString();
            stderrBuffer += text;
            if (stderrBuffer.length > 16_000) {
                stderrBuffer = stderrBuffer.slice(-16_000);
            }
            process.stderr.write(`[ffmpeg] ${text}`);
        });

        ffmpeg.on("error", (error) => {
            if (fs.existsSync(tempOutputPath)) {
                fs.rmSync(tempOutputPath, { force: true });
            }
            reject(error);
        });

        ffmpeg.on("close", (code) => {
            if (code !== 0) {
                if (fs.existsSync(tempOutputPath)) {
                    fs.rmSync(tempOutputPath, { force: true });
                }
                reject(new Error(`ffmpeg exited with code ${code}. ${stderrBuffer.trim()}`.trim()));
                return;
            }

            fs.renameSync(tempOutputPath, outputPath);
            resolve(outputPath);
        });
    });
}

function isBrowserFriendlySource(relativePath, metadata = {}) {
    const extension = path.extname(relativePath).toLowerCase();
    if (extension !== ".mp4") {
        return false;
    }

    const videoCodec = String(metadata.videoCodec || "").toLowerCase();
    const audioCodec = String(metadata.audioTracks?.[0]?.codec || "").toLowerCase();

    const videoCompatible = videoCodec === "h264" || videoCodec === "avc1";
    const audioCompatible = !audioCodec || audioCodec === "aac" || audioCodec === "mp4a";

    return videoCompatible && audioCompatible;
}

function getOrStartJob(relativePath) {
    const normalized = normalizeRelativeLibraryPath(relativePath);
    const sourcePath = getSafeLibraryAbsolutePath(normalized);
    const outputPath = getCachedMp4Path(normalized);

    if (!fs.existsSync(sourcePath)) {
        throw new Error("Source video file not found");
    }

    if (!needsRebuild(sourcePath, outputPath)) {
        return {
            status: "ready",
            outputPath,
            promise: Promise.resolve(outputPath)
        };
    }

    const existing = activeJobs.get(normalized);
    if (existing) {
        return existing;
    }

    const job = {
        status: "preparing",
        outputPath,
        promise: runFfmpegToMp4(sourcePath, outputPath)
    };

    job.promise
        .then(() => {
            activeJobs.delete(normalized);
        })
        .catch((error) => {
            job.status = "failed";
            job.error = error;
            activeJobs.delete(normalized);
        });

    activeJobs.set(normalized, job);
    return job;
}

async function ensureMp4(relativePath, options = {}) {
    const wait = options.wait !== false;
    const job = getOrStartJob(relativePath);

    if (job.status === "ready") {
        return {
            status: "ready",
            outputPath: job.outputPath
        };
    }

    if (!wait) {
        return {
            status: "preparing",
            outputPath: job.outputPath
        };
    }

    await job.promise;

    return {
        status: "ready",
        outputPath: job.outputPath
    };
}

module.exports = {
    ensureMp4,
    getCachedMp4Path,
    isBrowserFriendlySource
};
