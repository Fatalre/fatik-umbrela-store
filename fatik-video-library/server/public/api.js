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
            body: JSON.stringify({watched})
        });
    },

    async saveProgress(itemId, position, duration) {
        return request(`/api/item/${encodeURIComponent(itemId)}/progress`, {
            method: "POST",
            body: JSON.stringify({position, duration})
        });
    },

    async buildHls(itemId) {
        return request(`/api/hls/${encodeURIComponent(itemId)}/build`, {
            method: "POST",
            body: JSON.stringify({})
        });
    },

    getPosterUrl(itemId) {
        return `/api/poster/${encodeURIComponent(itemId)}`;
    },

    getOriginalStreamUrl(itemId) {
        return `/api/stream/${encodeURIComponent(itemId)}/original`;
    },

    getHlsMasterUrl(itemId) {
        return `/api/hls/${encodeURIComponent(itemId)}/master.m3u8`;
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

    getOriginalStreamUrlByPath(relativePath) {
        return `/api/stream-by-path?path=${encodeURIComponent(relativePath)}`;
    },
};