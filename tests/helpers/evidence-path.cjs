const { resolve } = require('node:path');
const repository = resolve(__dirname, '../..');
// One root for generated screenshots and reports, including multi-process runners.
exports.evidencePath = (...parts) => resolve(repository, process.env.WEFTMATE_EVIDENCE_DIR || '.local/evidence', ...parts);
