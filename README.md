# Estimador de Salário Dev (Brasil)

🔗 **Publicado em:** https://andersonxe.github.io/estimador-salario/
(deploy automático via GitHub Actions a cada push em `main`, ver `.github/workflows/deploy.yml`)

Calculadora que estima o salário mensal de um(a) desenvolvedor(a) no Brasil combinando
os dados reais da [Pesquisa Salarial de Programadores 2026](https://pesquisa.codigofonte.com.br/2026),
do Código Fonte TV (17.046 respostas).

## Como funciona

1. **`data/`** — snapshots brutos extraídos de `window.__NEXT_DATA__.props.pageProps.survey`
   na página da pesquisa: tabelas cruzadas de faixa salarial × categoria (nível, experiência,
   área, linguagem, framework, UF, formação, contratação, setor, inglês, exterior), mais um
   snapshot da edição 2025 (`surveyOld`) usado só para mostrar tendência ano a ano.
2. **`build/process-data.js`** — converte cada faixa salarial (ex.: "Entre 9.001 e 12.000") no
   seu ponto médio, calcula a média ponderada por categoria e gera um índice
   `média da categoria / média geral`. Saída: `public/salary-data.js`.
3. **`public/`** — app estático (HTML/CSS/JS puro, sem build step) que lê `salary-data.js` e
   combina os índices das categorias selecionadas com pesos diferentes (nível pesa mais;
   dimensões correlacionadas, como experiência e framework, pesam menos para não haver
   dupla contagem).

## Rodar localmente

```bash
npm start
```

Abre em `http://localhost:5173`.

## Atualizar os dados (nova edição da pesquisa)

O site publica uma edição por ano em `https://pesquisa.codigofonte.com.br/<ano>` (ex.: `/2025`,
`/2026`), e os dados brutos ficam embutidos no HTML da página em
`window.__NEXT_DATA__.props.pageProps.survey`. Para atualizar:

1. Abra a URL da nova edição no navegador.
2. No console, rode:
   ```js
   copy(JSON.stringify(window.__NEXT_DATA__.props.pageProps.survey))
   ```
3. Cole o resultado em `data/survey-<ano>-raw.json` (separe `salary_by_frameworks` num arquivo
   à parte se o JSON ficar muito grande, como foi feito para 2026).
4. Ajuste os `require(...)` no topo de `build/process-data.js` para apontar pro novo arquivo.
5. Rode `npm run build-data` para regerar `public/salary-data.js`.

Isso também serve para comparar múltiplas edições (a pesquisa está disponível desde 2021) caso
queira ampliar o recurso de tendência histórica, hoje limitado a 2025→2026.

## Metodologia e limitações

- As faixas salariais da pesquisa são intervalos (ex.: "R$ 9.001 a R$ 12.000"); usamos o ponto
  médio de cada intervalo para estimar a média. A última faixa ("Acima de R$ 50.000") é aberta —
  usamos R$ 60.000 como valor representativo.
- A combinação de múltiplos critérios é um modelo multiplicativo de índices amortecidos por
  peso, não uma regressão ajustada aos dados brutos (a pesquisa só disponibiliza tabelas
  agregadas, não as respostas individuais). É uma boa aproximação para orientação de mercado,
  não uma previsão precisa.
- Amostragem por conveniência (divulgada pelos canais do Código Fonte TV) — pode haver viés de
  quem responde. Categorias com poucas respostas (`n` baixo) são sinalizadas na interface como
  de confiança menor, e categorias com menos de 15 respostas (ou menos de 1 para dimensões
  ordinais como nível/experiência) são descartadas no processamento.
