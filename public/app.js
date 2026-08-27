(function () {
  "use strict";

  var DATA = window.SALARY_DATA;
  var EST = window.SalaryEstimator;
  var DIMENSIONS = EST.DIMENSIONS;

  // Dimensões com snapshot da edição 2025, para o indicador de tendência.
  var TREND_KEYS = { level: 1, workModel: 1, uf: 1, languages: 1 };

  // A partir daqui o modelo combina efeitos que a pesquisa nunca observou juntos.
  var MANY_CRITERIA = 6;

  function fmtBRL(n) {
    return Math.round(n).toLocaleString("pt-BR");
  }
  function fmtN(n) {
    return n.toLocaleString("pt-BR");
  }
  // Percentual no formato pt-BR (vírgula decimal), com sinal explícito quando pedido.
  function fmtPct(n, signed) {
    var s = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (signed) return (n >= 0 ? "+" : "−") + s + "%";
    return s + "%";
  }
  function el(id) {
    return document.getElementById(id);
  }
  function selectId(key) {
    return "sel-" + key;
  }

  function populateSelects() {
    DIMENSIONS.forEach(function (dim) {
      var select = el(selectId(dim.key));
      if (!select) return;
      var frag = document.createDocumentFragment();
      (DATA.dimensions[dim.key] || []).forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt.label;
        o.textContent = opt.label + " — R$ " + fmtBRL(opt.mean) + " (" + fmtN(opt.n) + ")";
        frag.appendChild(o);
      });
      select.appendChild(frag);
      select.addEventListener("change", onChange);
    });
  }

  function readSelections() {
    var sel = {};
    DIMENSIONS.forEach(function (dim) {
      var node = el(selectId(dim.key));
      if (node && node.value) sel[dim.key] = node.value;
    });
    return sel;
  }

  function compute() {
    var result = EST.estimate(DATA, readSelections());
    render(result);
  }

  function render(r) {
    el("result-amount").textContent = fmtBRL(r.mean);
    el("result-median").textContent = "R$ " + fmtBRL(r.median);
    el("result-range").textContent = "R$ " + fmtBRL(r.p25) + " — R$ " + fmtBRL(r.p75);
    var ci = el("result-ci");
    ci.textContent = "± " + fmtPct(r.ciPct);
    ci.title = "R$ " + fmtBRL(r.ci95[0]) + " a R$ " + fmtBRL(r.ci95[1]);

    renderConfidence(r);
    renderBreakdown(r);
    renderTrend(r);
  }

  function renderConfidence(r) {
    var dot = el("confidence-dot");
    var text = el("confidence-text");
    dot.className = "dot";

    if (!r.count) {
      text.textContent =
        "Sem filtros — média geral de " + fmtN(DATA.meta.totalResponses) + " respostas da pesquisa.";
    } else if (r.minN >= 300) {
      text.textContent =
        "Boa base estatística: o critério mais restritivo tem " + fmtN(r.minN) + " respostas.";
    } else if (r.minN >= 80) {
      dot.className = "dot warn";
      text.textContent = "Base moderada: o critério mais restritivo tem " + fmtN(r.minN) + " respostas.";
    } else {
      dot.className = "dot danger";
      text.textContent =
        "Base pequena (" + fmtN(r.minN) + " respostas): trate como indicativo, não como referência.";
    }

    var stacking = el("stacking-note");
    if (r.count >= MANY_CRITERIA) {
      stacking.hidden = false;
      stacking.textContent =
        "Com " + r.count +
        " critérios combinados a estimativa extrapola: a pesquisa não mede esse cruzamento específico. Prefira os critérios que mais pesam no seu caso.";
    } else {
      stacking.hidden = true;
    }

    var unid = el("unidentified-note");
    if (r.hasUnidentified) {
      var names = r.rows
        .filter(function (row) {
          return !row.identified;
        })
        .map(function (row) {
          return row.label.toLowerCase();
        });
      unid.hidden = false;
      unid.textContent =
        "A pesquisa não publica cruzamentos para " + names.join(", ") +
        ", então esses efeitos ainda embutem a senioridade de quem está no grupo — não são o efeito isolado do critério.";
    } else {
      unid.hidden = true;
    }
  }

  function renderBreakdown(r) {
    var list = el("breakdown-list");
    list.textContent = "";

    if (!r.count) {
      var empty = document.createElement("li");
      empty.className = "breakdown-empty";
      empty.textContent = "Selecione um ou mais critérios para personalizar a estimativa.";
      list.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();
    r.rows.forEach(function (row) {
      var li = document.createElement("li");
      if (!row.identified) li.className = "is-unidentified";

      var left = document.createElement("span");
      left.className = "breakdown-text";

      var label = document.createElement("span");
      label.className = "breakdown-label";
      label.textContent = row.label + ": " + row.option.label;
      if (!row.identified) {
        var mark = document.createElement("span");
        mark.className = "breakdown-flag";
        mark.textContent = "não isolado";
        mark.title = "A pesquisa não publica cruzamento desta dimensão com senioridade.";
        label.appendChild(mark);
      }

      var sub = document.createElement("span");
      sub.className = "breakdown-sub";
      // peso 1 = efeito aplicado por inteiro (o nível é a âncora do modelo)
      sub.textContent = "n=" + fmtN(row.option.n) + " · peso " + row.weight.toFixed(2);

      left.appendChild(label);
      left.appendChild(sub);

      var impact = document.createElement("span");
      impact.className = "breakdown-impact " + (row.pct >= 0 ? "up" : "down");
      impact.textContent = fmtPct(row.pct, true);

      li.appendChild(left);
      li.appendChild(impact);
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  function renderTrend(r) {
    var box = el("trend-box");
    var withTrend = [];
    r.rows.forEach(function (row) {
      if (!TREND_KEYS[row.key]) return;
      var prevTable = DATA.trend2025[row.key];
      var prev = prevTable && prevTable[row.option.label];
      if (prev) withTrend.push({ label: row.label, pct: ((row.option.mean - prev) / prev) * 100 });
    });

    if (!withTrend.length) {
      box.hidden = true;
      return;
    }
    var avg =
      withTrend.reduce(function (a, t) {
        return a + t.pct;
      }, 0) / withTrend.length;

    box.hidden = false;
    box.className = "trend" + (avg < 0 ? " down" : "");
    el("trend-text").textContent =
      (avg >= 0 ? "▲" : "▼") + " " + fmtPct(avg) +
      " vs. a pesquisa de 2025, considerando " +
      withTrend
        .map(function (t) {
          return t.label.toLowerCase();
        })
        .join(", ") + ".";
  }

  // --- Estado na URL, para o resultado ser compartilhável -------------------
  function syncUrl() {
    var params = new URLSearchParams();
    DIMENSIONS.forEach(function (dim) {
      var node = el(selectId(dim.key));
      if (node && node.value) params.set(dim.param, node.value);
    });
    var qs = params.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  function restoreFromUrl() {
    var params = new URLSearchParams(location.search);
    DIMENSIONS.forEach(function (dim) {
      var val = params.get(dim.param);
      if (!val) return;
      if (!EST.findOption(DATA, dim.key, val)) return;
      var node = el(selectId(dim.key));
      if (node) node.value = val;
    });
  }

  function onChange() {
    compute();
    syncUrl();
  }

  function copyLink() {
    var btn = el("share-btn");
    var restore = function (msg) {
      btn.textContent = msg;
      setTimeout(function () {
        btn.textContent = "Copiar link do resultado";
      }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(location.href).then(
        function () {
          restore("Link copiado!");
        },
        function () {
          restore("Não foi possível copiar");
        }
      );
    } else {
      restore("Copie da barra de endereços");
    }
  }

  function init() {
    el("hero-total").textContent = fmtN(DATA.meta.totalResponses);
    el("method-overall").textContent = fmtBRL(DATA.meta.overallMean);
    el("method-sample").textContent = fmtN(DATA.meta.minSample);
    el("data-collected").textContent = DATA.meta.collectedAt;

    populateSelects();
    restoreFromUrl();
    compute();

    el("reset-btn").addEventListener("click", function () {
      DIMENSIONS.forEach(function (dim) {
        var node = el(selectId(dim.key));
        if (node) node.value = "";
      });
      onChange();
    });
    el("share-btn").addEventListener("click", copyLink);
  }

  init();
})();
