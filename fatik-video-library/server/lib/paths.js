const path = require("path");
const { config } = require("./config");

function normalizeRelativeLibraryPath(relativePath = "") {
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
    return normalized === "." ? "" : normalized;
}

function getSafeLibraryAbsolutePath(relativePath = "") {
    const normalized = normalizeRelativeLibraryPath(relativePath);
    const absolute = path.resolve(config.LIBRARY_DIR, normalized);

    const libraryRoot = path.resolve(config.LIBRARY_DIR);
    if (absolute !== libraryRoot && !absolute.startsWith(`${libraryRoot}${path.sep}`)) {
        throw new Error("Path escapes library root");
    }

    return absolute;
}

function getRelativePathFromAbsolute(absolutePath) {
    return path.relative(config.LIBRARY_DIR, absolutePath).replace(/\\/g, "/");
}

module.exports = {
    normalizeRelativeLibraryPath,
    getSafeLibraryAbsolutePath,
    getRelativePathFromAbsolute
};