// Estimador salarial — modelo multiplicativo com pesos medidos nos dados.
//
// Compartilhado entre o navegador e os scripts de build/validação, para garantir que o que é
// testado é exatamente o que é publicado.
//
//   estimativa = média_geral × Π_d (índice_d) ^ (peso_d)
//
// O peso de cada dimensão é a ATENUAÇÃO medida nas tabelas cruzadas da pesquisa: quanto do
// efeito daquele critério sobrevive depois de descontar a senioridade. É o que impede a dupla
// contagem — o salário alto de quem tem 20 anos de experiência é, em boa parte, o salário alto
// de quem é sênior, e somar os dois efeitos inteiros superestimaria a estimativa.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SalaryEstimator = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Ordem de exibição das dimensões e rótulos curtos para o detalhamento.
  var DIMENSIONS = [
    { key: "level", label: "Nível", param: "nivel" },
    { key: "experience", label: "Experiência", param: "exp" },
    { key: "graduation", label: "Formação", param: "form" },
    { key: "area", label: "Área", param: "area" },
    { key: "languages", label: "Linguagem", param: "lang" },
    { key: "frameworks", label: "Framework", param: "fw" },
    { key: "uf", label: "Estado", param: "uf" },
    { key: "workModel", label: "Contratação", param: "contrato" },
    { key: "sector", label: "Setor", param: "setor" },
    { key: "englishLevel", label: "Inglês", param: "ingles" },
    { key: "foreignJob", label: "Exterior", param: "exterior" },
  ];

  function findOption(data, key, label) {
    var list = (data.dimensions && data.dimensions[key]) || [];
    for (var i = 0; i < list.length; i++) if (list[i].label === label) return list[i];
    return null;
  }

  function weightFor(data, key) {
    var w = data.weights && data.weights[key];
    return typeof w === "number" ? w : 0.5;
  }

  function isUnidentified(data, key) {
    return !!(data.unidentified && data.unidentified.indexOf(key) >= 0);
  }

  // selections: { dimKey: "Rótulo" }
  function estimate(data, selections) {
    var meta = data.meta;
    var product = 1;
    var minN = Infinity;
    var levelOpt = null;
    var rows = [];
    var sumWeights = 0;
    var varLog = 0;

    DIMENSIONS.forEach(function (dim) {
      var label = selections[dim.key];
      if (!label) return;
      var opt = findOption(data, dim.key, label);
      if (!opt) return;

      var weight = weightFor(data, dim.key);
      var factor = Math.pow(opt.index, weight);
      product *= factor;
      minN = Math.min(minN, opt.n);
      sumWeights += weight;
      if (dim.key === "level") levelOpt = opt;

      // Variância amostral do log da média da categoria: Var(ln média) ≈ CV²/n.
      var cv = opt.cv || meta.overallCv;
      varLog += weight * weight * ((cv * cv) / opt.n);

      rows.push({
        key: dim.key,
        label: dim.label,
        option: opt,
        weight: weight,
        factor: factor,
        pct: (factor - 1) * 100,
        identified: !isUnidentified(data, dim.key),
      });
    });

    // A média geral também entra: ln(est) = (1-Σw)·ln(M0) + Σ w·ln(média_d).
    var m0Coef = 1 - sumWeights;
    varLog += m0Coef * m0Coef * ((meta.overallCv * meta.overallCv) / meta.totalResponses);

    var mean = meta.overallMean * product;
    var seLog = Math.sqrt(Math.max(0, varLog));

    // Dispersão ENTRE PESSOAS (não é incerteza da estimativa): usa o formato real da
    // distribuição do nível escolhido, ou a geral quando o nível não foi informado.
    var p25r = levelOpt && levelOpt.p25r ? levelOpt.p25r : meta.overallP25r;
    var p50r = levelOpt && levelOpt.p50r ? levelOpt.p50r : meta.overallP50r;
    var p75r = levelOpt && levelOpt.p75r ? levelOpt.p75r : meta.overallP75r;

    return {
      mean: mean,
      median: mean * p50r,
      p25: mean * p25r,
      p75: mean * p75r,
      seLog: seLog,
      ci95: [mean * Math.exp(-1.96 * seLog), mean * Math.exp(1.96 * seLog)],
      ciPct: 1.96 * seLog * 100,
      rows: rows,
      minN: rows.length ? minN : null,
      count: rows.length,
      hasUnidentified: rows.some(function (r) {
        return !r.identified;
      }),
    };
  }

  return { DIMENSIONS: DIMENSIONS, estimate: estimate, findOption: findOption };
});
