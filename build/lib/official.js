// Médias publicadas na própria página da pesquisa (calculadas sobre as respostas individuais).
// Servem para validar o que derivamos das faixas e para o teste de âncora do modelo.
// Fonte: https://pesquisa.codigofonte.com.br/2026
const OFFICIAL_LEVEL = {
  "Estágio": 2586.84,
  "Júnior": 5060.34,
  "Pleno": 8466.52,
  "Sênior": 14607.85,
  "Outro (Especialista, Tech Lead, Principal)": 20601.64,
};

const OFFICIAL_MEANS = {
  salary_by_level: OFFICIAL_LEVEL,
  salary_by_work_model: { CLT: 10165.98, PJ: 13436.23, Outro: 10199.77 },
  salary_by_brazil_uf: {
    "São Paulo (SP)": 11113.03, "Minas Gerais (MG)": 10565.64, "Santa Catarina (SC)": 11166.93,
    "Paraná (PR)": 10160.05, "Rio de Janeiro (RJ)": 10382.38, "Rio Grande do Sul (RS)": 11329.7,
    "Ceará (CE)": 10348.04, "Goiás (GO)": 10084.12, "Distrito Federal (DF)": 11796.62,
    "Pernambuco (PE)": 10318.31, "Bahia (BA)": 10609.93, "Espírito Santo (ES)": 11147.18,
  },
  salary_by_languages: {
    Java: 11456.87, "C#": 11206.42, TypeScript: 11142.04, Python: 10644.32, JavaScript: 10070.66,
    PHP: 10210.08, Go: 13641.58, Kotlin: 13505.59, Dart: 10565.06,
    "Delphi (Object Pascal)": 9364.84, Ruby: 12214.47, SQL: 10587.35,
  },
  salary_by_frameworks: {
    "Spring Boot": 11865.32, ".NET (Standard, Core, Framework)": 11645.61, React: 10479.97,
    Outro: 11003.72, Laravel: 9901.85, Nenhum: 11139.09, "Node.js": 11241.81, Angular: 11114.33,
    NestJS: 10492.49, FastAPI: 10806.79, "Next.js": 10503.69, Django: 10898.93,
  },
};

module.exports = { OFFICIAL_LEVEL, OFFICIAL_MEANS };
