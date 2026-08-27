// Funções compartilhadas entre os scripts de processamento, validação e análise.

// Ponto médio de cada faixa salarial da pesquisa, em R$.
// As duas faixas ambíguas — a primeira ("Ate 1.000") e a última, aberta
// ("Acima de 50.000") — foram calibradas contra as médias que a própria pesquisa
// publica: com estes valores, reproduzimos as 44 médias oficiais conhecidas com
// erro percentual absoluto médio de 0,005%. Ver `npm run validate`.
const BRACKET_MIDPOINTS = {
  "Ate 1.000": 550,
  "Entre 1.001 e 2.000": 1500,
  "Entre 2.001 e 3.000": 2500,
  "Entre 3.001 e 4.000": 3500,
  "Entre 4.001 e 5.000": 4500,
  "Entre 5.001 e 6.000": 5500,
  "Entre 6.001 e 7.000": 6500,
  "Entre 7.001 e 9.000": 8000,
  "Entre 9.001 e 12.000": 10500,
  "Entre 12.001 e 15.000": 13500,
  "Entre 15.001 e 20.000": 17500,
  "Entre 20.001 e 30.000": 25000,
  "Entre 30.001 e 40.000": 35000,
  "Entre 40.001 e 50.000": 45000,
  "Acima de 50.000": 60000,
};

function midpointsFor(index) {
  return index.map((label) => {
    const m = BRACKET_MIDPOINTS[label];
    if (m === undefined) throw new Error("Faixa salarial desconhecida: " + label);
    return m;
  });
}

// table: { columns:[categorias], index:[faixas salariais], data:[[contagem por categoria] por faixa] }
// Retorna, por categoria: { n, mean }
function weightedMeansByColumn(table) {
  const mids = midpointsFor(table.index);
  const result = {};
  table.columns.forEach((col, colIdx) => {
    let n = 0;
    let sum = 0;
    table.data.forEach((row, rowIdx) => {
      const c = row[colIdx] || 0;
      n += c;
      sum += c * mids[rowIdx];
    });
    result[col] = { n, mean: n > 0 ? sum / n : null };
  });
  return result;
}

function overallWeightedMean(table) {
  const mids = midpointsFor(table.index);
  let n = 0;
  let sum = 0;
  table.data.forEach((row, rowIdx) => {
    const rowTotal = row.reduce((a, b) => a + b, 0);
    n += rowTotal;
    sum += rowTotal * mids[rowIdx];
  });
  return { n, mean: n > 0 ? sum / n : null };
}

// Desvio padrão e coeficiente de variação de uma tabela de faixas (todas as categorias juntas).
// O CV é o que determina a precisão amostral de uma média: Var(ln média) ≈ CV²/n.
function overallDispersionStats(table) {
  const mids = midpointsFor(table.index);
  let n = 0;
  let sum = 0;
  table.data.forEach((row, i) => {
    const rowTotal = row.reduce((a, b) => a + b, 0);
    n += rowTotal;
    sum += rowTotal * mids[i];
  });
  const mean = sum / n;
  let varSum = 0;
  table.data.forEach((row, i) => {
    const rowTotal = row.reduce((a, b) => a + b, 0);
    varSum += rowTotal * Math.pow(mids[i] - mean, 2);
  });
  const sd = Math.sqrt(varSum / n);
  return { n, mean, sd, cv: sd / mean };
}

// Limites [inferior, superior] de cada faixa, para interpolar percentis.
// A faixa aberta do topo recebe um teto nominal só para permitir interpolação;
// percentis que caem nela são sinalizados como "≥ 50.000".
const BRACKET_BOUNDS = {
  "Ate 1.000": [0, 1000],
  "Entre 1.001 e 2.000": [1000, 2000],
  "Entre 2.001 e 3.000": [2000, 3000],
  "Entre 3.001 e 4.000": [3000, 4000],
  "Entre 4.001 e 5.000": [4000, 5000],
  "Entre 5.001 e 6.000": [5000, 6000],
  "Entre 6.001 e 7.000": [6000, 7000],
  "Entre 7.001 e 9.000": [7000, 9000],
  "Entre 9.001 e 12.000": [9000, 12000],
  "Entre 12.001 e 15.000": [12000, 15000],
  "Entre 15.001 e 20.000": [15000, 20000],
  "Entre 20.001 e 30.000": [20000, 30000],
  "Entre 30.001 e 40.000": [30000, 40000],
  "Entre 40.001 e 50.000": [40000, 50000],
  "Acima de 50.000": [50000, 80000],
};

// Percentil por interpolação linear dentro da faixa que o contém.
// counts: contagem por faixa, na mesma ordem de `index`.
function percentileFromBrackets(index, counts, q) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const target = q * total;
  let cum = 0;
  for (let i = 0; i < index.length; i++) {
    const c = counts[i] || 0;
    if (cum + c >= target) {
      const bounds = BRACKET_BOUNDS[index[i]];
      if (!bounds) return null;
      const [lo, hi] = bounds;
      const within = c > 0 ? (target - cum) / c : 0;
      return lo + within * (hi - lo);
    }
    cum += c;
  }
  return BRACKET_BOUNDS[index[index.length - 1]][1];
}

// Estatísticas de dispersão de uma coluna (categoria) de uma tabela de faixas.
function dispersionForColumn(table, colIdx) {
  const counts = table.data.map((row) => row[colIdx] || 0);
  const mids = midpointsFor(table.index);
  let n = 0;
  let sum = 0;
  counts.forEach((c, i) => {
    n += c;
    sum += c * mids[i];
  });
  const mean = n > 0 ? sum / n : null;
  let cv = null;
  if (mean) {
    let varSum = 0;
    counts.forEach((c, i) => (varSum += c * Math.pow(mids[i] - mean, 2)));
    cv = Math.sqrt(varSum / n) / mean;
  }
  return {
    n,
    mean,
    cv,
    p25: percentileFromBrackets(table.index, counts, 0.25),
    p50: percentileFromBrackets(table.index, counts, 0.5),
    p75: percentileFromBrackets(table.index, counts, 0.75),
  };
}

function dispersionOverall(table) {
  const counts = table.data.map((row) => row.reduce((a, b) => a + b, 0));
  return {
    p25: percentileFromBrackets(table.index, counts, 0.25),
    p50: percentileFromBrackets(table.index, counts, 0.5),
    p75: percentileFromBrackets(table.index, counts, 0.75),
  };
}

module.exports = {
  BRACKET_MIDPOINTS,
  BRACKET_BOUNDS,
  midpointsFor,
  weightedMeansByColumn,
  overallWeightedMean,
  overallDispersionStats,
  percentileFromBrackets,
  dispersionForColumn,
  dispersionOverall,
};
