// Carrega todos os snapshots da pesquisa usados pelos scripts de build.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));

function loadSurvey() {
  return {
    raw: read("survey-2026-raw.json"),
    frameworks: read("survey-2026-frameworks.json"),
    crosstabs: read("survey-2026-crosstabs.json"),
    frameworksCross: read("survey-2026-crosstabs-frameworks.json"),
    levelXWorkModel: read("survey-2026-level-x-workmodel.json"),
    raw2025: read("survey-2025-raw.json"),
  };
}

module.exports = { loadSurvey, DATA_DIR };
