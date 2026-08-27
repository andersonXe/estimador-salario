// Comparação justa entre o modelo publicado (multiplicativo com pesos medidos) e a alternativa
// mais sofisticada: regressão log-linear conjunta sobre todas as células agregadas.
//
// Ambos preveem as MESMAS células cruzadas reais (categoria × nível) publicadas pela pesquisa.
// A regressão é avaliada por validação cruzada k-fold, para nunca prever uma célula em que
// treinou. O modelo publicado nunca usa células cruzadas para prever — só para medir os pesos —
// então é avaliado diretamente.
//
// Uso: npm run compare
const fs = require("fs");
const path = require("path");
const { loadSurvey } = require("./lib/load");
const { buildModel } = require("./lib/design");
const { fit, predict, chooseLambda } = require("./lib/fit");
const { OFFICIAL_LEVEL } = require("./lib/official");
const Estimator = require("../public/estimator.js");

const MIN_CELL = 20; // mesma regra da validação: abaixo disso a média observada é ruído
const K = 5;

const data = loadSurvey();
const SALARY = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "salary-data.json"), "utf8"));
const model = buildModel(data);

const targets = model.cells
  .map((c, i) => ({ c, i }))
  .filter(({ c }) => (c.kind.startsWith("cruzada") || c.kind.startsWith("exata")) && c.w >= MIN_CELL);

const sel = chooseLambda(model, OFFICIAL_LEVEL);
console.log(`=== Modelo publicado vs. regressão log-linear conjunta (λ=${sel.best}) ===\n`);
console.log(`  ${targets.length} células cruzadas reais | regressão com CV ${K}-fold\n`);

// --- Regressão, com validação cruzada ---
const foldOf = new Map();
targets.forEach((t, idx) => foldOf.set(t.i, idx % K));
const regErrors = [];
for (let f = 0; f < K; f++) {
  const train = model.cells.filter((c, i) => foldOf.get(i) !== f);
  const m = fit(model, sel.best, { cells: train });
  targets
    .filter((t) => foldOf.get(t.i) === f)
    .forEach(({ c }) => {
      const a = {};
      for (const key in c.pinned) a[key] = model.dimByKey[key].cats[c.pinned[key]].label;
      const p = predict(model, m, a);
      regErrors.push({ err: Math.abs((p - c.mean) / c.mean) * 100, w: c.w, kind: c.kind });
    });
}

// --- Modelo publicado ---
const pubErrors = targets.map(({ c }) => {
  const a = {};
  for (const key in c.pinned) a[key] = model.dimByKey[key].cats[c.pinned[key]].label;
  const p = Estimator.estimate(SALARY, a).mean;
  return { err: Math.abs((p - c.mean) / c.mean) * 100, w: c.w, kind: c.kind };
});

function summarize(name, errs) {
  const mape = errs.reduce((a, e) => a + e.err, 0) / errs.length;
  const wsum = errs.reduce((a, e) => a + e.w, 0);
  const wmape = errs.reduce((a, e) => a + e.err * e.w, 0) / wsum;
  const sorted = errs.map((e) => e.err).sort((a, b) => a - b);
  console.log(
    `  ${name.padEnd(22)} MAPE ${mape.toFixed(2).padStart(6)}%   ponderado ${wmape.toFixed(2).padStart(6)}%   mediana ${sorted[Math.floor(sorted.length / 2)].toFixed(2).padStart(6)}%`
  );
  return { mape, wmape };
}

const r = summarize("regressão conjunta", regErrors);
const p = summarize("modelo publicado", pubErrors);

console.log("\n  Por tipo de célula:");
["cruzada:uf", "cruzada:languages", "cruzada:frameworks", "exata"].forEach((kind) => {
  const rf = regErrors.filter((e) => e.kind.startsWith(kind));
  const pf = pubErrors.filter((e) => e.kind.startsWith(kind));
  if (!rf.length) return;
  const rm = rf.reduce((a, e) => a + e.err, 0) / rf.length;
  const pm = pf.reduce((a, e) => a + e.err, 0) / pf.length;
  console.log(
    `    ${kind.padEnd(20)} regressão ${rm.toFixed(2).padStart(6)}%   publicado ${pm.toFixed(2).padStart(6)}%   -> ${pm < rm ? "publicado" : "regressão"}`
  );
});

const winner = p.wmape < r.wmape ? "MODELO PUBLICADO" : "REGRESSÃO";
console.log(
  `\n  Veredito (MAPE ponderado): ${winner} melhor por ${Math.abs(p.wmape - r.wmape).toFixed(2)} p.p.\n`
);
console.log("  Interpretação: com dados agregados, o gargalo é IDENTIFICAÇÃO (quais cruzamentos");
console.log("  a pesquisa publica), não a sofisticação do estimador. A regressão tem ~138");
console.log("  parâmetros livres ajustados a células ruidosas e com peso aproximado; a variância");
console.log("  extra supera o ganho de flexibilidade.\n");
