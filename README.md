# Estimador de Salário Dev (Brasil)

🔗 **https://andersonxe.github.io/estimador-salario/**

Calculadora que estima o salário mensal de um dev no Brasil a partir da
[Pesquisa Salarial de Programadores 2026](https://pesquisa.codigofonte.com.br/2026) do Código Fonte
TV (17.046 respostas). Site estático, sem dependências, deploy automático via GitHub Actions.

---

## O problema central

A pesquisa publica apenas **dados agregados** — médias e distribuições por categoria, nunca as
respostas individuais. Isso impõe duas dificuldades que definem todo o projeto:

**1. Dupla contagem.** As médias de grupos diferentes se sobrepõem. Quem é sênior *também* aparece
na média de quem tem 10+ anos de experiência e na de quem tem pós-graduação. Multiplicar os três
efeitos inteiros superestima o resultado, porque em boa parte é o mesmo efeito contado três vezes.

**2. Identificação.** Separar o efeito próprio de um critério do efeito da composição do grupo só é
possível onde a pesquisa publica um **cruzamento**. Nenhuma sofisticação estatística cria
informação que não está nos dados.

## Como o modelo resolve

```
estimativa = média_geral × Π (índice_da_categoria) ^ (peso_da_dimensão)
```

O **peso** é a atenuação: quanto do efeito daquele critério sobrevive depois de descontar a
senioridade. Ele **não foi escolhido a dedo** — é medido nas tabelas cruzadas da própria pesquisa
(`build/lib/attenuation.js`), por três métodos conforme o que existe publicado:

| Dimensão | Peso | Como foi medido | R² |
|---|---|---|---|
| Nível | 1,000 | âncora do modelo (referência) | — |
| Estado | 0,664 | média condicional UF × nível | 0,31 |
| Linguagem | 0,625 | média condicional linguagem × nível | 0,43 |
| Framework | 0,536 | média condicional framework × nível | 0,36 |
| Contratação | 0,533 | **cruzamento exato** nível × CLT/PJ | 0,71 |
| Formação | 0,351 | composição de níveis | 0,96 |
| Experiência | 0,285 | composição de níveis | 0,95 |
| Área, setor, inglês, exterior | 0,499 | *sem cruzamento publicado* | — |

Formação com peso 0,35 significa: do salário 27% maior de quem tem pós-graduação, só cerca de um
terço é da pós — o resto é essas pessoas serem, em média, mais seniores.

### O que o modelo NÃO resolve

Para **área, setor, inglês e exterior** a pesquisa não publica cruzamento nenhum. Esses efeitos
seguem confundidos com senioridade, e a interface marca cada um como **“não isolado”**. Eles usam a
média das atenuações medidas como estimativa — é o melhor palpite disponível, não uma medição.

## As duas incertezas (que não são a mesma coisa)

A interface separa deliberadamente:

- **Faixa entre pessoas** (p25–p75, reconstruída das faixas salariais): larga, tipicamente ±40%.
  É onde metade das pessoas com aquele perfil realmente está.
- **Intervalo de confiança da estimativa** (IC 95%): estreito, ±1,3% sem filtros. Diz só o quanto a
  *média* se moveria se a pesquisa fosse refeita. Calculado analiticamente por
  `Var(ln média) ≈ CV²/n`, propagado pelos pesos.

Confundir os dois é o erro clássico em calculadoras salariais: apresentar ±X% arbitrário como se
fosse intervalo de confiança. Aqui os dois aparecem, rotulados, com magnitudes muito diferentes.

## Validação

```bash
npm run validate
```

Sai com código ≠ 0 se qualquer teste falhar:

1. **Pontos médios de faixa** — as faixas são intervalos ("R$ 9.001 a 12.000"); usamos o ponto
   médio. Calibrando as duas faixas ambíguas (a primeira e a aberta do topo) contra as médias
   oficiais, reproduzimos as **44 médias publicadas com MAPE de 0,005%** — evidência de que a
   pesquisa usou exatamente esse método, e de que as médias das categorias cujo valor oficial não é
   divulgado são igualmente confiáveis.
2. **Âncora** — prever só o nível reproduz a média oficial daquele nível (erro ≤ 0,06%).
3. **Cruzamentos reais** — prevê 300 células (categoria × nível) publicadas pela pesquisa:
   erro médio **6,5%**.
4. **Cenários de sanidade** — perfis realistas e extremos permanecem em faixa plausível.
5. **Sanidade do IC** — sem filtros bate com `CV/√N` teórico; amostra pequena alarga o intervalo.

## Testamos a alternativa mais sofisticada — e ela perdeu

Uma crítica razoável ao modelo acima é que ele é multiplicativo com pesos por dimensão, não uma
regressão que estima tudo conjuntamente. Implementamos essa regressão de verdade
(`build/lib/design.js`, `matrix.js`, `fit.js`): log-linear ponderada sobre 450 células agregadas,
139 parâmetros, ridge com λ por validação, misturas tratadas de forma não-linear (para evitar o
viés de Jensen de ~8% que aparece ao misturar níveis em log) e correção de retransformação de Duan.

```bash
npm run fit       # relatório da regressão
npm run compare   # comparação justa entre os dois
```

Prevendo as **mesmas 300 células cruzadas reais**, com validação cruzada 5-fold para a regressão:

| Modelo | MAPE | Ponderado | Mediana |
|---|---|---|---|
| Regressão log-linear conjunta | 7,15% | 4,56% | 5,54% |
| **Modelo publicado** | **6,49%** | **3,68%** | **4,77%** |

O modelo simples vence em **todos** os tipos de célula. Motivo: com dados agregados o gargalo é
identificação, não sofisticação do estimador. A regressão tem 138 parâmetros livres ajustados a
células ruidosas e com peso aproximado (a pesquisa não publica o n das células cruzadas) — a
variância extra supera o ganho de flexibilidade. Ela também extrapolava pior: R$ 91 mil no perfil
máximo, contra R$ 56 mil.

O código da regressão continua no repositório como evidência e para revalidar em edições futuras,
quando pode haver mais cruzamentos publicados.

## Rodar

```bash
npm start
```

Abre em `http://localhost:5173`. Scripts disponíveis:

| Comando | O que faz |
|---|---|
| `npm run build-data` | Regenera `public/salary-data.js` a partir de `data/` |
| `npm run validate` | Bateria de validação (falha com exit ≠ 0) |
| `npm run analyze` | Detalha como cada peso foi medido |
| `npm run fit` | Ajusta e diagnostica a regressão conjunta |
| `npm run compare` | Compara os dois modelos |
| `npm run check` | build-data + validate + compare |

## Estrutura

```
data/                     snapshots brutos da pesquisa (JSON)
build/
  lib/stats.js            pontos médios calibrados, médias ponderadas, percentis, CV
  lib/attenuation.js      medição dos pesos nas tabelas cruzadas   <- modelo publicado
  lib/design.js           montagem das células e da matriz         <- regressão (alternativa)
  lib/matrix.js           Cholesky + ridge, JS puro
  lib/fit.js              ajuste iterativo, smearing, covariância
  process-data.js         gera o artefato do site
  validate.js             bateria de validação
public/
  estimator.js            o modelo — compartilhado entre navegador e validação
  app.js, index.html, style.css
```

`public/estimator.js` é usado tanto pelo site quanto pelo `validate.js`: o que é testado é
exatamente o que é publicado.

## Atualizar para uma nova edição

Os dados ficam embutidos no HTML da página, em `window.__NEXT_DATA__.props.pageProps.survey`. As
edições vão de 2021 a 2026 — basta trocar o ano na URL.

1. Abra `https://pesquisa.codigofonte.com.br/<ano>`.
2. No console: `copy(JSON.stringify(window.__NEXT_DATA__.props.pageProps.survey))`.
3. Distribua nos arquivos de `data/` seguindo o padrão de 2026 (o principal, frameworks e os
   cruzamentos ficam separados por tamanho).
4. `npm run check`.

Vale conferir se a nova edição publica cruzamentos que hoje faltam (área × nível, por exemplo) —
seriam ganho direto de identificação.

## Limitações

- Amostragem por conveniência, divulgada pelos canais do Código Fonte TV: a audiência do canal está
  super-representada.
- Respostas autodeclaradas, coletadas entre 23/02/2026 e 09/06/2026.
- Categorias com menos de 30 respostas são descartadas.
- O modelo não captura interações além da senioridade, nem fatores decisivos como porte da empresa,
  desempenho individual ou negociação.
- Combinar muitos critérios extrapola: a interface avisa a partir de 6.

É um panorama de mercado — não uma previsão do seu salário.

---

Projeto independente, sem fins comerciais e sem vínculo com o Código Fonte TV. Créditos dos dados à
pesquisa e ao processamento de Tiago Tomazetti.
