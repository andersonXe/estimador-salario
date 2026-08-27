// Álgebra linear mínima para o ajuste de mínimos quadrados ponderados com ridge.
// JS puro, sem dependências — o problema é pequeno (~150 colunas) e denso.

// Resolve (A + λI) x = b para A simétrica positiva-definida, via Cholesky.
// Retorna null se A não for definida positiva (indica colinearidade sem ridge suficiente).
function choleskySolve(A, b, lambda) {
  var n = A.length;
  var L = [];
  var i, j, k;
  for (i = 0; i < n; i++) L.push(new Float64Array(n));

  for (i = 0; i < n; i++) {
    for (j = 0; j <= i; j++) {
      var sum = A[i][j] + (i === j ? lambda : 0);
      for (k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        L[i][i] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }

  // L y = b
  var y = new Float64Array(n);
  for (i = 0; i < n; i++) {
    var s = b[i];
    for (k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  // Lᵀ x = y
  var x = new Float64Array(n);
  for (i = n - 1; i >= 0; i--) {
    var s2 = y[i];
    for (k = i + 1; k < n; k++) s2 -= L[k][i] * x[k];
    x[i] = s2 / L[i][i];
  }
  return { x: x, L: L };
}

// Inversa de uma matriz simétrica positiva-definida a partir do seu fator de Cholesky.
// Usada para a matriz de covariância dos coeficientes.
function inverseFromCholesky(L) {
  var n = L.length;
  // Inverte L (triangular inferior)
  var Li = [];
  var i, j, k;
  for (i = 0; i < n; i++) Li.push(new Float64Array(n));
  for (i = 0; i < n; i++) {
    Li[i][i] = 1 / L[i][i];
    for (j = 0; j < i; j++) {
      var s = 0;
      for (k = j; k < i; k++) s += L[i][k] * Li[k][j];
      Li[i][j] = -s / L[i][i];
    }
  }
  // A⁻¹ = Li ᵀ Li
  var inv = [];
  for (i = 0; i < n; i++) inv.push(new Float64Array(n));
  for (i = 0; i < n; i++) {
    for (j = 0; j <= i; j++) {
      var acc = 0;
      for (k = Math.max(i, j); k < n; k++) acc += Li[k][i] * Li[k][j];
      inv[i][j] = acc;
      inv[j][i] = acc;
    }
  }
  return inv;
}

// Mínimos quadrados ponderados com regularização ridge.
// rows: [{ x: Float64Array (p), y: number, w: number }]
// Retorna { beta, XtWX, cholesky, fitted, residuals }
function weightedRidgeFit(rows, p, lambda) {
  var XtWX = [];
  var i, j, r;
  for (i = 0; i < p; i++) XtWX.push(new Float64Array(p));
  var XtWy = new Float64Array(p);

  for (r = 0; r < rows.length; r++) {
    var row = rows[r];
    var x = row.x;
    var w = row.w;
    for (i = 0; i < p; i++) {
      var xi = x[i];
      if (xi === 0) continue;
      var wxi = w * xi;
      XtWy[i] += wxi * row.y;
      for (j = 0; j <= i; j++) {
        if (x[j] === 0) continue;
        XtWX[i][j] += wxi * x[j];
      }
    }
  }
  // espelha a parte inferior na superior
  for (i = 0; i < p; i++) for (j = 0; j < i; j++) XtWX[j][i] = XtWX[i][j];

  var sol = choleskySolve(XtWX, XtWy, lambda);
  if (!sol) return null;

  var beta = sol.x;
  var fitted = new Float64Array(rows.length);
  var residuals = new Float64Array(rows.length);
  for (r = 0; r < rows.length; r++) {
    var xr = rows[r].x;
    var acc = 0;
    for (i = 0; i < p; i++) if (xr[i] !== 0) acc += xr[i] * beta[i];
    fitted[r] = acc;
    residuals[r] = rows[r].y - acc;
  }

  return { beta: beta, XtWX: XtWX, cholesky: sol.L, fitted: fitted, residuals: residuals };
}

// R² ponderado
function weightedR2(rows, fitted) {
  var sw = 0, swy = 0, r;
  for (r = 0; r < rows.length; r++) {
    sw += rows[r].w;
    swy += rows[r].w * rows[r].y;
  }
  var mean = swy / sw;
  var ssRes = 0, ssTot = 0;
  for (r = 0; r < rows.length; r++) {
    ssRes += rows[r].w * Math.pow(rows[r].y - fitted[r], 2);
    ssTot += rows[r].w * Math.pow(rows[r].y - mean, 2);
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : null;
}

module.exports = { choleskySolve, inverseFromCholesky, weightedRidgeFit, weightedR2 };
