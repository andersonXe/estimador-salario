// Mede, nas tabelas cruzadas publicadas pela pesquisa, quanto do efeito salarial
// marginal de cada dimensão SOBREVIVE depois de controlar pelo nível/senioridade.
//
// Esse fator ("atenuação") é o expoente aplicado ao índice da dimensão na combinação
// multiplicativa da calculadora. Ele resolve o problema de dupla contagem: o salário
// alto de quem tem "mais de 20 anos de experiência" é, em boa parte, o salário alto de
// quem é sênior — somar os dois efeitos inteiros superestimaria a estimativa.
//
// Atenuação ~1 => a dimensão carrega informação própria, quase independente do nível.
// Atenuação ~0 => o efeito da dimensão é só reflexo da composição de níveis dela.
const { weightedMeansByColumn, overallWeightedMean } = require("./stats");

// Regressão linear pela origem, ponderada: y = slope * x
function weightedSlopeThroughOrigin(points) {
  const num = points.reduce((a, p) => a + p.w * p.x * p.y, 0);
  const den = points.reduce((a, p) => a + p.w * p.x * p.x, 0);
  const slope = den > 0 ? num / den : null;
  if (slope === null) return { slope: null, r2: null, nPoints: 0 };
  const ssRes = points.reduce((a, p) => a + p.w * Math.pow(p.y - slope * p.x, 2), 0);
  const ssTot = points.reduce((a, p) => a + p.w * p.y * p.y, 0);
  return { slope, r2: ssTot > 0 ? 1 - ssRes / ssTot : null, nPoints: points.length, points };
}

// Caso A: a pesquisa publica a média salarial condicional (categoria × nível).
// Comparamos o efeito DENTRO do nível com o efeito marginal.
function fromConditionalMeans(ctx, marginalTable, crossTable, minCell) {
  const { overall, levelMeans, totalByLevel, N } = ctx;
  const marginal = weightedMeansByColumn(marginalTable);
  const points = [];

  crossTable.index.forEach((cat, ri) => {
    const m = marginal[cat];
    if (!m || !m.n || !m.mean) return;
    const x = Math.log(m.mean / overall);
    if (!isFinite(x) || Math.abs(x) < 1e-6) return;

    crossTable.columns.forEach((lvl, ci) => {
      const condMean = crossTable.data_mean[ri][ci];
      const lvlMean = levelMeans[lvl] && levelMeans[lvl].mean;
      const nLvl = totalByLevel[lvl];
      if (!condMean || !lvlMean || !nLvl) return;
      // A pesquisa não publica as contagens cruzadas, só as médias. Aproximamos o
      // tamanho da célula assumindo independência: n_categoria × P(nível).
      const cellN = m.n * (nLvl / N);
      if (cellN < minCell) return;
      const y = Math.log(condMean / lvlMean);
      if (!isFinite(y)) return;
      points.push({ x, y, w: cellN, cat, lvl });
    });
  });

  return weightedSlopeThroughOrigin(points);
}

// Caso B: a pesquisa publica a distribuição conjunta (contagens categoria × nível),
// mas não o salário dentro da célula. Calculamos qual seria o índice da categoria se
// ele viesse SÓ da mistura de níveis dela; o que sobra é o efeito próprio da dimensão.
function fromComposition(ctx, marginalTable, jointTable, minRow) {
  const { overall, levelMeans } = ctx;
  const marginal = weightedMeansByColumn(marginalTable);
  const points = [];

  jointTable.index.forEach((cat, ri) => {
    const m = marginal[cat];
    if (!m || !m.n || !m.mean) return;
    const row = jointTable.data[ri];
    const rowTotal = row.reduce((a, b) => a + b, 0);
    if (rowTotal < minRow) return;

    let predicted = 0;
    jointTable.columns.forEach((lvl, ci) => {
      const lvlMean = levelMeans[lvl] && levelMeans[lvl].mean;
      if (!lvlMean) return;
      predicted += (row[ci] / rowTotal) * (lvlMean / overall);
    });
    if (predicted <= 0) return;

    const x = Math.log(m.mean / overall);
    const y = Math.log(m.mean / overall / predicted);
    if (!isFinite(x) || !isFinite(y) || Math.abs(x) < 1e-6) return;
    points.push({ x, y, w: rowTotal, cat });
  });

  return weightedSlopeThroughOrigin(points);
}

// Limita a atenuação a um intervalo plausível. Valores fora disso indicariam ruído
// da amostra, não um efeito real, e distorceriam a estimativa final.
const MIN_ATTENUATION = 0.15;
const MAX_ATTENUATION = 1.0;
const clamp = (v) => Math.min(MAX_ATTENUATION, Math.max(MIN_ATTENUATION, v));

// Caso C: cruzamento EXATO com distribuição por faixas (nível × contratação). Aqui não há
// aproximação nenhuma: média e nº de respostas da célula são os reais.
function fromExactCross(ctx, marginalTable, exactTables) {
  const { overall, levelMeans } = ctx;
  const marginal = weightedMeansByColumn(marginalTable);
  const points = [];

  exactTables.forEach(({ label, table }) => {
    const m = marginal[label];
    if (!m || !m.mean) return;
    const x = Math.log(m.mean / overall);
    if (!isFinite(x) || Math.abs(x) < 1e-6) return;

    const cellMeans = weightedMeansByColumn(table);
    table.columns.forEach((lvl) => {
      const cell = cellMeans[lvl];
      const lvlMean = levelMeans[lvl] && levelMeans[lvl].mean;
      if (!cell || !cell.n || !cell.mean || !lvlMean) return;
      const y = Math.log(cell.mean / lvlMean);
      if (!isFinite(y)) return;
      points.push({ x, y, w: cell.n, cat: label, lvl });
    });
  });

  return weightedSlopeThroughOrigin(points);
}

function measureAttenuations(raw, crosstabs, frameworksCross, levelXWorkModel, frameworksMarginal) {
  const overall = overallWeightedMean(raw.salary_by_level).mean;
  const levelMeans = weightedMeansByColumn(raw.salary_by_level);
  const totalByLevel = raw.total_by_level;
  const N = Object.values(totalByLevel).reduce((a, b) => a + b, 0);
  const ctx = { overall, levelMeans, totalByLevel, N, frameworksMarginal };

  const detail = {
    uf: {
      ...fromConditionalMeans(ctx, raw.salary_by_brazil_uf, crosstabs.salary_by_brazil_uf_x_level, 25),
      method: "média condicional (UF × nível)",
    },
    languages: {
      ...fromConditionalMeans(ctx, raw.salary_by_languages, crosstabs.salary_by_languages_x_level, 25),
      method: "média condicional (linguagem × nível)",
    },
    experience: {
      ...fromComposition(ctx, raw.salary_by_experience, crosstabs.experience_by_level, 50),
      method: "composição de níveis",
    },
    graduation: {
      ...fromComposition(ctx, raw.salary_by_graduation, crosstabs.graduation_by_level, 50),
      method: "composição de níveis",
    },
  };

  // Frameworks: a pesquisa publica framework × nível, então não precisa herdar o padrão.
  if (frameworksCross && frameworksCross.salary_by_frameworks_x_level && frameworksMarginal) {
    detail.frameworks = {
      ...fromConditionalMeans(
        ctx,
        frameworksMarginal.salary_by_frameworks,
        frameworksCross.salary_by_frameworks_x_level,
        25
      ),
      method: "média condicional (framework × nível)",
    };
  }

  // Contratação: com o cruzamento exato disponível, medimos direto em vez de por composição.
  if (levelXWorkModel && levelXWorkModel.level_x_work_model) {
    const lxw = levelXWorkModel.level_x_work_model;
    detail.workModel = {
      ...fromExactCross(ctx, raw.salary_by_work_model, [
        { label: "CLT", table: lxw.clt.salary_by_level },
        { label: "PJ", table: lxw.pj.salary_by_level },
      ]),
      method: "cruzamento exato (nível × contratação)",
    };
  } else {
    detail.workModel = {
      ...fromComposition(ctx, raw.salary_by_work_model, crosstabs.work_model_by_level, 50),
      method: "composição de níveis",
    };
  }

  const measured = Object.values(detail)
    .map((d) => d.slope)
    .filter((v) => v != null && isFinite(v));
  const fallback = measured.reduce((a, b) => a + b, 0) / measured.length;

  const weights = { level: 1 };
  Object.entries(detail).forEach(([k, d]) => {
    weights[k] = +clamp(d.slope).toFixed(3);
  });
  // Dimensões sem nenhum cruzamento publicado herdam a atenuação média medida. Seus efeitos
  // permanecem confundidos com senioridade — a interface precisa sinalizar isso.
  const UNIDENTIFIED = ["area", "sector", "englishLevel", "foreignJob"];
  UNIDENTIFIED.forEach((k) => {
    weights[k] = +clamp(fallback).toFixed(3);
  });

  return { weights, detail, fallback: +fallback.toFixed(3), unidentified: UNIDENTIFIED };
}

module.exports = { measureAttenuations };
