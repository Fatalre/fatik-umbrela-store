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
const {
    getLocalVideoMetadata
} = require("./metadata");
const {
    loadDatabase,
    getItemState
} = require("./db");

let cache = {
    builtAt: 0,
    tree: null,
    items: []
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

function createItemFromFile(relativePath, metadata, fileStat) {
    const itemId = createStableId(`video:${relativePath}`);
    const db = loadDatabase();

    return {
        id: itemId,
        type: "video",
        title: metadata.title,
        kind: metadata.kind,
        relativePath,
        parentPath: path.dirname(relativePath).replace(/\\/g, "/") === "."
            ? ""
            : path.dirname(relativePath).replace(/\\/g, "/"),
        fileName: path.basename(relativePath),
        sizeBytes: Number(fileStat.size || 0),
        metadata,
        state: getItemState(db, itemId)
    };
}

async function buildFolderNodeRecursive(relativePath = "") {
    const absolutePath = getSafeLibraryAbsolutePath(relativePath);
    const dirName = relativePath ? path.basename(relativePath) : "Library";
    const node = createFolderNode(relativePath, dirName);

    const entries = readDirSafe(absolutePath).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const childRelativePath = normalizeRelativeLibraryPath(
            path.join(relativePath, entry.name).replace(/\\/g, "/")
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

    return node;
}

async function buildItemsIndex() {
    const items = [];

    walkDirectoryRecursive(config.LIBRARY_DIR, (absoluteFilePath) => {
        const relativePath = getRelativePathFromAbsolute(absoluteFilePath);

        if (!isVideoFile(relativePath)) {
            return;
        }

        items.push(relativePath);
    });

    const enrichedItems = [];

    for (const relativePath of items) {
        const absolutePath = getSafeLibraryAbsolutePath(relativePath);
        const fileStat = statSafe(absolutePath);
        if (!fileStat || !fileStat.isFile()) continue;

        let metadata;
        try {
            metadata = await getLocalVideoMetadata(relativePath);
        } catch {
            metadata = {
                title: path.basename(relativePath, path.extname(relativePath)),
                kind: "movie",
                durationSeconds: 0,
                sizeBytes: Number(fileStat.size || 0),
                resolution: null,
                videoCodec: null,
                audioTracks: [],
                subtitleTracks: []
            };
        }

        enrichedItems.push(createItemFromFile(relativePath, metadata, fileStat));
    }

    return enrichedItems.sort((a, b) => a.title.localeCompare(b.title));
}

async function buildLibraryTree(options = {}) {
    const shouldRefresh = options.forceRefresh || !cache.tree;

    if (!shouldRefresh) {
        return cache.tree;
    }

    const tree = await buildFolderNodeRecursive("");
    const items = await buildItemsIndex();

    cache = {
        builtAt: Date.now(),
        tree,
        items
    };

    return tree;
}

async function ensureCacheReady() {
    if (!cache.tree) {
        await buildLibraryTree({ forceRefresh: true });
    }
}

async function listFolderContents(folderPath = "") {
    await ensureCacheReady();

    const normalizedFolderPath = normalizeRelativeLibraryPath(folderPath);
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
            const childAbsolutePath = getSafeLibraryAbsolutePath(childRelativePath);
            const childEntries = readDirSafe(childAbsolutePath);
            const videoCount = childEntries.filter((item) => item.isFile() && isVideoFile(item.name)).length;

            folders.push({
                id: createStableId(`folder:${childRelativePath}`),
                type: "folder",
                name: entry.name,
                relativePath: childRelativePath,
                videoCount
            });
            continue;
        }

        if (entry.isFile() && isVideoFile(entry.name)) {
            const item = cache.items.find((value) => value.relativePath === childRelativePath);
            if (item) videos.push(item);
        }
    }

    return {
        folder: {
            name: normalizedFolderPath ? path.basename(normalizedFolderPath) : "Library",
            relativePath: normalizedFolderPath
        },
        folders,
        videos
    };
}

async function findItemById(itemId) {
    await ensureCacheReady();
    return cache.items.find((item) => item.id === itemId) || null;
}

async function searchItems(query, limit = 50) {
    await ensureCacheReady();

    const normalized = String(query || "").trim().toLowerCase();
    if (!normalized) return [];

    return cache.items
        .filter((item) =>
            item.title.toLowerCase().includes(normalized) ||
            item.relativePath.toLowerCase().includes(normalized)
        )
        .slice(0, limit);
}

module.exports = {
    buildLibraryTree,
    listFolderContents,
    findItemById,
    searchItems
};