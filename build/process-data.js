// Processa os dados brutos da Pesquisa Código Fonte TV 2026 em médias ponderadas
// e índices multiplicadores por categoria, prontos para uso na calculadora estática.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_DIR = path.join(__dirname, "..", "public");

const raw2026 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "survey-2026-raw.json"), "utf8"));
const frameworks2026 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "survey-2026-frameworks.json"), "utf8"));
const raw2025 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "survey-2025-raw.json"), "utf8"));

// Ponto médio de cada faixa salarial (em R$). A última faixa é aberta ("Acima de 50.000"),
// usamos um valor representativo conservador em vez do dobro do teto anterior.
const BRACKET_MIDPOINTS = {
  "Ate 1.000": 800,
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

function midpoints(index) {
  return index.map((label) => {
    const m = BRACKET_MIDPOINTS[label];
    if (m === undefined) throw new Error("Faixa desconhecida: " + label);
    return m;
  });
}

// table: {columns:[...], index:[bracket labels...], data: [ [count por coluna] por linha de faixa ]}
// Retorna, por coluna: {n, mean}
function weightedMeansByColumn(table) {
  const mids = midpoints(table.index);
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
  const mids = midpoints(table.index);
  let n = 0;
  let sum = 0;
  table.data.forEach((row, rowIdx) => {
    const rowTotal = row.reduce((a, b) => a + b, 0);
    n += rowTotal;
    sum += rowTotal * mids[rowIdx];
  });
  return { n, mean: sum / n };
}

// Constrói dimensão pronta para a calculadora: cada opção com média, contagem e índice (média/overallMean)
function buildDimension(table, overallMean, minSample = 15) {
  const means = weightedMeansByColumn(table);
  // Mantém a ordem original das colunas da tabela: para dimensões ordinais
  // (nível, experiência, formação, inglês) isso preserva a ordem lógica;
  // para as demais (UF, linguagens, frameworks, área) a fonte já vem em ordem alfabética.
  const options = table.columns
    .filter((label) => means[label] && means[label].n >= minSample && means[label].mean !== null)
    .map((label) => {
      const v = means[label];
      return {
        label,
        n: v.n,
        mean: Math.round(v.mean),
        index: +(v.mean / overallMean).toFixed(4),
      };
    });
  return options;
}

const { mean: overallMean2026, n: totalN2026 } = overallWeightedMean(raw2026.salary_by_level);

const dimensions = {
  level: buildDimension(raw2026.salary_by_level, overallMean2026, 1),
  experience: buildDimension(raw2026.salary_by_experience, overallMean2026, 1),
  area: buildDimension(raw2026.salary_by_area, overallMean2026, 15),
  languages: buildDimension(raw2026.salary_by_languages, overallMean2026, 15),
  frameworks: buildDimension(frameworks2026.salary_by_frameworks, overallMean2026, 15),
  uf: buildDimension(raw2026.salary_by_brazil_uf, overallMean2026, 1),
  graduation: buildDimension(raw2026.salary_by_graduation, overallMean2026, 1),
  workModel: buildDimension(raw2026.salary_by_work_model, overallMean2026, 1),
  sector: buildDimension(raw2026.salary_by_sector, overallMean2026, 1),
  englishLevel: buildDimension(raw2026.salary_by_english_level, overallMean2026, 1),
  foreignJob: buildDimension(raw2026.salary_by_foreign_job, overallMean2026, 1),
};

// Ordena tecnologias/frameworks pela média salarial nas listas para facilitar
// eventual uso de "top pagos", mantendo a ordem por amostra como padrão da UI.

// Dados do ano anterior (2025) só para exibir tendência (delta%) em nível, modelo de contratação,
// UF e linguagens — dimensões disponíveis no snapshot embutido da página.
const { mean: overallMean2025 } = overallWeightedMean(raw2025.salary_by_level);
const trend2025 = {
  overallMean: Math.round(overallMean2025),
  level: buildDimension(raw2025.salary_by_level, overallMean2025, 1),
  workModel: buildDimension(raw2025.salary_by_work_model, overallMean2025, 1),
  uf: buildDimension(raw2025.salary_by_brazil_uf, overallMean2025, 1),
  languages: buildDimension(raw2025.salary_by_languages, overallMean2025, 1),
};

const output = {
  meta: {
    source: "Pesquisa Salarial de Programadores 2026 - Código Fonte TV",
    sourceUrl: "https://pesquisa.codigofonte.com.br/2026",
    collectedAt: "23/02/2026 a 09/06/2026",
    totalResponses: totalN2026,
    overallMean: Math.round(overallMean2026),
    generatedAt: new Date().toISOString(),
    note: "Estimativas calculadas a partir de médias ponderadas por faixa salarial autodeclarada. Não é um censo — use como panorama de mercado.",
  },
  dimensions,
  trend2025,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "salary-data.json"), JSON.stringify(output));
fs.writeFileSync(
  path.join(OUT_DIR, "salary-data.js"),
  "window.SALARY_DATA = " + JSON.stringify(output) + ";"
);

console.log("Média geral 2026:", Math.round(overallMean2026), "| respostas:", totalN2026);
console.log("Dimensões geradas:", Object.keys(dimensions).map((k) => `${k}(${dimensions[k].length})`).join(", "));
console.log("Arquivo gerado em:", path.join(OUT_DIR, "salary-data.js"));
