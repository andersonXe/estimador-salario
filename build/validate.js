// Bateria de validação do modelo que é efetivamente publicado (public/estimator.js).
// Sai com código 1 se qualquer teste falhar.
//
// Uso: npm run validate
const fs = require("fs");
const path = require("path");
const { loadSurvey } = require("./lib/load");
const { weightedMeansByColumn } = require("./lib/stats");
const { OFFICIAL_LEVEL, OFFICIAL_MEANS } = require("./lib/official");
const Estimator = require("../public/estimator.js");

const LIMITS = {
  mape: 0.05,        // reprodução das médias oficiais a partir dos pontos médios de faixa
  anchorLevel: 0.5,  // desvio ao prever um nível isolado (peso 1 => tem que bater)
  overall: 0.5,      // desvio ao prever sem nenhum filtro
  crossCells: 8.0,   // erro médio em cruzamentos de duas dimensões com amostra suficiente
  deconfGap: 15.0,   // afastamento máximo aceitável entre estimativa desconfundida e média bruta
};

// Tamanho mínimo estimado de uma célula cruzada para entrar na avaliação. Abaixo disso a média
// observada é ruído (há células com 1–2 respondentes) e nenhum modelo consegue prevê-la.
const MIN_CELL = 20;

const data = loadSurvey();
const DATA_PATH = path.join(__dirname, "..", "public", "salary-data.json");
if (!fs.existsSync(DATA_PATH)) {
  console.error("  public/salary-data.json não existe — rode `npm run build-data` primeiro.");
  process.exit(1);
}
const SALARY = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

let failed = false;
const fail = (msg) => {
  console.error("  FALHOU: " + msg);
  failed = true;
};
const est = (sel) => Estimator.estimate(SALARY, sel);

// ---------------------------------------------------------------------------
console.log("=== 1. Pontos médios de faixa vs. médias oficiais publicadas ===\n");

const TABLES = {
  salary_by_level: data.raw.salary_by_level,
  salary_by_work_model: data.raw.salary_by_work_model,
  salary_by_brazil_uf: data.raw.salary_by_brazil_uf,
  salary_by_languages: data.raw.salary_by_languages,
  salary_by_frameworks: data.frameworks.salary_by_frameworks,
};

const errors = [];
Object.entries(OFFICIAL_MEANS).forEach(([tableName, published]) => {
  const computed = weightedMeansByColumn(TABLES[tableName]);
  Object.entries(published).forEach(([label, pubMean]) => {
    const got = computed[label] && computed[label].mean;
    if (got == null) return fail(`${tableName} / ${label} ausente nos dados locais`);
    errors.push({ label, pubMean, got, errPct: ((got - pubMean) / pubMean) * 100 });
  });
});
const mape = errors.reduce((a, e) => a + Math.abs(e.errPct), 0) / errors.length;
[...errors].sort((a, b) => Math.abs(b.errPct) - Math.abs(a.errPct)).slice(0, 3).forEach((e) =>
  console.log(
    `    ${e.label.padEnd(38)} oficial ${e.pubMean.toFixed(2).padStart(9)} | calc ${e.got.toFixed(2).padStart(9)} | ${e.errPct >= 0 ? "+" : ""}${e.errPct.toFixed(3)}%`
  )
);
console.log(`\n  ${errors.length} comparações | MAPE ${mape.toFixed(4)}%  (limite ${LIMITS.mape}%)`);
if (mape > LIMITS.mape) fail(`MAPE ${mape.toFixed(4)}% acima do limite`);

// ---------------------------------------------------------------------------
console.log("=== 2. Âncora: nível isolado e média geral ===\n");

// O nível tem peso 1 (é a âncora do modelo), então prever só o nível TEM que reproduzir a
// média oficial daquele nível.
let anchorLevel = 0;
Object.entries(OFFICIAL_LEVEL).forEach(([lvl, official]) => {
  const err = ((est({ level: lvl }).mean - official) / official) * 100;
  anchorLevel = Math.max(anchorLevel, Math.abs(err));
  console.log(`    ${lvl.padEnd(44)} ${err >= 0 ? "+" : ""}${err.toFixed(2)}%`);
});
const overallErr = Math.abs((est({}).mean - SALARY.meta.overallMean) / SALARY.meta.overallMean) * 100;
console.log(`\n  Pior desvio nos níveis: ${anchorLevel.toFixed(2)}% (limite ${LIMITS.anchorLevel}%)`);
console.log(`  Sem filtros: ${overallErr.toFixed(2)}% (limite ${LIMITS.overall}%)`);
if (anchorLevel > LIMITS.anchorLevel) fail(`âncora de nível ${anchorLevel.toFixed(2)}% acima do limite`);
if (overallErr > LIMITS.overall) fail(`sem filtros ${overallErr.toFixed(2)}% acima do limite`);

// Para as demais dimensões o afastamento é ESPERADO e intencional: com peso < 1, selecionar
// só "Go" devolve o efeito próprio da linguagem, não a média bruta de quem usa Go — que embute
// a composição de senioridade desse grupo. Aqui só verificamos que o afastamento é moderado.
console.log("\n  Desconfundimento (estimativa de um critério isolado vs. média bruta do grupo):");
let gapWorst = 0;
[["workModel", OFFICIAL_MEANS.salary_by_work_model], ["languages", OFFICIAL_MEANS.salary_by_languages]].forEach(
  ([key, official]) => {
    Object.entries(official).forEach(([label, off]) => {
      if (!Estimator.findOption(SALARY, key, label)) return;
      const gap = ((est({ [key]: label }).mean - off) / off) * 100;
      if (Math.abs(gap) > Math.abs(gapWorst)) gapWorst = gap;
    });
  }
);
console.log(`    maior afastamento: ${gapWorst >= 0 ? "+" : ""}${gapWorst.toFixed(2)}% (limite ${LIMITS.deconfGap}%)`);
console.log(`    peso linguagens = ${SALARY.weights.languages}, contratação = ${SALARY.weights.workModel}`);
if (Math.abs(gapWorst) > LIMITS.deconfGap) fail(`desconfundimento ${gapWorst.toFixed(2)}% além do esperado`);

// ---------------------------------------------------------------------------
console.log("\n=== 3. Cruzamentos reais de duas dimensões ===\n");

// Alvos: células (categoria × nível) publicadas pela pesquisa. A pesquisa não divulga o n da
// célula, então estimamos por independência para saber quais têm amostra suficiente.
const levelMeans = weightedMeansByColumn(data.raw.salary_by_level);
const totalLevel = Object.values(data.raw.total_by_level).reduce((a, b) => a + b, 0);
const levelShare = {};
Object.entries(data.raw.total_by_level).forEach(([k, v]) => (levelShare[k] = v / totalLevel));

const targets = [];
[
  { key: "uf", cross: data.crosstabs.salary_by_brazil_uf_x_level },
  { key: "languages", cross: data.crosstabs.salary_by_languages_x_level },
  { key: "frameworks", cross: data.frameworksCross.salary_by_frameworks_x_level },
].forEach(({ key, cross }) => {
  cross.index.forEach((catLabel, ri) => {
    const opt = Estimator.findOption(SALARY, key, catLabel);
    if (!opt) return;
    cross.columns.forEach((lvlLabel, ci) => {
      const mean = cross.data_mean[ri][ci];
      if (!mean || !levelMeans[lvlLabel] || !levelShare[lvlLabel]) return;
      targets.push({
        kind: key,
        sel: { level: lvlLabel, [key]: catLabel },
        actual: mean,
        approxN: opt.n * levelShare[lvlLabel],
      });
    });
  });
});

const lxw = data.levelXWorkModel.level_x_work_model;
[["CLT", lxw.clt], ["PJ", lxw.pj]].forEach(([wm, tab]) => {
  const means = weightedMeansByColumn(tab.salary_by_level);
  tab.salary_by_level.columns.forEach((lvl) => {
    const m = means[lvl];
    if (m && m.mean) {
      // Aqui o n é real, não estimado.
      targets.push({ kind: "exata", sel: { level: lvl, workModel: wm }, actual: m.mean, approxN: m.n });
    }
  });
});

function report(list, title) {
  const byKind = {};
  list.forEach((t) => {
    const err = Math.abs((est(t.sel).mean - t.actual) / t.actual) * 100;
    (byKind[t.kind] = byKind[t.kind] || []).push(err);
  });
  let all = [];
  Object.entries(byKind).forEach(([kind, errs]) => {
    const m = errs.reduce((a, b) => a + b, 0) / errs.length;
    all = all.concat(errs);
    console.log(`    ${kind.padEnd(14)} ${String(errs.length).padStart(4)} células   erro médio ${m.toFixed(2)}%`);
  });
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  console.log(`    ${title}: ${all.length} células, erro médio ${mean.toFixed(2)}%\n`);
  return mean;
}

const usable = targets.filter((t) => t.approxN >= MIN_CELL);
console.log(`  Células com amostra suficiente (n estimado >= ${MIN_CELL}):`);
const crossErr = report(usable, "  subtotal");

console.log(`  Todas as células, inclusive as de amostra ínfima (referência, sem limite):`);
report(targets, "  subtotal");

console.log(`  Avaliação: ${crossErr.toFixed(2)}% (limite ${LIMITS.crossCells}%)`);
if (crossErr > LIMITS.crossCells) fail(`cruzamentos ${crossErr.toFixed(2)}% acima do limite`);

// ---------------------------------------------------------------------------
console.log("\n=== 4. Cenários de sanidade ===\n");

const SCENARIOS = [
  { l: "Estagiário JS na PB", s: { level: "Estágio", languages: "JavaScript", uf: "Paraíba (PB)" } },
  { l: "Júnior SP CLT", s: { level: "Júnior", uf: "São Paulo (SP)", workModel: "CLT" } },
  { l: "Pleno Java SP CLT", s: { level: "Pleno", languages: "Java", uf: "São Paulo (SP)", workModel: "CLT" } },
  { l: "Sênior Go PJ SP exterior", s: { level: "Sênior", languages: "Go", workModel: "PJ", uf: "São Paulo (SP)", foreignJob: "Sim" } },
  {
    l: "Máximo plausível",
    s: {
      level: "Outro (Especialista, Tech Lead, Principal)", experience: "Mais de 20 anos",
      graduation: "Mestrado / Doutorado", languages: "Go", workModel: "PJ",
      uf: "Distrito Federal (DF)", foreignJob: "Sim", englishLevel: "Avançado",
    },
  },
  {
    l: "Mínimo plausível",
    s: {
      level: "Estágio", experience: "Menos de 1 ano", graduation: "Superior em andamento",
      workModel: "Outro", englishLevel: "Nenhum", sector: "Público",
    },
  },
];

SCENARIOS.forEach((sc) => {
  const r = est(sc.s);
  console.log(
    `    ${sc.l.padEnd(26)} R$ ${r.mean.toFixed(0).padStart(6)}  IC95 ±${r.ciPct.toFixed(1)}%   metade entre R$ ${r.p25.toFixed(0)}–${r.p75.toFixed(0)}`
  );
  if (!(r.mean > 500 && r.mean < 80000)) fail(`cenário "${sc.l}" fora de faixa plausível: R$ ${r.mean.toFixed(0)}`);
});

// ---------------------------------------------------------------------------
console.log("\n=== 5. Sanidade do intervalo de confiança ===\n");

const semFiltro = est({});
const teoricoSemFiltro = (1.96 * SALARY.meta.overallCv) / Math.sqrt(SALARY.meta.totalResponses) * 100;
console.log(`    sem filtros: IC95 ±${semFiltro.ciPct.toFixed(2)}%  (teórico CV/√N = ±${teoricoSemFiltro.toFixed(2)}%)`);
if (Math.abs(semFiltro.ciPct - teoricoSemFiltro) > 0.5) {
  fail(`IC sem filtros (${semFiltro.ciPct.toFixed(2)}%) destoa do teórico (${teoricoSemFiltro.toFixed(2)}%)`);
}
const games = est({ level: "Júnior", area: "Games" });
console.log(`    Júnior + Games (n=37): IC95 ±${games.ciPct.toFixed(1)}%  — amostra pequena deve alargar o intervalo`);
if (!(games.ciPct > semFiltro.ciPct * 3)) fail("IC não alarga o suficiente em amostra pequena");

// ---------------------------------------------------------------------------
console.log("");
if (failed) {
  console.error("VALIDAÇÃO FALHOU\n");
  process.exit(1);
}
console.log("Todos os testes passaram.\n");
