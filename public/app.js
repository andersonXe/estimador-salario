(function () {
  const DATA = window.SALARY_DATA;

  // id do <select> no HTML -> chave em DATA.dimensions -> peso na combinação multiplicativa.
  // Pesos menores que 1 amortecem dimensões que já são parcialmente explicadas por outras
  // (ex.: "experiência" e "framework" correlacionam fortemente com "nível" e "linguagem").
  const DIMENSIONS = [
    { id: "level", key: "level", label: "Nível", weight: 1.0 },
    { id: "experience", key: "experience", label: "Experiência", weight: 0.35 },
    { id: "graduation", key: "graduation", label: "Formação", weight: 0.45 },
    { id: "area", key: "area", label: "Área de atuação", weight: 0.5 },
    { id: "language", key: "languages", label: "Linguagem", weight: 0.4 },
    { id: "framework", key: "frameworks", label: "Framework/ferramenta", weight: 0.3 },
    { id: "uf", key: "uf", label: "Estado", weight: 0.6 },
    { id: "workModel", key: "workModel", label: "Contratação", weight: 0.55 },
    { id: "sector", key: "sector", label: "Setor", weight: 0.35 },
    { id: "englishLevel", key: "englishLevel", label: "Inglês", weight: 0.3 },
    { id: "foreignJob", key: "foreignJob", label: "Empresa no exterior", weight: 0.5 },
  ];

  // Dimensões para as quais temos o snapshot da edição 2025 (comparação de tendência).
  const TREND_KEYS = new Set(["level", "workModel", "uf", "languages"]);

  const fmtBRL = (n) => Math.round(n).toLocaleString("pt-BR");
  const fmtN = (n) => n.toLocaleString("pt-BR");

  function populateSelects() {
    DIMENSIONS.forEach((dim) => {
      const select = document.getElementById(dim.id);
      const options = DATA.dimensions[dim.key] || [];
      options.forEach((opt) => {
        const el = document.createElement("option");
        el.value = opt.label;
        el.textContent = `${opt.label} (${fmtN(opt.n)} resp.)`;
        select.appendChild(el);
      });
      select.addEventListener("change", compute);
    });
  }

  function findTrendOption(key, label) {
    const table = DATA.trend2025[key];
    if (!table) return null;
    return table.find((o) => o.label === label) || null;
  }

  function compute() {
    let product = 1;
    let minN = Infinity;
    const breakdown = [];

    DIMENSIONS.forEach((dim) => {
      const select = document.getElementById(dim.id);
      const val = select.value;
      if (!val) return;
      const opt = (DATA.dimensions[dim.key] || []).find((o) => o.label === val);
      if (!opt) return;
      const factor = Math.pow(opt.index, dim.weight);
      product *= factor;
      minN = Math.min(minN, opt.n);

      let trend = null;
      if (TREND_KEYS.has(dim.key)) {
        const prev = findTrendOption(dim.key, val);
        if (prev && prev.mean > 0) {
          trend = ((opt.mean - prev.mean) / prev.mean) * 100;
        }
      }

      breakdown.push({ dim, opt, factor, trend });
    });

    const hasFilters = breakdown.length > 0;
    const estimate = DATA.meta.overallMean * product;

    renderResult(estimate, hasFilters, minN);
    renderBreakdown(breakdown);
    renderTrend(breakdown);
  }

  function renderResult(estimate, hasFilters, minN) {
    document.getElementById("result-amount").textContent = fmtBRL(estimate);

    const spread = 0.18;
    const low = estimate * (1 - spread);
    const high = estimate * (1 + spread);
    document.getElementById("result-range").innerHTML =
      `R$ ${fmtBRL(low)} — R$ ${fmtBRL(high)}`;

    const dot = document.getElementById("confidence-dot");
    const text = document.getElementById("confidence-text");
    dot.classList.remove("warn", "danger");

    if (!hasFilters) {
      text.textContent = "Sem filtros aplicados — exibindo a média geral da pesquisa (17.046 respostas).";
    } else if (minN >= 200) {
      text.textContent = `Boa confiança estatística — grupo com ${fmtN(minN)} respostas na pesquisa.`;
    } else if (minN >= 40) {
      dot.classList.add("warn");
      text.textContent = `Confiança moderada — o critério mais restritivo selecionado tem ${fmtN(minN)} respostas.`;
    } else {
      dot.classList.add("danger");
      text.textContent = `Amostra pequena (${fmtN(minN)} respostas) — resultado mais sujeito a ruído estatístico.`;
    }
  }

  function renderBreakdown(breakdown) {
    const list = document.getElementById("breakdown-list");
    list.innerHTML = "";

    if (breakdown.length === 0) {
      const li = document.createElement("li");
      li.className = "breakdown-empty";
      li.textContent = "Selecione um ou mais critérios ao lado para personalizar a estimativa.";
      list.appendChild(li);
      return;
    }

    breakdown.forEach(({ dim, opt, factor }) => {
      const li = document.createElement("li");
      const pct = (factor - 1) * 100;
      const sign = pct >= 0 ? "+" : "";
      li.innerHTML = `
        <span>
          <span class="breakdown-label">${dim.label}: ${opt.label}</span>
          <span class="breakdown-sub">n=${fmtN(opt.n)}</span>
        </span>
        <span class="breakdown-impact ${pct >= 0 ? "up" : "down"}">${sign}${pct.toFixed(1)}%</span>
      `;
      list.appendChild(li);
    });
  }

  function renderTrend(breakdown) {
    const box = document.getElementById("trend-box");
    const withTrend = breakdown.filter((b) => b.trend !== null);
    if (withTrend.length === 0) {
      box.hidden = true;
      return;
    }
    const avgTrend = withTrend.reduce((a, b) => a + b.trend, 0) / withTrend.length;
    const sign = avgTrend >= 0 ? "▲" : "▼";
    box.hidden = false;
    box.classList.toggle("down", avgTrend < 0);
    document.getElementById("trend-text").innerHTML =
      `${sign} <strong>${Math.abs(avgTrend).toFixed(1)}%</strong> em relação à pesquisa de 2025, para ${withTrend
        .map((b) => b.dim.label.toLowerCase())
        .join(" + ")}.`;
  }

  function init() {
    document.getElementById("hero-total").textContent = fmtN(DATA.meta.totalResponses);
    document.getElementById("method-overall").textContent = fmtBRL(DATA.meta.overallMean);
    populateSelects();
    compute();

    document.getElementById("reset-btn").addEventListener("click", () => {
      DIMENSIONS.forEach((dim) => {
        document.getElementById(dim.id).value = "";
      });
      compute();
    });
  }

  init();
})();
