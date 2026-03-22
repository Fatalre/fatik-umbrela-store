const fs = require("fs");
const { config } = require("./config");

function loadDatabase() {
    try {
        const raw = fs.readFileSync(config.DB_PATH, "utf8");
        const parsed = JSON.parse(raw);

        if (!parsed.itemStates || typeof parsed.itemStates !== "object") {
            parsed.itemStates = {};
        }

        return parsed;
    } catch {
        return {
            version: 1,
            itemStates: {}
        };
    }
}

function saveDatabase(db) {
    db.generatedAt = new Date().toISOString();
    fs.writeFileSync(config.DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function getItemState(db, itemId) {
    return db.itemStates[itemId] || {
        watched: false,
        progress: {
            position: 0,
            duration: 0,
            updatedAt: null
        }
    };
}

function updateItemState(db, itemId, patch) {
    const current = getItemState(db, itemId);

    db.itemStates[itemId] = {
        ...current,
        ...patch,
        progress: {
            ...current.progress,
            ...(patch.progress || {})
        }
    };
}

module.exports = {
    loadDatabase,
    saveDatabase,
    getItemState,
    updateItemState
};