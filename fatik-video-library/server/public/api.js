async function request(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json"
        },
        ...options
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
        if (contentType.includes("application/json")) {
            const data = await response.json();
            throw new Error(data.error || "Request failed");
        }

        throw new Error(`Request failed with status ${response.status}`);
    }

    if (contentType.includes("application/json")) {
        return response.json();
    }

    return response.text();
}

export const api = {
    async getTree() {
        const data = await request("/api/tree");
        return data.tree;
    },

    async getFolder(folderPath = "") {
        return request(`/api/folder?path=${encodeURIComponent(folderPath)}`);
    },

    async getItem(itemId) {
        const data = await request(`/api/item/${encodeURIComponent(itemId)}`);
        return data.item;
    },

    async search(query) {
        const data = await request(`/api/search?q=${encodeURIComponent(query)}`);
        return data.items;
    },

    async rescan() {
        return request("/api/rescan", {
            method: "POST",
            body: JSON.stringify({})
        });
    },

    async setWatched(itemId, watched) {
        return request(`/api/item/${encodeURIComponent(itemId)}/watched`, {
            method: "POST",
            body: JSON.stringify({ watched })
        });
    },

    async saveProgress(itemId, position, duration) {
        return request(`/api/item/${encodeURIComponent(itemId)}/progress`, {
            method: "POST",
            body: JSON.stringify({ position, duration })
        });
    },

    getPosterUrl(itemId) {
        return `/api/poster/${encodeURIComponent(itemId)}`;
    },

    async getSubtitles(itemId) {
        const data = await request(`/api/subtitles/${encodeURIComponent(itemId)}`);
        return data.subtitles;
    },

    async getContinueWatching(limit = 12) {
        const data = await request(`/api/continue-watching?limit=${encodeURIComponent(limit)}`);
        return data.items;
    },

    async getItemByPath(relativePath) {
        const data = await request(`/api/item-by-path?path=${encodeURIComponent(relativePath)}`);
        return data.item;
    },

    async getMediaSource(relativePath) {
        return request(`/api/media-source?path=${encodeURIComponent(relativePath)}`);
    },

    async prepareTranscode(relativePath) {
        return request("/api/transcode/prepare", {
            method: "POST",
            body: JSON.stringify({ path: relativePath })
        });
    },

    getOriginalStreamUrlByPath(relativePath) {
        return `/api/stream-by-path?path=${encodeURIComponent(relativePath)}`;
    },

    getMp4StreamUrlByPath(relativePath) {
        return `/api/stream-by-path-mp4?path=${encodeURIComponent(relativePath)}`;
    }
};
