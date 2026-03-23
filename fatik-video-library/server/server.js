const express = require("express");
const fs = require("fs");
const path = require("path");

const { findExternalSubtitleFiles, readSubtitleAsVtt } = require("./lib/subtitles");
const { config, ensureAppDirectories } = require("./lib/config");
const {
    buildLibraryTree,
    listFolderContents,
    findItemById,
    findItemByRelativePath,
    searchItems,
    getContinueWatchingItems
} = require("./lib/scan");
const { getLocalVideoMetadata } = require("./lib/metadata");
const { ensurePosterForItem, getPosterPathForItem } = require("./lib/posters");
const { loadDatabase, saveDatabase, getItemState, updateItemState } = require("./lib/db");
const { sendJson, sendError, parseBoolean } = require("./lib/api-utils");
const { getSafeLibraryAbsolutePath } = require("./lib/paths");
const { getMimeType } = require("./lib/mime");
const { ensureMp4, getCachedMp4Info, getOutputPath } = require("./lib/transcode");

const app = express();

app.use(express.json({ limit: "2mb" }));

ensureAppDirectories();

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

app.use("/assets", express.static(path.join(__dirname, "public", "assets")));

async function findItemOrRefresh(itemId) {
    let item = await findItemById(itemId);

    if (item) {
        return item;
    }

    await buildLibraryTree({ forceRefresh: true });
    item = await findItemById(itemId);

    return item;
}

async function findItemByPathOrRefresh(relativePath) {
    let item = await findItemByRelativePath(relativePath);

    if (item) {
        return item;
    }

    await buildLibraryTree({ forceRefresh: true });
    item = await findItemByRelativePath(relativePath);

    return item;
}

function isBrowserCompatibleMetadata(metadata) {
    const videoCodec = String(metadata?.videoCodec || "").toLowerCase();
    const primaryAudioCodec = String(metadata?.audioTracks?.[0]?.codec || "").toLowerCase();

    const isVideoCompatible = videoCodec === "h264" || videoCodec === "avc1";
    const isAudioCompatible = !primaryAudioCodec || primaryAudioCodec === "aac" || primaryAudioCodec.startsWith("mp4a");

    return isVideoCompatible && isAudioCompatible;
}

async function isDirectBrowserPlayable(relativePath) {
    const ext = path.extname(relativePath).toLowerCase();

    if (ext !== ".mp4") {
        return false;
    }

    try {
        const metadata = await getLocalVideoMetadata(relativePath);
        return isBrowserCompatibleMetadata(metadata);
    } catch {
        return false;
    }
}

function streamFileWithRange(res, filePath, contentType) {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    return (req) => {
        const range = req.headers.range;

        if (!range) {
            res.writeHead(200, {
                "Content-Length": fileSize,
                "Content-Type": contentType,
                "Accept-Ranges": "bytes"
            });
            fs.createReadStream(filePath).pipe(res);
            return;
        }

        const parts = range.replace(/bytes=/, "").split("-");
        const start = Number(parts[0]);
        const end = parts[1] ? Number(parts[1]) : fileSize - 1;

        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            start < 0 ||
            end < start ||
            start >= fileSize ||
            end >= fileSize
        ) {
            res.status(416).set({ "Content-Range": `bytes */${fileSize}` }).end();
            return;
        }

        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Type": contentType
        });

        stream.pipe(res);
    };
}

async function handlePathStream(req, res, absolutePath, contentType) {
    if (!fs.existsSync(absolutePath)) {
        return sendError(res, 404, "Video file not found");
    }

    const stream = streamFileWithRange(res, absolutePath, contentType);
    stream(req);
}

app.get("/api/health", async (req, res) => {
    sendJson(res, {
        ok: true,
        app: "fatik-video-library",
        version: "0.1.0"
    });
});

app.get("/api/tree", async (req, res) => {
    try {
        const tree = await buildLibraryTree();
        sendJson(res, { tree });
    } catch (error) {
        sendError(res, 500, "Failed to build library tree", error.message);
    }
});

app.get("/api/folder", async (req, res) => {
    try {
        const folderPath = String(req.query.path || "");
        const result = await listFolderContents(folderPath);
        sendJson(res, result);
    } catch (error) {
        sendError(res, 400, "Failed to list folder", error.message);
    }
});

app.get("/api/item/:id", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const db = loadDatabase();
        const state = getItemState(db, item.id);

        sendJson(res, {
            item: {
                ...item,
                state
            }
        });
    } catch (error) {
        sendError(res, 500, "Failed to get item", error.message);
    }
});

app.get("/api/item-by-path", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        const item = await findItemByPathOrRefresh(relativePath);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const db = loadDatabase();
        const state = getItemState(db, item.id);

        sendJson(res, {
            item: {
                ...item,
                state
            }
        });
    } catch (error) {
        sendError(res, 500, "Failed to get item", error.message);
    }
});

app.get("/api/media-source", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        const sourcePath = getSafeLibraryAbsolutePath(relativePath);

        if (!fs.existsSync(sourcePath)) {
            return sendError(res, 404, "Video file not found");
        }

        const directPlayable = await isDirectBrowserPlayable(relativePath);
        if (directPlayable) {
            return sendJson(res, {
                type: "original",
                url: `/api/stream-by-path?path=${encodeURIComponent(relativePath)}`,
                cached: false,
                reason: "browser-compatible"
            });
        }

        const cacheInfo = getCachedMp4Info(relativePath);
        if (cacheInfo.fresh) {
            return sendJson(res, {
                type: "converted",
                url: `/api/stream-by-path-mp4?path=${encodeURIComponent(relativePath)}`,
                cached: true,
                reason: "converted-cache-exists"
            });
        }

        sendJson(res, {
            type: "unsupported",
            url: null,
            cached: false,
            reason: "needs-browser-preparation"
        });
    } catch (error) {
        sendError(res, 500, "Failed to determine media source", error.message);
    }
});

app.post("/api/transcode/prepare", async (req, res) => {
    try {
        const relativePath = String(req.body.path || "");

        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        await ensureMp4(relativePath);

        sendJson(res, {
            ok: true,
            url: `/api/stream-by-path-mp4?path=${encodeURIComponent(relativePath)}`
        });
    } catch (error) {
        sendError(res, 500, "Failed to prepare MP4", error.message);
    }
});

app.get("/api/search", async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();
        const limit = Number(req.query.limit || 50);
        const items = await searchItems(query, limit);
        sendJson(res, { items });
    } catch (error) {
        sendError(res, 500, "Search failed", error.message);
    }
});

app.get("/api/continue-watching", async (req, res) => {
    try {
        const limit = Number(req.query.limit || 12);
        const items = await getContinueWatchingItems(limit);
        sendJson(res, { items });
    } catch (error) {
        sendError(res, 500, "Failed to load continue watching", error.message);
    }
});

app.post("/api/rescan", async (req, res) => {
    try {
        const tree = await buildLibraryTree({ forceRefresh: true });
        sendJson(res, {
            ok: true,
            message: "Library rescan completed",
            tree
        });
    } catch (error) {
        sendError(res, 500, "Failed to rescan library", error.message);
    }
});

app.post("/api/item/:id/watched", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const watched = parseBoolean(req.body.watched);
        const db = loadDatabase();

        updateItemState(db, item.id, {
            watched,
            updatedAt: new Date().toISOString()
        });

        saveDatabase(db);
        await buildLibraryTree({ forceRefresh: true });

        sendJson(res, {
            ok: true,
            itemId: item.id,
            watched
        });
    } catch (error) {
        sendError(res, 500, "Failed to update watched state", error.message);
    }
});

app.post("/api/item/:id/progress", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const position = Number(req.body.position || 0);
        const duration = Number(req.body.duration || 0);

        if (!Number.isFinite(position) || position < 0) {
            return sendError(res, 400, "Invalid position");
        }

        const db = loadDatabase();

        updateItemState(db, item.id, {
            progress: {
                position,
                duration,
                updatedAt: new Date().toISOString()
            }
        });

        saveDatabase(db);
        await buildLibraryTree({ forceRefresh: true });

        sendJson(res, {
            ok: true,
            itemId: item.id,
            progress: {
                position,
                duration
            }
        });
    } catch (error) {
        sendError(res, 500, "Failed to update progress", error.message);
    }
});

app.get("/api/poster/:id", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        await ensurePosterForItem(item);
        const posterPath = getPosterPathForItem(item);

        if (!fs.existsSync(posterPath)) {
            return sendError(res, 404, "Poster not found");
        }

        res.sendFile(posterPath);
    } catch (error) {
        sendError(res, 500, "Failed to serve poster", error.message);
    }
});

app.get("/api/metadata/:id", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const metadata = await getLocalVideoMetadata(item.relativePath);
        sendJson(res, { metadata });
    } catch (error) {
        sendError(res, 500, "Failed to get metadata", error.message);
    }
});

app.get("/api/subtitles/:id", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const subtitles = findExternalSubtitleFiles(item.relativePath);

        sendJson(res, {
            itemId: item.id,
            subtitles
        });
    } catch (error) {
        sendError(res, 500, "Failed to load subtitles", error.message);
    }
});

app.get("/api/subtitles/:id/:file", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const fileName = path.basename(req.params.file);
        const subtitles = findExternalSubtitleFiles(item.relativePath);
        const subtitle = subtitles.find((entry) => entry.fileName === fileName);

        if (!subtitle) {
            return sendError(res, 404, "Subtitle file not found");
        }

        const vttText = readSubtitleAsVtt(item.relativePath, fileName);

        res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        res.send(vttText);
    } catch (error) {
        sendError(res, 500, "Failed to serve subtitle", error.message);
    }
});

app.get("/api/debug/item/:id", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);

        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        sendJson(res, { item });
    } catch (error) {
        sendError(res, 500, "Debug lookup failed", error.message);
    }
});

app.get("/api/debug/items", async (req, res) => {
    try {
        await buildLibraryTree({ forceRefresh: true });
        const root = await listFolderContents("");
        sendJson(res, root);
    } catch (error) {
        sendError(res, 500, "Failed to load debug items", error.message);
    }
});

app.get("/api/stream/:id/original", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const filePath = getSafeLibraryAbsolutePath(item.relativePath);
        await handlePathStream(req, res, filePath, getMimeType(filePath));
    } catch (error) {
        sendError(res, 500, "Failed to stream video", error.message);
    }
});

app.get("/api/stream-by-path", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        const filePath = getSafeLibraryAbsolutePath(relativePath);
        await handlePathStream(req, res, filePath, getMimeType(filePath));
    } catch (error) {
        sendError(res, 500, "Failed to stream video", error.message);
    }
});

app.get("/api/stream-by-path-mp4", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");

        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        const mp4Path = getOutputPath(relativePath);

        if (!fs.existsSync(mp4Path)) {
            return sendError(res, 404, "Converted MP4 not found");
        }

        await handlePathStream(req, res, mp4Path, "video/mp4");
    } catch (error) {
        sendError(res, 500, "Failed to stream converted video", error.message);
    }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(config.PORT, () => {
    console.log(`fatik-video-library is running on port ${config.PORT}`);
});
