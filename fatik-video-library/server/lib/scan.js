const fs = require("fs");
const path = require("path");

const { config } = require("./config");
const { createStableId } = require("./ids");
const {
    readDirSafe,
    walkDirectoryRecursive,
    isVideoFile,
    statSafe
} = require("./fs-utils");
const {
    getSafeLibraryAbsolutePath,
    getRelativePathFromAbsolute,
    normalizeRelativeLibraryPath
} = require("./paths");
const { getLocalVideoMetadata } = require("./metadata");
const { loadDatabase, getItemState } = require("./db");
const { findExternalSubtitleFiles } = require("./subtitles");

const cache = {
    treeBuiltAt: 0,
    tree: null,
    folderNodes: new Map(),
    folderListings: new Map(),
    itemByRelativePath: new Map(),
    itemById: new Map(),
    allItemsIndexed: false
};

function createFolderNode(relativePath, name) {
    return {
        id: createStableId(`folder:${relativePath}`),
        type: "folder",
        name,
        relativePath,
        children: [],
        folderCount: 0,
        videoCount: 0
    };
}

function createFallbackMetadata(relativePath, fileStat) {
    return {
        title: path.basename(relativePath, path.extname(relativePath)),
        kind: /s\d{1,2}e\d{1,2}/i.test(relativePath) ? "episode" : "movie",
        durationSeconds: 0,
        sizeBytes: Number(fileStat?.size || 0),
        resolution: null,
        videoCodec: null,
        audioTracks: [],
        subtitleTracks: []
    };
}

async function buildMetadataForFile(relativePath) {
    const normalizedPath = normalizeRelativeLibraryPath(relativePath);

    if (cache.itemByRelativePath.has(normalizedPath)) {
        return cache.itemByRelativePath.get(normalizedPath);
    }

    const absolutePath = getSafeLibraryAbsolutePath(normalizedPath);
    const fileStat = statSafe(absolutePath);

    if (!fileStat || !fileStat.isFile()) {
        return null;
    }

    let metadata;
    try {
        metadata = await getLocalVideoMetadata(normalizedPath);
    } catch {
        metadata = createFallbackMetadata(normalizedPath, fileStat);
    }

    const itemId = createStableId(`video:${normalizedPath}`);
    const db = loadDatabase();

    const item = {
        id: itemId,
        type: "video",
        title: metadata.title,
        kind: metadata.kind,
        relativePath: normalizedPath,
        parentPath: path.dirname(normalizedPath).replace(/\\/g, "/") === "."
            ? ""
            : path.dirname(normalizedPath).replace(/\\/g, "/"),
        fileName: path.basename(normalizedPath),
        sizeBytes: Number(fileStat.size || 0),
        metadata,
        subtitles: findExternalSubtitleFiles(normalizedPath),
        state: getItemState(db, itemId)
    };

    cache.itemByRelativePath.set(normalizedPath, item);
    cache.itemById.set(itemId, item);

    return item;
}

async function buildFolderNodeRecursive(relativePath = "") {
    const normalizedPath = normalizeRelativeLibraryPath(relativePath);
    const absolutePath = getSafeLibraryAbsolutePath(normalizedPath);
    const dirName = normalizedPath ? path.basename(normalizedPath) : "Library";
    const node = createFolderNode(normalizedPath, dirName);

    const entries = readDirSafe(absolutePath).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const childRelativePath = normalizeRelativeLibraryPath(
            path.join(normalizedPath, entry.name).replace(/\\/g, "/")
        );

        if (entry.isDirectory()) {
            const childNode = await buildFolderNodeRecursive(childRelativePath);
            node.children.push(childNode);
            node.folderCount += 1 + childNode.folderCount;
            node.videoCount += childNode.videoCount;
            continue;
        }

        if (entry.isFile() && isVideoFile(entry.name)) {
            node.videoCount += 1;
        }
    }

    cache.folderNodes.set(normalizedPath, node);
    return node;
}

async function buildLibraryTree(options = {}) {
    const shouldRefresh = options.forceRefresh || !cache.tree;

    if (!shouldRefresh) {
        return cache.tree;
    }

    cache.folderNodes.clear();
    cache.folderListings.clear();

    const tree = await buildFolderNodeRecursive("");

    cache.tree = tree;
    cache.treeBuiltAt = Date.now();

    return tree;
}

async function ensureTreeReady() {
    if (!cache.tree) {
        await buildLibraryTree({ forceRefresh: true });
    }
}

function buildFolderListingCacheKey(folderPath) {
    return normalizeRelativeLibraryPath(folderPath);
}

async function listFolderContents(folderPath = "", options = {}) {
    await ensureTreeReady();

    const normalizedFolderPath = normalizeRelativeLibraryPath(folderPath);
    const cacheKey = buildFolderListingCacheKey(normalizedFolderPath);

    if (!options.forceRefresh && cache.folderListings.has(cacheKey)) {
        return cache.folderListings.get(cacheKey);
    }

    const absolutePath = getSafeLibraryAbsolutePath(normalizedFolderPath);

    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
        throw new Error("Folder not found");
    }

    const entries = readDirSafe(absolutePath).sort((a, b) => a.name.localeCompare(b.name));

    const folders = [];
    const videos = [];

    for (const entry of entries) {
        const childRelativePath = normalizeRelativeLibraryPath(
            path.join(normalizedFolderPath, entry.name).replace(/\\/g, "/")
        );

        if (entry.isDirectory()) {
            const childNode = cache.folderNodes.get(childRelativePath);

            folders.push({
                id: createStableId(`folder:${childRelativePath}`),
                type: "folder",
                name: entry.name,
                relativePath: childRelativePath,
                videoCount: childNode ? childNode.videoCount : 0
            });
            continue;
        }

        if (entry.isFile() && isVideoFile(entry.name)) {
            const item = await buildMetadataForFile(childRelativePath);
            if (item) {
                videos.push(item);
            }
        }
    }

    const result = {
        folder: {
            name: normalizedFolderPath ? path.basename(normalizedFolderPath) : "Library",
            relativePath: normalizedFolderPath
        },
        folders,
        videos
    };

    cache.folderListings.set(cacheKey, result);

    return result;
}

async function indexAllItemsIfNeeded() {
    if (cache.allItemsIndexed) {
        return;
    }

    const relativePaths = [];

    walkDirectoryRecursive(config.LIBRARY_DIR, (absoluteFilePath) => {
        const relativePath = getRelativePathFromAbsolute(absoluteFilePath);

        if (!isVideoFile(relativePath)) {
            return;
        }

        relativePaths.push(relativePath);
    });

    for (const relativePath of relativePaths) {
        await buildMetadataForFile(relativePath);
    }

    cache.allItemsIndexed = true;
}

async function findItemById(itemId) {
    if (cache.itemById.has(itemId)) {
        return cache.itemById.get(itemId);
    }

    await indexAllItemsIfNeeded();
    return cache.itemById.get(itemId) || null;
}

async function findItemByRelativePath(relativePath) {
    const normalized = normalizeRelativeLibraryPath(relativePath);

    if (cache.itemByRelativePath.has(normalized)) {
        return cache.itemByRelativePath.get(normalized);
    }

    const item = await buildMetadataForFile(normalized);
    return item || null;
}

async function searchItems(query, limit = 50) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) return [];

    await indexAllItemsIfNeeded();

    return Array.from(cache.itemById.values())
        .filter((item) =>
            item.title.toLowerCase().includes(normalizedQuery) ||
            item.relativePath.toLowerCase().includes(normalizedQuery)
        )
        .slice(0, limit);
}

async function getContinueWatchingItems(limit = 12) {
    await indexAllItemsIfNeeded();

    return Array.from(cache.itemById.values())
        .filter((item) => {
            const progress = item.state?.progress;
            const duration = Number(progress?.duration || item.metadata?.durationSeconds || 0);
            const position = Number(progress?.position || 0);

            if (!Number.isFinite(position) || position <= 0) return false;
            if (!Number.isFinite(duration) || duration <= 0) return false;
            if (position >= duration - 30) return false;
            if (item.state?.watched) return false;

            return true;
        })
        .sort((a, b) => {
            const aTime = new Date(a.state?.progress?.updatedAt || 0).getTime();
            const bTime = new Date(b.state?.progress?.updatedAt || 0).getTime();
            return bTime - aTime;
        })
        .slice(0, limit);
}

module.exports = {
    buildLibraryTree,
    listFolderContents,
    findItemById,
    findItemByRelativePath,
    searchItems,
    getContinueWatchingItems
};