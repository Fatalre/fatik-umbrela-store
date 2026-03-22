function sendJson(res, data, status = 200) {
    res.status(status).json(data);
}

function sendError(res, status, message, details = null) {
    res.status(status).json({
        ok: false,
        error: message,
        details
    });
}

function parseBoolean(value) {
    return value === true || value === "true" || value === 1 || value === "1";
}

module.exports = {
    sendJson,
    sendError,
    parseBoolean
};