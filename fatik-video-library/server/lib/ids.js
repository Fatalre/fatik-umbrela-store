const crypto = require("crypto");

function createStableId(input) {
    return crypto.createHash("sha1").update(String(input)).digest("hex");
}

module.exports = {
    createStableId
};