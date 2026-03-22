const fs = require("fs");
const path = require("path");

const config = {
    PORT: Number(process.env.PORT || 3000),
    NODE_ENV: process.env.NODE_ENV || "development",
    DATA_DIR: process.env.DATA_DIR || path.resolve(__dirname, "..", "..", "data"),
    LIBRARY_DIR: process.env.LIBRARY_DIR || path.resolve(__dirname, "..", "..", "data", "library"),
    CACHE_DIR: process.env.CACHE_DIR || path.resolve(__dirname, "..", "..", "data", "cache"),
    CONFIG_DIR: process.env.CONFIG_DIR || path.resolve(__dirname, "..", "..", "data", "config"),

    VIDEO_EXTENSIONS: [".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"],
    SUBTITLE_EXTENSIONS: [".srt", ".vtt", ".ass"],
    IMAGE_EXTENSIONS: [".jpg", ".jpeg", ".png", ".webp"],

    DB_PATH: null,
    SETTINGS_PATH: null,
    POSTERS_DIR: null,
    HLS_DIR: null,

    HLS_PROFILES: [
        { name: "1080p", width: 1920, height: 1080, videoBitrate: "5000k", audioBitrate: "192k" },
        { name: "720p", width: 1280, height: 720, videoBitrate: "2800k", audioBitrate: "160k" },
        { name: "480p", width: 854, height: 480, videoBitrate: "1200k", audioBitrate: "128k" }
    ]
};

config.DB_PATH = path.join(config.CACHE_DIR, "db.json");
config.SETTINGS_PATH = path.join(config.CONFIG_DIR, "settings.json");
config.POSTERS_DIR = path.join(config.CACHE_DIR, "posters");
config.HLS_DIR = path.join(config.CACHE_DIR, "hls");

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, defaultContent) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, defaultContent, "utf8");
    }
}

function ensureAppDirectories() {
    ensureDirectory(config.DATA_DIR);
    ensureDirectory(config.LIBRARY_DIR);
    ensureDirectory(config.CACHE_DIR);
    ensureDirectory(config.CONFIG_DIR);
    ensureDirectory(config.POSTERS_DIR);
    ensureDirectory(config.HLS_DIR);

    ensureFile(
        config.DB_PATH,
        JSON.stringify(
            {
                version: 1,
                itemStates: {},
                generatedAt: new Date().toISOString()
            },
            null,
            2
        )
    );

    ensureFile(
        config.SETTINGS_PATH,
        JSON.stringify(
            {
                version: 1,
                defaultQuality: "original",
                autoBuildHls: false,
                autoGeneratePosters: true
            },
            null,
            2
        )
    );
}

module.exports = {
    config,
    ensureAppDirectories
};