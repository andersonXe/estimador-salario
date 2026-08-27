// Gera public/salary-data.js: médias e índices por categoria, dispersão real (percentis),
// pesos de combinação medidos nas tabelas cruzadas e parâmetros de incerteza amostral.
//
// Uso: npm run build-data
const fs = require("fs");
const path = require("path");
const {
  weightedMeansByColumn,
  overallWeightedMean,
  overallDispersionStats,
  dispersionForColumn,
  dispersionOverall,
} = require("./lib/stats");
const { measureAttenuations } = require("./lib/attenuation");
const { loadSurvey } = require("./lib/load");

const OUT_DIR = path.join(__dirname, "..", "public");
const data = loadSurvey();

const { mean: overallMean, n: totalResponses } = overallWeightedMean(data.raw.salary_by_level);
const overallStats = overallDispersionStats(data.raw.salary_by_level);
const overallDisp = dispersionOverall(data.raw.salary_by_level);

// Corte de amostra: abaixo disso a média da categoria vira ruído. Na prática só filtra as
// listas longas (linguagens, frameworks, áreas) — as dimensões ordinais já são populosas.
const MIN_SAMPLE = 30;

function buildDimension(table, { minSample = MIN_SAMPLE, withPercentiles = false } = {}) {
  const means = weightedMeansByColumn(table);
  return table.columns
    .map((label, colIdx) => ({ label, colIdx, ...means[label] }))
    .filter((o) => o.n >= minSample && o.mean != null)
    .map((o) => {
      const d = dispersionForColumn(table, o.colIdx);
      const entry = {
        label: o.label,
        n: o.n,
        mean: Math.round(o.mean),
        index: +(o.mean / overallMean).toFixed(4),
        // Coeficiente de variação da categoria: define a precisão amostral da sua média
        // (Var(ln média) ≈ CV²/n) e alimenta o intervalo de confiança na interface.
        cv: d.cv != null ? +d.cv.toFixed(3) : null,
      };
      if (withPercentiles && d.p25 && d.p75) {
        // Guardados como razão sobre a média da categoria, para poder aplicar a dispersão
        // observada a uma estimativa combinada.
        entry.p25r = +(d.p25 / o.mean).toFixed(3);
        entry.p50r = +(d.p50 / o.mean).toFixed(3);
        entry.p75r = +(d.p75 / o.mean).toFixed(3);
      }
      return entry;
    });
}

const dimensions = {
  // Nível é a âncora do modelo e guarda a dispersão real observada.
  level: buildDimension(data.raw.salary_by_level, { minSample: 1, withPercentiles: true }),
  experience: buildDimension(data.raw.salary_by_experience, { minSample: 1 }),
  graduation: buildDimension(data.raw.salary_by_graduation, { minSample: 1 }),
  area: buildDimension(data.raw.salary_by_area),
  languages: buildDimension(data.raw.salary_by_languages),
  frameworks: buildDimension(data.frameworks.salary_by_frameworks),
  uf: buildDimension(data.raw.salary_by_brazil_uf),
  workModel: buildDimension(data.raw.salary_by_work_model, { minSample: 1 }),
  sector: buildDimension(data.raw.salary_by_sector, { minSample: 1 }),
  englishLevel: buildDimension(data.raw.salary_by_english_level, { minSample: 1 }),
  foreignJob: buildDimension(data.raw.salary_by_foreign_job, { minSample: 1 }),
};

const { weights, detail, fallback, unidentified } = measureAttenuations(
  data.raw, data.crosstabs, data.frameworksCross, data.levelXWorkModel, data.frameworks
);

// Edição anterior (2025), só para o indicador de tendência.
const { mean: overallMean2025 } = overallWeightedMean(data.raw2025.salary_by_level);
function buildTrend(table) {
  const means = weightedMeansByColumn(table);
  const out = {};
  table.columns.forEach((label) => {
    const v = means[label];
    if (v && v.n >= MIN_SAMPLE && v.mean) out[label] = Math.round(v.mean);
  });
  return out;
}

const output = {
  meta: {
    source: "Pesquisa Salarial de Programadores 2026 — Código Fonte TV",
    sourceUrl: "https://pesquisa.codigofonte.com.br/2026",
    collectedAt: "23/02/2026 a 09/06/2026",
    totalResponses,
    overallMean: Math.round(overallMean),
    overallCv: +overallStats.cv.toFixed(3),
    overallP25r: +(overallDisp.p25 / overallMean).toFixed(3),
    overallP50r: +(overallDisp.p50 / overallMean).toFixed(3),
    overallP75r: +(overallDisp.p75 / overallMean).toFixed(3),
    minSample: MIN_SAMPLE,
    generatedAt: new Date().toISOString().slice(0, 10),
  },
  weights,
  // Dimensões sem cruzamento publicado: o efeito continua confundido com senioridade.
  unidentified,
  dimensions,
  trend2025: {
    overallMean: Math.round(overallMean2025),
    level: buildTrend(data.raw2025.salary_by_level),
    workModel: buildTrend(data.raw2025.salary_by_work_model),
    uf: buildTrend(data.raw2025.salary_by_brazil_uf),
    languages: buildTrend(data.raw2025.salary_by_languages),
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "salary-data.json"), JSON.stringify(output));
fs.writeFileSync(path.join(OUT_DIR, "salary-data.js"), "window.SALARY_DATA = " + JSON.stringify(output) + ";");

const size = fs.statSync(path.join(OUT_DIR, "salary-data.js")).size;
console.log(`Média geral: R$ ${Math.round(overallMean).toLocaleString("pt-BR")} | ${totalResponses.toLocaleString("pt-BR")} respostas | CV ${overallStats.cv.toFixed(3)}`);
console.log(`Mediana: R$ ${Math.round(overallDisp.p50).toLocaleString("pt-BR")} | IQR R$ ${Math.round(overallDisp.p25).toLocaleString("pt-BR")}–${Math.round(overallDisp.p75).toLocaleString("pt-BR")}`);
console.log("\nPesos medidos (atenuação após controlar por nível):");
Object.entries(detail).forEach(([k, d]) => {
  console.log(`  ${k.padEnd(12)} ${weights[k].toFixed(3)}  R²=${d.r2 != null ? d.r2.toFixed(2) : "n/a"}  ${d.method}`);
});
console.log(`  ${"(demais)".padEnd(12)} ${fallback.toFixed(3)}  média das medições — ${unidentified.join(", ")}`);
console.log("\nDimensões:", Object.keys(dimensions).map((k) => `${k}(${dimensions[k].length})`).join(", "));
console.log(`Gerado: public/salary-data.js (${(size / 1024).toFixed(1)} KB)`);
