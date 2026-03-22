const mime = require("mime-types");

function getMimeType(filePath) {
    return mime.lookup(filePath) || "application/octet-stream";
}

module.exports = {
    getMimeType
};