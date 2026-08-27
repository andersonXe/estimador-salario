// Ajuste da regressão log-linear ponderada sobre células agregadas.
//
// Modelo:
//   média(célula) = M0 · Π_fixadas exp(β)  ·  Π_misturas [ Σ_k q_k exp(β_k) ]
//
// O segundo produto é a média ARITMÉTICA da mistura, não a geométrica — é o que corrige o viés
// de Jensen que aparece quando uma célula agrega vários níveis. Como esse termo é não-linear em
// β, ajustamos iterativamente: com β corrente calculamos o offset de cada mistura, subtraímos do
// alvo, reajustamos a parte linear e repetimos até convergir.
//
// Normalização: após cada iteração, cada dimensão é recentrada para que Σ_k p_k exp(β_k) = 1.
// Assim uma dimensão em mistura populacional contribui fator 1, o intercepto é a média geral, e
// na predição uma dimensão não selecionada contribui exatamente nada.
const { weightedRidgeFit, weightedR2, inverseFromCholesky } = require("./matrix");

function zeroBetas(dims) {
  return dims.map((d) => new Float64Array(d.cats.length));
}

// Recentra para Σ_k p_k exp(β_k) = 1; devolve o ajuste a somar ao intercepto.
function recenter(dims, betas) {
  let interceptShift = 0;
  dims.forEach((d, di) => {
    const b = betas[di];
    let Z = 0;
    for (let k = 0; k < b.length; k++) Z += d.p[k] * Math.exp(b[k]);
    if (!(Z > 0)) return;
    const lnZ = Math.log(Z);
    for (let k = 0; k < b.length; k++) b[k] -= lnZ;
    interceptShift += lnZ;
  });
  return interceptShift;
}

// ln(Σ_k p_k exp(β_k)) por dimensão — o fator de uma mistura populacional.
// Vale 0 quando os coeficientes estão recentrados, mas precisa ser calculado durante a
// iteração, antes da recentragem.
function populationLnZ(dims, betas) {
  return dims.map((d, di) => {
    const b = betas[di];
    let Z = 0;
    for (let k = 0; k < b.length; k++) Z += d.p[k] * Math.exp(b[k]);
    return Z > 0 ? Math.log(Z) : 0;
  });
}

// Termo não-linear da célula. TODA dimensão que não está fixada precisa entrar aqui — se uma
// dimensão ausente fosse simplesmente ignorada, a parte linear a trataria como "categoria de
// referência" em vez de "mistura populacional", e a recentragem deixaria de ser uma mudança de
// gauge neutra: o resultado seria um viés constante em todas as células.
function mixtureOffset(cell, dimByKeyIdx, dims, betas, lnZ) {
  let off = 0;
  for (let di = 0; di < dims.length; di++) {
    const d = dims[di];
    if (cell.pinned[d.key] !== undefined) continue; // tratada na parte linear
    const q = cell.mixtures[d.key];
    if (!q) {
      off += lnZ[di]; // mistura populacional
      continue;
    }
    const b = betas[di];
    let s = 0;
    for (let k = 0; k < b.length; k++) if (q[k]) s += q[k] * Math.exp(b[k]);
    if (s > 0) off += Math.log(s);
  }
  return off;
}

// Média ponderada de exp(resíduo) — estimador de smearing de Duan, que corrige o que sobra de
// viés de retransformação por falta de ajuste do modelo.
function smearingFactor(cells, residuals) {
  let sw = 0;
  let acc = 0;
  for (let i = 0; i < cells.length; i++) {
    sw += cells[i].w;
    acc += cells[i].w * Math.exp(residuals[i]);
  }
  return acc / sw;
}

function fit(model, lambda, opts) {
  opts = opts || {};
  const maxIter = opts.maxIter || 400;
  const tol = opts.tol || 1e-10;
  const cells = opts.cells || model.cells;
  const dims = model.dims;
  const dimByKeyIdx = {};
  dims.forEach((d, i) => (dimByKeyIdx[d.key] = i));

  let betas = zeroBetas(dims);
  let intercept = Math.log(model.overall.mean);
  let solved = null;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    // Alvo ajustado pelos offsets das misturas
    const lnZ = populationLnZ(dims, betas);
    const rows = cells.map((c) => ({
      x: c.x,
      w: c.w,
      y: c.y - mixtureOffset(c, dimByKeyIdx, dims, betas, lnZ),
    }));

    solved = weightedRidgeFit(rows, model.p, lambda);
    if (!solved) return null;

    // Descompacta os coeficientes (categoria de referência = 0).
    // NÃO recentramos aqui: a recentragem desloca o intercepto por Σ lnZ, mas os offsets desta
    // iteração foram calculados no gauge anterior — recentrar no meio do laço deixaria de
    // preservar as predições e o laço nunca chegaria a um ponto fixo consistente.
    // A recentragem é feita uma única vez, depois da convergência.
    const next = zeroBetas(dims);
    dims.forEach((d, di) => {
      d.cats.forEach((_, k) => {
        const col = d.colOf[k];
        next[di][k] = col >= 0 ? solved.beta[col] : 0;
      });
    });
    const nextIntercept = solved.beta[0];

    let delta = Math.abs(nextIntercept - intercept);
    dims.forEach((d, di) => {
      for (let k = 0; k < next[di].length; k++) {
        delta = Math.max(delta, Math.abs(next[di][k] - betas[di][k]));
      }
    });

    betas = next;
    intercept = nextIntercept;
    if (delta < tol) break;
  }

  // Recentragem final (pura mudança de gauge): Σ_k p_k exp(β_k) = 1 em cada dimensão.
  // A partir daqui, uma dimensão em mistura populacional contribui fator 1, o intercepto é a
  // média geral e, na predição, uma dimensão não selecionada contribui exatamente nada.
  intercept += recenter(dims, betas);

  // Resíduos do modelo completo (com os offsets não-lineares)
  const finalLnZ = populationLnZ(dims, betas);
  const residuals = new Float64Array(cells.length);
  const fitted = new Float64Array(cells.length);
  cells.forEach((c, i) => {
    let lin = intercept + mixtureOffset(c, dimByKeyIdx, dims, betas, finalLnZ);
    for (const key in c.pinned) {
      const di = dimByKeyIdx[key];
      lin += betas[di][c.pinned[key]];
    }
    fitted[i] = lin;
    residuals[i] = c.y - lin;
  });

  const result = {
    intercept,
    betas,
    dimByKeyIdx,
    lambda,
    iterations: iter + 1,
    residuals,
    fitted,
    cholesky: solved.cholesky,
    r2: weightedR2(cells.map((c) => ({ w: c.w, y: c.y })), fitted),
    smearing: 0,
  };
  result.smearing = smearingFactor(cells, residuals);
  return result;
}

// Predição em R$. assignment: { dimKey: "Rótulo" }. Dimensões ausentes contribuem 0.
function predict(model, f, assignment) {
  let lin = f.intercept;
  for (const key in assignment) {
    const d = model.dimByKey[key];
    if (!d) continue;
    const k = d.index[assignment[key]];
    if (k === undefined) continue;
    lin += f.betas[f.dimByKeyIdx[key]][k];
  }
  return Math.exp(lin) * f.smearing;
}

// Efeito percentual de uma categoria (já normalizado: 0% = média da dimensão).
function effectPct(model, f, dimKey, label) {
  const d = model.dimByKey[dimKey];
  const k = d.index[label];
  if (k === undefined) return null;
  return (Math.exp(f.betas[f.dimByKeyIdx[dimKey]][k]) - 1) * 100;
}

const DEFAULT_LAMBDAS = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 400];

// Escolha de λ por dois critérios out-of-sample, somados:
//
//   - HOLD-OUT: reajusta sem as células exatas de nível × contratação e prevê essas 10 células.
//     É o único cruzamento de duas dimensões com média e n reais, então mede de fato a
//     capacidade de prever combinações que o modelo não viu.
//   - ÂNCORA: pior desvio ao reproduzir as médias por nível publicadas pela pesquisa.
//
// Não usamos validação cruzada k-fold sobre todas as células: ela sai praticamente plana entre
// os λ, porque é dominada pelas ~290 células cruzadas ruidosas, e por isso não discrimina.
// Os dois critérios acima puxam em direções opostas (λ alto ajuda o hold-out e piora a âncora),
// e a soma escolhe o meio-termo.
function chooseLambda(model, officialLevel, candidates) {
  candidates = candidates || DEFAULT_LAMBDAS;
  const exact = model.cells.filter((c) => c.kind.startsWith("exata"));
  const trainNoExact = model.cells.filter((c) => !c.kind.startsWith("exata"));

  const scores = candidates.map((lambda) => {
    const full = fit(model, lambda);
    if (!full) return { lambda, score: Infinity };

    let anchorWorst = 0;
    Object.entries(officialLevel).forEach(([lvl, official]) => {
      const est = predict(model, full, { level: lvl });
      anchorWorst = Math.max(anchorWorst, Math.abs((est - official) / official) * 100);
    });

    const held = fit(model, lambda, { cells: trainNoExact });
    let holdout = 0;
    if (held) {
      exact.forEach((c) => {
        const a = {};
        for (const key in c.pinned) a[key] = model.dimByKey[key].cats[c.pinned[key]].label;
        holdout += Math.abs((predict(model, held, a) - c.mean) / c.mean) * 100;
      });
      holdout /= exact.length;
    } else {
      holdout = Infinity;
    }

    return { lambda, anchorWorst, holdout, score: anchorWorst + holdout };
  });

  const ranked = [...scores].sort((a, b) => a.score - b.score);
  return { best: ranked[0].lambda, scores, ranked };
}

// Covariância dos coeficientes: CV²·efeito_de_desenho·(XᵀWX + λI)⁻¹.
//
// Quantifica só a INCERTEZA AMOSTRAL — "se a pesquisa fosse refeita com outros respondentes,
// quanto essa estimativa se moveria". Não usamos os resíduos para estimar σ²: com pesos de
// milhares, resíduos minúsculos de desajuste do modelo dominariam a soma e produziriam erros
// padrão sem sentido (chegavam a centenas de %). O desajuste do modelo é reportado à parte,
// pelo hold-out.
//
// Base: Var(ln média) ≈ CV²/n, com o CV vindo da distribuição real de faixas da pesquisa.
//
// Efeito de desenho: as células reutilizam as MESMAS pessoas (quem é sênior aparece na célula
// de nível, na de linguagem, na de UF...). A soma dos pesos das células supera bastante o número
// real de respondentes, então tratá-las como independentes subestimaria a incerteza. Corrigimos
// escalando pela razão entre o peso total e o total de respondentes.
function coefficientCovariance(model, f, cells, cv) {
  cells = cells || model.cells;
  let totalW = 0;
  for (let i = 0; i < cells.length; i++) totalW += cells[i].w;
  const designEffect = totalW / model.overall.n;
  const scale = cv * cv * designEffect;

  const inv = inverseFromCholesky(f.cholesky);
  const cov = [];
  for (let i = 0; i < model.p; i++) {
    cov.push(new Float64Array(model.p));
    for (let j = 0; j < model.p; j++) cov[i][j] = inv[i][j] * scale;
  }
  return cov;
}

// Erro padrão (escala log) da predição para uma atribuição.
function predictionSE(model, cov, assignment) {
  const x = new Float64Array(model.p);
  x[0] = 1;
  for (const key in assignment) {
    const d = model.dimByKey[key];
    if (!d) continue;
    const k = d.index[assignment[key]];
    if (k === undefined) continue;
    const col = d.colOf[k];
    if (col >= 0) x[col] = 1;
  }
  let acc = 0;
  for (let i = 0; i < model.p; i++) {
    if (x[i] === 0) continue;
    for (let j = 0; j < model.p; j++) {
      if (x[j] === 0) continue;
      acc += x[i] * cov[i][j] * x[j];
    }
  }
  return Math.sqrt(Math.max(0, acc));
}

module.exports = {
  fit, predict, effectPct, chooseLambda, coefficientCovariance, predictionSE, mixtureOffset,
  populationLnZ, DEFAULT_LAMBDAS,
};
