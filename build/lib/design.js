// Monta as observações agregadas (células) da regressão log-linear.
//
// A pesquisa não publica microdados: cada observação é um GRUPO com média salarial e nº de
// respostas. Numa célula, uma dimensão pode estar:
//
//   - FIXADA  (ex.: a célula "Java × Sênior" tem nível = Sênior), ou
//   - MISTURA (ex.: a célula "Java" mistura todos os níveis).
//
// Essa distinção é o ponto crítico do modelo. Para uma mistura, o valor observado é o log da
// MÉDIA ARITMÉTICA do grupo, enquanto um modelo log-linear ingênuo produziria a média dos logs.
// Como o efeito de senioridade é enorme (de -73% a +110%), essa diferença (desigualdade de
// Jensen) vira um viés sistemático de ~8%. Por isso as misturas entram como termo de offset
// não-linear — ver build/lib/fit.js.
const { weightedMeansByColumn, overallWeightedMean } = require("./stats");

const MIN_SAMPLE = 30;

const DIMENSION_SOURCES = [
  { key: "level", label: "Nível", table: (d) => d.raw.salary_by_level, minSample: 1 },
  { key: "experience", label: "Experiência", table: (d) => d.raw.salary_by_experience, minSample: 1 },
  { key: "graduation", label: "Formação", table: (d) => d.raw.salary_by_graduation, minSample: 1 },
  { key: "area", label: "Área", table: (d) => d.raw.salary_by_area },
  { key: "languages", label: "Linguagem", table: (d) => d.raw.salary_by_languages },
  { key: "frameworks", label: "Framework", table: (d) => d.frameworks.salary_by_frameworks },
  { key: "uf", label: "Estado", table: (d) => d.raw.salary_by_brazil_uf },
  { key: "workModel", label: "Contratação", table: (d) => d.raw.salary_by_work_model, minSample: 1 },
  { key: "sector", label: "Setor", table: (d) => d.raw.salary_by_sector, minSample: 1 },
  { key: "englishLevel", label: "Inglês", table: (d) => d.raw.salary_by_english_level, minSample: 1 },
  { key: "foreignJob", label: "Exterior", table: (d) => d.raw.salary_by_foreign_job, minSample: 1 },
];

// Dimensões para as quais a pesquisa publica algum cruzamento. Só nelas é possível separar o
// efeito próprio do efeito de composição por senioridade; as demais ficam confundidas e a UI
// precisa sinalizar isso.
const IDENTIFIED = {
  level: 1, uf: 1, languages: 1, frameworks: 1, experience: 1, graduation: 1, workModel: 1,
};

function buildModel(data) {
  const overall = overallWeightedMean(data.raw.salary_by_level);

  // --- Dimensões, categorias e proporções populacionais ---------------------
  const dims = DIMENSION_SOURCES.map((src) => {
    const table = src.table(data);
    const means = weightedMeansByColumn(table);
    const minSample = src.minSample || MIN_SAMPLE;
    const cats = table.columns
      .filter((c) => means[c] && means[c].n >= minSample && means[c].mean)
      .map((c) => ({ label: c, n: means[c].n, mean: means[c].mean }));
    const totalN = cats.reduce((a, c) => a + c.n, 0);
    // Referência = categoria mais populosa (a mais estável para ancorar a codificação).
    let ref = 0;
    cats.forEach((c, i) => {
      if (c.n > cats[ref].n) ref = i;
    });
    return {
      key: src.key,
      label: src.label,
      cats,
      index: cats.reduce((m, c, i) => ((m[c.label] = i), m), {}),
      p: cats.map((c) => c.n / totalN),
      ref,
      identified: !!IDENTIFIED[src.key],
    };
  });

  const dimByKey = dims.reduce((m, d) => ((m[d.key] = d), m), {});

  // --- Colunas: intercepto + (K-1) por dimensão (codificação por referência) ---
  const columns = [{ dim: null, label: "(intercepto)" }];
  dims.forEach((d) => {
    d.colOf = new Int32Array(d.cats.length).fill(-1);
    d.cats.forEach((c, i) => {
      if (i === d.ref) return;
      d.colOf[i] = columns.length;
      columns.push({ dim: d.key, cat: i, label: d.cats[i].label });
    });
  });
  const p = columns.length;

  // --- Células --------------------------------------------------------------
  // pinned: { dimKey: índice da categoria }   mixtures: { dimKey: Float64Array de proporções }
  const cells = [];
  const add = (pinned, mixtures, mean, n, kind) => {
    if (!(mean > 0) || !(n > 0)) return;
    const x = new Float64Array(p);
    x[0] = 1;
    Object.keys(pinned).forEach((k) => {
      const d = dimByKey[k];
      const col = d.colOf[pinned[k]];
      if (col >= 0) x[col] = 1;
    });
    cells.push({ x, y: Math.log(mean), w: n, mean, n, kind, pinned, mixtures });
  };

  // (a) Média geral — tudo em mistura populacional. Ancora o intercepto na média aritmética.
  add({}, {}, overall.mean, overall.n, "geral");

  // (b) Marginais por categoria. Onde a pesquisa publica a distribuição conjunta com nível,
  //     usamos a composição REAL de níveis como mistura — é isso que desconfunde a categoria.
  const compositionSources = {
    experience: data.crosstabs.experience_by_level,
    graduation: data.crosstabs.graduation_by_level,
    workModel: data.crosstabs.work_model_by_level,
  };
  const levelDim = dimByKey.level;

  dims.forEach((d) => {
    const joint = compositionSources[d.key];
    d.cats.forEach((cat, ci) => {
      const pinned = {};
      pinned[d.key] = ci;
      const mixtures = {};

      if (joint) {
        const ri = joint.index.indexOf(cat.label);
        if (ri >= 0) {
          const row = joint.data[ri];
          const rowTotal = row.reduce((a, b) => a + b, 0);
          if (rowTotal > 0) {
            const q = new Float64Array(levelDim.cats.length);
            joint.columns.forEach((lvlLabel, k) => {
              const li = levelDim.index[lvlLabel];
              if (li !== undefined) q[li] = row[k] / rowTotal;
            });
            mixtures.level = q;
          }
        }
      }
      add(pinned, mixtures, cat.mean, cat.n, "marginal:" + d.key);
    });
  });

  // (c) Cruzadas categoria × nível (média condicional publicada). A pesquisa não publica o n
  //     da célula; aproximamos por independência (n_categoria × proporção do nível).
  const crossSources = [
    { key: "uf", cross: data.crosstabs.salary_by_brazil_uf_x_level },
    { key: "languages", cross: data.crosstabs.salary_by_languages_x_level },
    { key: "frameworks", cross: data.frameworksCross.salary_by_frameworks_x_level },
  ];

  crossSources.forEach((src) => {
    const d = dimByKey[src.key];
    const cross = src.cross;
    cross.index.forEach((catLabel, ri) => {
      const ci = d.index[catLabel];
      if (ci === undefined) return;
      const catN = d.cats[ci].n;
      cross.columns.forEach((lvlLabel, k) => {
        const li = levelDim.index[lvlLabel];
        if (li === undefined) return;
        const mean = cross.data_mean[ri][k];
        const approxN = catN * levelDim.p[li];
        if (!mean || approxN < 20) return;
        const pinned = { level: li };
        pinned[src.key] = ci;
        add(pinned, {}, mean, approxN, "cruzada:" + src.key);
      });
    });
  });

  // (d) Nível × contratação — único cruzamento EXATO (distribuição e n reais).
  const lxw = data.levelXWorkModel.level_x_work_model;
  [["CLT", lxw.clt], ["PJ", lxw.pj]].forEach(([wmLabel, tab]) => {
    const wi = dimByKey.workModel.index[wmLabel];
    if (wi === undefined) return;
    const means = weightedMeansByColumn(tab.salary_by_level);
    tab.salary_by_level.columns.forEach((lvlLabel) => {
      const li = levelDim.index[lvlLabel];
      const m = means[lvlLabel];
      if (li === undefined || !m || !m.n || !m.mean) return;
      add({ level: li, workModel: wi }, {}, m.mean, m.n, "exata:nivel×contrato");
    });
  });

  return { dims, dimByKey, columns, p, cells, overall, MIN_SAMPLE };
}

module.exports = { buildModel, MIN_SAMPLE, IDENTIFIED, DIMENSION_SOURCES };
