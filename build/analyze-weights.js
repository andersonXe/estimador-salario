// Relatório dos pesos de combinação medidos nas tabelas cruzadas da pesquisa.
// A medição vive em build/lib/attenuation.js (usada também pelo process-data).
//
// Uso: npm run analyze
const { loadSurvey } = require("./lib/load");
const { measureAttenuations } = require("./lib/attenuation");

const data = loadSurvey();
const { weights, detail, fallback, unidentified } = measureAttenuations(
  data.raw, data.crosstabs, data.frameworksCross, data.levelXWorkModel, data.frameworks
);

console.log("=== Atenuação: quanto do efeito marginal sobra após controlar por nível ===\n");
console.log("  ~1  a dimensão tem efeito próprio, independente da senioridade");
console.log("  ~0  o efeito é só reflexo de quais níveis compõem a categoria\n");

Object.entries(detail).forEach(([name, d]) => {
  console.log(
    `  ${name.padEnd(12)} ${d.slope.toFixed(3)}  (R²=${d.r2.toFixed(3)}, ${d.nPoints} pontos) — ${d.method}`
  );
  if (!d.points) return;
  [...d.points]
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .forEach((p) => {
      const total = (Math.exp(p.x) - 1) * 100;
      const resid = (Math.exp(p.y) - 1) * 100;
      const lbl = p.lvl ? `${p.cat} × ${p.lvl}` : p.cat;
      console.log(
        `      ${lbl.slice(0, 38).padEnd(38)} total ${total >= 0 ? "+" : ""}${total.toFixed(1)}%  ->  próprio ${resid >= 0 ? "+" : ""}${resid.toFixed(1)}%`
      );
    });
  console.log();
});

console.log(`  Padrão para dimensões SEM cruzamento publicado: ${fallback.toFixed(3)}`);
console.log(`  (${unidentified.join(", ")}) — efeitos permanecem confundidos com senioridade\n`);
console.log("  Pesos finais:");
Object.entries(weights)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => {
    const mark = unidentified.indexOf(k) >= 0 ? "  (não desconfundido)" : "";
    console.log(`    ${k.padEnd(14)} ${v.toFixed(3)}${mark}`);
  });
