// Ajusta a regressão log-linear e imprime um relatório de diagnóstico.
// Uso: npm run fit
const { loadSurvey } = require("./lib/load");
const { buildModel } = require("./lib/design");
const { fit, chooseLambda, predict, effectPct, coefficientCovariance, predictionSE } = require("./lib/fit");
const { overallDispersionStats } = require("./lib/stats");
const { OFFICIAL_LEVEL } = require("./lib/official");

const data = loadSurvey();
const model = buildModel(data);
const disp = overallDispersionStats(data.raw.salary_by_level);

console.log("=== Regressão log-linear ponderada sobre células agregadas ===\n");

const byKind = {};
model.cells.forEach((c) => {
  const k = c.kind.split(":")[0];
  byKind[k] = (byKind[k] || 0) + 1;
});
console.log(`  ${model.cells.length} células, ${model.p} colunas (intercepto + ${model.p - 1} efeitos)`);
console.log("  Por tipo:", Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(", "));
console.log(`  CV da distribuição salarial: ${disp.cv.toFixed(3)} (média R$ ${disp.mean.toFixed(0)}, dp R$ ${disp.sd.toFixed(0)})`);

const cv = chooseLambda(model, OFFICIAL_LEVEL);
console.log("\n  Escolha de λ (âncora = pior desvio nos níveis; hold-out = nível × contratação):");
console.log("      λ    âncora%   hold-out%   soma");
cv.ranked.slice(0, 6).forEach((s) =>
  console.log(
    `    ${String(s.lambda).padStart(4)}   ${s.anchorWorst.toFixed(2).padStart(7)}   ${s.holdout.toFixed(2).padStart(9)}   ${s.score.toFixed(2).padStart(5)}`
  )
);
console.log(`  λ escolhido: ${cv.best}`);

const f = fit(model, cv.best);
console.log(`\n  Convergiu em ${f.iterations} iterações | R² ponderado ${f.r2.toFixed(4)}`);
console.log(`  Intercepto: R$ ${Math.exp(f.intercept).toFixed(0)} (média geral observada: R$ ${model.overall.mean.toFixed(0)})`);
console.log(`  Smearing (correção log->nível): ${f.smearing.toFixed(5)}`);

console.log("\n  Âncora — prever só o nível vs. média oficial publicada:");
Object.entries(OFFICIAL_LEVEL).forEach(([lvl, official]) => {
  const est = predict(model, f, { level: lvl });
  const err = ((est - official) / official) * 100;
  console.log(
    `    ${lvl.padEnd(44)} oficial ${official.toFixed(0).padStart(6)} | modelo ${est.toFixed(0).padStart(6)} | ${err >= 0 ? "+" : ""}${err.toFixed(2)}%`
  );
});
const semFiltro = predict(model, f, {});
console.log(
  `    ${"(sem filtros)".padEnd(44)} oficial ${model.overall.mean.toFixed(0).padStart(6)} | modelo ${semFiltro.toFixed(0).padStart(6)} | ${(((semFiltro - model.overall.mean) / model.overall.mean) * 100).toFixed(2)}%`
);

const cov = coefficientCovariance(model, f, null, disp.cv);
console.log("\n  Incerteza AMOSTRAL da estimativa (IC95 da média — não a variação entre pessoas):");
[
  { label: "sem filtros", a: {} },
  { label: "Sênior", a: { level: "Sênior" } },
  { label: "Sênior + Java + SP + PJ", a: { level: "Sênior", languages: "Java", uf: "São Paulo (SP)", workModel: "PJ" } },
  { label: "Júnior + Games (n=37)", a: { level: "Júnior", area: "Games" } },
].forEach((s) => {
  const se = predictionSE(model, cov, s.a);
  const est = predict(model, f, s.a);
  console.log(
    `    ${s.label.padEnd(28)} R$ ${est.toFixed(0).padStart(6)}  ±${(se * 1.96 * 100).toFixed(1)}%  (R$ ${(est * Math.exp(-1.96 * se)).toFixed(0)}–${(est * Math.exp(1.96 * se)).toFixed(0)})`
  );
});

console.log("\n  Efeitos estimados (0% = média da dimensão):");
model.dims.forEach((d) => {
  const ranked = d.cats
    .map((c) => ({ label: c.label, pct: effectPct(model, f, d.key, c.label), n: c.n }))
    .sort((a, b) => b.pct - a.pct);
  const flag = d.identified ? "" : "   [SEM cruzamento publicado - efeito NÃO desconfundido]";
  console.log(`\n    ${d.key}${flag}`);
  const show = ranked.length > 6 ? ranked.slice(0, 3).concat([null], ranked.slice(-3)) : ranked;
  show.forEach((r) => {
    if (!r) return console.log("      …");
    console.log(`      ${r.label.padEnd(42)} ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1).padStart(6)}%   n=${r.n}`);
  });
});
