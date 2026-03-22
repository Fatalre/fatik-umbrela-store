const express = require("express");
const fs = require("fs");
const path = require("path");
const {
    findExternalSubtitleFiles,
    readSubtitleAsVtt
} = require("./lib/subtitles");
const {config, ensureAppDirectories} = require("./lib/config");
const {
    buildLibraryTree,
    listFolderContents,
    findItemById,
    findItemByRelativePath,
    searchItems,
    getContinueWatchingItems
} = require("./lib/scan");
const {
    getLocalVideoMetadata
} = require("./lib/metadata");
const {
    ensurePosterForItem,
    getPosterPathForItem
} = require("./lib/posters");
const {
    loadDatabase,
    saveDatabase,
    getItemState,
    updateItemState
} = require("./lib/db");
const {
    sendJson,
    sendError,
    parseBoolean
} = require("./lib/api-utils");
const {
    getSafeLibraryAbsolutePath
} = require("./lib/paths");
const {
    getMimeType
} = require("./lib/mime");
const {
    buildVariantByPath,
    getVariantPlaylistPath,
    getHlsFilePathByPath
} = require("./lib/hls");

const app = express();

app.use(express.json({limit: "2mb"}));

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

    await buildLibraryTree({forceRefresh: true});
    item = await findItemById(itemId);

    return item;
}

async function findItemByPathOrRefresh(relativePath) {
    let item = await findItemByRelativePath(relativePath);

    if (item) {
        return item;
    }

    await buildLibraryTree({forceRefresh: true});
    item = await findItemByRelativePath(relativePath);

    return item;
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
        sendJson(res, {tree});
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

app.get("/api/search", async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();
        const limit = Number(req.query.limit || 50);
        const items = await searchItems(query, limit);
        sendJson(res, {items});
    } catch (error) {
        sendError(res, 500, "Search failed", error.message);
    }
});

app.get("/api/continue-watching", async (req, res) => {
    try {
        const limit = Number(req.query.limit || 12);
        const items = await getContinueWatching(limit);
        sendJson(res, {items});
    } catch (error) {
        sendError(res, 500, "Failed to load continue watching", error.message);
    }
});

app.post("/api/rescan", async (req, res) => {
    try {
        const tree = await buildLibraryTree({forceRefresh: true});
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
        console.log("ITEM ID:", req.params.id);
        console.log("FOUND ITEM PAGE:", item ? item.relativePath : null);
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

        await buildLibraryTree({forceRefresh: true});

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
        console.log("ITEM ID:", req.params.id);
        console.log("FOUND ITEM PAGE:", item ? item.relativePath : null);
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

        await buildLibraryTree({forceRefresh: true});

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

app.get("/api/stream/:id/original", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        console.log("STREAM ID:", req.params.id);
        console.log("FOUND ITEM:", item ? item.relativePath : null);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const filePath = getSafeLibraryAbsolutePath(item.relativePath);

        if (!fs.existsSync(filePath)) {
            return sendError(res, 404, "Video file not found");
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const contentType = getMimeType(filePath);

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
            res.status(416).set({
                "Content-Range": `bytes */${fileSize}`
            }).end();
            return;
        }

        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(filePath, {start, end});

        res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Type": contentType
        });

        stream.pipe(res);
    } catch (error) {
        sendError(res, 500, "Failed to stream video", error.message);
    }
});

app.post("/api/hls/:id/build", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        await ensureHlsForItem(item);

        sendJson(res, {
            ok: true,
            itemId: item.id,
            masterUrl: `/api/hls/${item.id}/master.m3u8`
        });
    } catch (error) {
        sendError(res, 500, "Failed to build HLS", error.message);
    }
});

app.get("/api/hls/:id/master.m3u8", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        await ensureHlsForItem(item);

        const masterPath = getHlsMasterPath(item);
        if (!fs.existsSync(masterPath)) {
            return sendError(res, 404, "HLS master playlist not found");
        }

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.sendFile(masterPath);
    } catch (error) {
        sendError(res, 500, "Failed to serve HLS master", error.message);
    }
});

app.get("/api/hls/:id/:file", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const fileName = path.basename(req.params.file);
        const filePath = getHlsFilePath(item, fileName);

        if (!fs.existsSync(filePath)) {
            return sendError(res, 404, "HLS file not found");
        }

        if (fileName.endsWith(".m3u8")) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        } else if (fileName.endsWith(".ts")) {
            res.setHeader("Content-Type", "video/mp2t");
        }

        res.sendFile(filePath);
    } catch (error) {
        sendError(res, 500, "Failed to serve HLS file", error.message);
    }
});

app.get("/api/metadata/:id", async (req, res) => {
    try {
        const item = await findItemOrRefresh(req.params.id);
        if (!item) {
            return sendError(res, 404, "Item not found");
        }

        const metadata = await getLocalVideoMetadata(item.relativePath);
        sendJson(res, {metadata});
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

        sendJson(res, {item});
    } catch (error) {
        sendError(res, 500, "Debug lookup failed", error.message);
    }
});

app.get("/api/debug/items", async (req, res) => {
    try {
        await buildLibraryTree({forceRefresh: true});
        const root = await listFolderContents("");
        sendJson(res, root);
    } catch (error) {
        sendError(res, 500, "Failed to load debug items", error.message);
    }
});

app.get("/api/stream-by-path", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        const filePath = getSafeLibraryAbsolutePath(relativePath);

        if (!fs.existsSync(filePath)) {
            return sendError(res, 404, "Video file not found");
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const contentType = getMimeType(filePath);

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
            res.status(416).set({
                "Content-Range": `bytes */${fileSize}`
            }).end();
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
    } catch (error) {
        sendError(res, 500, "Failed to stream video", error.message);
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

/*app.post("/api/hls-by-path/build", async (req, res) => {
    try {
        const relativePath = String(req.body.path || "");
        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        await ensureHlsForPath(relativePath);

        sendJson(res, {
            ok: true,
            masterUrl: `/api/hls-by-path/master?path=${encodeURIComponent(relativePath)}`
        });
    } catch (error) {
        console.error("HLS BUILD ERROR:", error);
        sendError(res, 500, "Failed to build HLS", error.message);
    }
});

app.get("/api/hls-by-path/master", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        await ensureHlsForPath(relativePath);

        const masterPath = getHlsMasterPathByPath(relativePath);
        if (!fs.existsSync(masterPath)) {
            return sendError(res, 404, "HLS master playlist not found");
        }

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.sendFile(masterPath);
    } catch (error) {
        sendError(res, 500, "Failed to serve HLS master", error.message);
    }
});*/

app.get("/api/hls-by-path/file", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        const fileName = String(req.query.file || "");

        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        if (!fileName) {
            return sendError(res, 400, "Missing file");
        }

        const filePath = getHlsFilePathByPath(relativePath, fileName);

        if (!fs.existsSync(filePath)) {
            return sendError(res, 404, "HLS file not found");
        }

        if (fileName.endsWith(".m3u8")) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        } else if (fileName.endsWith(".ts")) {
            res.setHeader("Content-Type", "video/mp2t");
        }

        res.sendFile(filePath);
    } catch (error) {
        sendError(res, 500, "Failed to serve HLS file", error.message);
    }
});

app.post("/api/hls-by-path/build", async (req, res) => {
    try {
        const relativePath = String(req.body.path || "");
        const quality = String(req.body.quality || "720p");

        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        await buildVariantByPath(relativePath, quality);

        sendJson(res, {
            ok: true,
            playlistUrl: `/api/hls-by-path/playlist?path=${encodeURIComponent(relativePath)}&quality=${encodeURIComponent(quality)}`
        });
    } catch (error) {

        sendError(res, 500, "Failed to build HLS", error.message);
    }
});

app.get("/api/hls-by-path/playlist", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        const quality = String(req.query.quality || "");

        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        if (!quality) {
            return sendError(res, 400, "Missing quality");
        }

        await buildVariantByPath(relativePath, quality);

        const playlistPath = getVariantPlaylistPath(relativePath, quality);

        if (!fs.existsSync(playlistPath)) {
            return sendError(res, 404, "HLS playlist not found");
        }

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.sendFile(playlistPath);
    } catch (error) {
        console.error("HLS PLAYLIST ERROR:", error);
        sendError(res, 500, "Failed to serve HLS playlist", error.message);
    }
});

app.get("/api/hls-by-path/file", async (req, res) => {
    try {
        const relativePath = String(req.query.path || "");
        const fileName = String(req.query.file || "");

        if (!relativePath) {
            return sendError(res, 400, "Missing path");
        }

        if (!fileName) {
            return sendError(res, 400, "Missing file");
        }

        const filePath = getHlsFilePathByPath(relativePath, fileName);

        if (!fs.existsSync(filePath)) {
            return sendError(res, 404, "HLS file not found");
        }

        if (fileName.endsWith(".m3u8")) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        } else if (fileName.endsWith(".ts")) {
            res.setHeader("Content-Type", "video/mp2t");
        }

        res.sendFile(filePath);
    } catch (error) {
        console.log("HLS BUILD ERROR:", error);
        sendError(res, 500, "Failed to serve HLS file", error.message);
    }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(config.PORT, () => {
    console.log(`fatik-video-library is running on port ${config.PORT}`);
});