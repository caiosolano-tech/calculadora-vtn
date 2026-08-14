import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// =====================================================================
// Extrai o texto de um PDF preservando a estrutura visual de linhas e
// colunas, agrupando os itens de texto por proximidade vertical (Y) e
// ordenando por posição horizontal (X) dentro de cada linha.
// =====================================================================
export async function extractLinesFromPdf(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .map((it) => ({ text: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter((it) => it.text.trim() !== '');

    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    const yTolerance = 2.5;
    for (const it of items) {
      let line = lines.find((l) => Math.abs(l.y - it.y) < yTolerance);
      if (!line) {
        line = { y: it.y, items: [] };
        lines.push(line);
      }
      line.items.push(it);
    }
    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      allLines.push({ page: pageNum, texts: line.items.map((i) => i.text) });
    }
  }
  return allLines;
}

// =====================================================================
// Utilitários de conversão de valores (comuns aos dois formatos)
// =====================================================================
function parseArea(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (s === '-' || s === '') return null;
  const num = s.replace(/\s*ha$/i, '').replace(/\./g, '').replace(',', '.');
  const v = parseFloat(num);
  return Number.isNaN(v) ? null : v;
}

function parseMoeda(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (s === '-' || s === '') return null;
  const num = s.replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.');
  const v = parseFloat(num);
  return Number.isNaN(v) ? null : v;
}

function parsePct(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/\s*%$/, '').replace(',', '.');
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
}

function linesEqual(items, labels) {
  if (items.length !== labels.length) return false;
  return items.every((t, i) => t.trim() === labels[i]);
}

function findValueAfter(lines, labels, opts = {}) {
  const { fromIndex = 0, toIndex = lines.length } = opts;
  for (let i = fromIndex; i < toIndex - 1; i++) {
    if (linesEqual(lines[i].texts, labels)) {
      return lines[i + 1].texts;
    }
  }
  return null;
}

// =====================================================================
// FORMATO A — declaração no layout "Receita Federal / Receitanet" (a
// mesma sequência de páginas DIAC → DIAT, rótulos em frase corrida sem
// numeração). Ex.: "Área Total do Imóvel", "Preservação permanente".
// =====================================================================
function detectaFormatoA(lines) {
  return lines.some((l) => l.texts.length === 1 && /^Identificação CIB:/.test(l.texts[0]));
}

function parseFormatoA(lines) {
  const idxContribuinte = lines.findIndex((l) => linesEqual(l.texts, ['Identificação do Contribuinte']));

  const cibLine = lines.find((l) => l.texts.length === 1 && /^Identificação CIB:/.test(l.texts[0]));
  const cib = cibLine ? cibLine.texts[0].replace('Identificação CIB:', '').trim() : null;

  const nomeLine = lines.find((l) => l.texts.length === 1 && /^Nome do Imóvel Rural:/.test(l.texts[0]));
  const nomeImovel = nomeLine ? nomeLine.texts[0].replace('Nome do Imóvel Rural:', '').trim() : null;

  const exercicioLine = lines.find((l) => l.texts.length === 1 && /Exercício \d{4}/.test(l.texts[0]));
  const exercicioMatch = exercicioLine && exercicioLine.texts[0].match(/Exercício (\d{4})/);
  const exercicio = exercicioMatch ? Number(exercicioMatch[1]) : null;

  const munUfCep = findValueAfter(lines, ['Município', 'UF', 'CEP'], {
    toIndex: idxContribuinte > -1 ? idxContribuinte : lines.length,
  });
  const municipio = munUfCep ? munUfCep[0].trim() : null;
  const uf = munUfCep ? munUfCep[1].trim() : null;

  const get1 = (label) => {
    const v = findValueAfter(lines, [label]);
    return v ? v[0] : null;
  };
  const getRow = (labels) => findValueAfter(lines, labels) || labels.map(() => null);

  const [areaTotalImovel, preservacaoPermanente, reservaLegal] =
    getRow(['Área Total do Imóvel', 'Preservação permanente', 'Reserva legal']);
  const [reservaParticular, interesseEcologico, servidaoAmbiental] =
    getRow(['Reserva particular do patrimônio natural', 'Interesse ecológico', 'Servidão ambiental']);
  const florestasNativas = get1('Coberta por florestas nativas');
  const areaAlagadaReservatorio = get1('Área Alagada de Reservatório de Usinas Hidrelétricas Autorizada pelo Poder Público');
  const areaTributavel = get1('Área Tributável');
  const benfeitoriasUteis = get1('Área Ocupada com Benfeitorias Úteis e Necessárias Destinadas à Atividade Rural');
  const areaAproveitavel = get1('Área Aproveitável');

  const [produtosVegetais, areaEmDescanso] = getRow(['Produtos vegetais', 'Área em descanso']);
  const reflorestamento = get1('Reflorestamento (Essências Exóticas ou Nativas)');
  const [pastagemTotal, exploracaoExtrativa, atividadeGranjeira] =
    getRow(['Pastagem', 'Exploração extrativa', 'Atividade granjeira ou aquícola']);
  const frustracaoSafra = get1('Frustração de Safra ou Destruição de Pastagem por Calamidade Pública');

  const grauUtilizacao = get1('Grau de utilização');

  const numeroCAR = get1('Número do CAR');
  const adaLine = lines.find((l) => l.texts.length === 1 && /^Número do recibo do ADA/.test(l.texts[0]));
  let numeroADA = null;
  if (adaLine) {
    const idx = lines.indexOf(adaLine);
    numeroADA = lines[idx + 1] ? lines[idx + 1].texts[0] : null;
  }

  const [demaisBenfeitorias, areaMineracao] =
    getRow(['Área com Demais Benfeitorias', 'Área de Mineração (jazida/mina)']);
  const areaImprestavel = get1('Área Imprestável para a Atividade Rural não Declarada de Interesse Ecológico');
  const [areaInexplorada, outrasAreas] =
    getRow(['Área Inexplorada', 'Outras Áreas', 'Área não Utilizada na Atividade Rural']);

  const valorTotalImovel = get1('Valor total do imóvel');
  const valorConstrucoes = get1('Valor das construções, instalações e benfeitorias');
  const valorCulturasPastagens = get1('Valor das culturas, pastagens cultivadas e melhoradas e florestas plantadas');
  const valorTerraNua = get1('Valor da terra nua');
  const [valorTerraNuaTributavel, aliquotaDeclarada] = getRow(['Valor da terra nua tributável', 'Alíquota']);
  const [impostoCalculado, impostoDevido] = getRow(['Imposto calculado', 'Imposto devido']);

  const [pastagemNativaLbl, pastagemPlantadaLbl, forrageiraCorte] =
    getRow(['Pastagem nativa', 'Pastagem plantada', 'Forrageira de corte']);

  return {
    formato: 'A',
    cib, nomeImovel, exercicio, municipio, uf,
    areaTotalImovel: parseArea(areaTotalImovel),
    preservacaoPermanente: parseArea(preservacaoPermanente),
    reservaLegal: parseArea(reservaLegal),
    reservaParticular: parseArea(reservaParticular),
    interesseEcologico: parseArea(interesseEcologico),
    servidaoAmbiental: parseArea(servidaoAmbiental),
    florestasNativas: parseArea(florestasNativas),
    areaAlagadaReservatorio: parseArea(areaAlagadaReservatorio),
    areaTributavel: parseArea(areaTributavel),
    benfeitoriasUteis: parseArea(benfeitoriasUteis),
    areaAproveitavel: parseArea(areaAproveitavel),
    produtosVegetais: parseArea(produtosVegetais),
    areaEmDescanso: parseArea(areaEmDescanso),
    reflorestamento: parseArea(reflorestamento),
    pastagemTotal: parseArea(pastagemTotal),
    exploracaoExtrativa: parseArea(exploracaoExtrativa),
    atividadeGranjeira: parseArea(atividadeGranjeira),
    frustracaoSafra: parseArea(frustracaoSafra),
    grauUtilizacao: parsePct(grauUtilizacao),
    numeroCAR: numeroCAR && numeroCAR !== '-' ? numeroCAR : null,
    numeroADA: numeroADA && numeroADA !== '-' ? numeroADA : null,
    demaisBenfeitorias: parseArea(demaisBenfeitorias),
    areaMineracao: parseArea(areaMineracao),
    areaImprestavel: parseArea(areaImprestavel),
    areaInexplorada: parseArea(areaInexplorada),
    outrasAreas: parseArea(outrasAreas),
    pastagemNativa: parseArea(pastagemNativaLbl),
    pastagemPlantada: parseArea(pastagemPlantadaLbl),
    forrageiraCorte: parseArea(forrageiraCorte),
    declarado: {
      valorTotalImovel: parseMoeda(valorTotalImovel),
      valorConstrucoes: parseMoeda(valorConstrucoes),
      valorCulturasPastagens: parseMoeda(valorCulturasPastagens),
      valorTerraNua: parseMoeda(valorTerraNua),
      valorTerraNuaTributavel: parseMoeda(valorTerraNuaTributavel),
      aliquota: parsePct(aliquotaDeclarada),
      impostoCalculado: parseMoeda(impostoCalculado),
      impostoDevido: parseMoeda(impostoDevido),
    },
  };
}

// =====================================================================
// FORMATO B — declaração impressa pelo "MIDAS / Módulo de Impressão de
// Declarações" (Programa ITR desktop). Traz uma folha de rosto extra no
// início (deslocando DIAC/DIAT uma página adiante) e usa rótulos
// numerados ("01. Área Total do Imóvel", "02. Área de Preservação
// Permanente" etc.), com rótulo e valor na MESMA linha.
// =====================================================================
function detectaFormatoB(lines) {
  return lines.some((l) => l.texts.length === 1 && l.texts[0] === 'FOLHA DE ROSTO')
    || lines.some((l) => l.texts[0] && /^IDENTIFICAÇÃO CIB:/.test(l.texts[0]));
}

function parseFormatoB(lines) {
  const idxContribuinte = lines.findIndex((l) => l.texts.length === 1 && l.texts[0] === 'IDENTIFICAÇÃO DO CONTRIBUINTE');

  const cibLine = lines.find((l) => l.texts[0] && /^IDENTIFICAÇÃO CIB:/.test(l.texts[0]));
  const cib = cibLine ? cibLine.texts[1] : null;

  const nomeLine = lines.find((l) => l.texts[0] === 'NOME DO IMÓVEL RURAL:');
  const nomeImovel = nomeLine ? nomeLine.texts[1] : null;

  const exercicioLine = lines.find((l) => l.texts[0] === 'Exercício:');
  const exercicio = exercicioLine ? Number(exercicioLine.texts[1]) : null;

  // Município/UF do imóvel — primeira ocorrência de "UF:"/"Município:" antes
  // da seção "IDENTIFICAÇÃO DO CONTRIBUINTE" (que repete o mesmo padrão para
  // o endereço do declarante).
  const munUfLine = lines.find((l, i) =>
    l.texts[0] === 'UF:' && l.texts[2] === 'Município:'
    && (idxContribuinte === -1 || i < idxContribuinte));
  const uf = munUfLine ? munUfLine.texts[1] : null;
  const municipio = munUfLine ? munUfLine.texts[3] : null;

  // Campos numerados: rótulo e valor na mesma linha (texts[0] = rótulo
  // completo incluindo o número, texts[1] = valor).
  const get1 = (labelExato) => {
    const l = lines.find((ln) => ln.texts[0] === labelExato);
    return l ? l.texts[1] : null;
  };
  // Alguns rótulos têm o número variável de posição (ex.: "Número do
  // Recibo do ADA 2025/Ibama" muda o ano) — busca por prefixo com regex.
  const get1Regex = (regex) => {
    const l = lines.find((ln) => ln.texts[0] && regex.test(ln.texts[0]));
    return l ? l.texts[1] : null;
  };

  const areaTotalImovel = get1('01. Área Total do Imóvel');
  const preservacaoPermanente = get1('02. Área de Preservação Permanente');
  const reservaLegal = get1('03. Área de Reserva Legal');
  const reservaParticular = get1('04. Área de Reserva Particular do Patrimônio Natural (RPPN)');
  const interesseEcologico = get1('05. Área de Interesse Ecológico');
  const servidaoAmbiental = get1('06. Área de Servidão Ambiental');
  const florestasNativas = get1('07. Área Coberta por Florestas Nativas');
  const areaAlagadaReservatorio = get1('08. Área Alagada de Reservatório de Usinas Hidrelétricas Autorizada pelo Poder Público');
  const areaTributavel = get1('09. Área Tributável');
  const benfeitoriasUteis = get1('10. Área Ocupada com Benfeitorias Úteis e Necessárias Destinadas à Atividade Rural');
  const areaAproveitavel = get1('11. Área Aproveitável');

  const produtosVegetais = get1('12. Área de Produtos Vegetais');
  const areaEmDescanso = get1('13. Área em Descanso');
  const reflorestamento = get1('14. Área de Reflorestamento (Essências Exóticas ou Nativas)');
  const pastagemTotal = get1('15. Área de Pastagem');
  const exploracaoExtrativa = get1('16. Área de Exploração Extrativa');
  const atividadeGranjeira = get1('17. Área de Atividade Granjeira ou Aquícola');
  const frustracaoSafra = get1('18. Área de Frustração de Safra ou Destruição de Pastagem por Calamidade Pública');

  const grauUtilizacao = get1('20. GRAU DE UTILIZAÇÃO (%)');

  const numeroADA = get1Regex(/^Número do Recibo do ADA \d{4}\/Ibama$/);
  const numeroCAR = get1('Número do CAR');

  const demaisBenfeitorias = get1('21. Área com Demais Benfeitorias');
  const areaMineracao = get1('22. Área com Mineração (jazida/mina)');
  const areaImprestavel = get1('23. Área Imprestável para a Atividade Rural Não Declarada de Interesse Ecológico');
  const areaInexplorada = get1('24. Área Inexplorada');
  const outrasAreas = get1('25. Outras Áreas');

  const valorTotalImovel = get1('01. Valor Total do Imóvel');
  const valorConstrucoes = get1('02. Valor das Construções, Instalações e Benfeitorias');
  const valorCulturasPastagens = get1('03. Valor das Culturas, Pastagens Cultivadas e Melhoradas e Florestas Plantadas');
  const valorTerraNua = get1('04. Valor da Terra Nua');
  const valorTerraNuaTributavel = get1('05. Valor da Terra Nua Tributável');
  const aliquotaDeclarada = get1('06. Alíquota (%)');
  const impostoCalculado = get1('07. Imposto Calculado');
  const impostoDevido = get1('08. Imposto Devido');

  const pastagemNativaLbl = get1('04. Pastagem Nativa');
  const pastagemPlantadaLbl = get1('05. Pastagem Plantada');
  const forrageiraCorte = get1('06. Forrageira de Corte');

  return {
    formato: 'B',
    cib, nomeImovel, exercicio, municipio, uf,
    areaTotalImovel: parseArea(areaTotalImovel),
    preservacaoPermanente: parseArea(preservacaoPermanente),
    reservaLegal: parseArea(reservaLegal),
    reservaParticular: parseArea(reservaParticular),
    interesseEcologico: parseArea(interesseEcologico),
    servidaoAmbiental: parseArea(servidaoAmbiental),
    florestasNativas: parseArea(florestasNativas),
    areaAlagadaReservatorio: parseArea(areaAlagadaReservatorio),
    areaTributavel: parseArea(areaTributavel),
    benfeitoriasUteis: parseArea(benfeitoriasUteis),
    areaAproveitavel: parseArea(areaAproveitavel),
    produtosVegetais: parseArea(produtosVegetais),
    areaEmDescanso: parseArea(areaEmDescanso),
    reflorestamento: parseArea(reflorestamento),
    pastagemTotal: parseArea(pastagemTotal),
    exploracaoExtrativa: parseArea(exploracaoExtrativa),
    atividadeGranjeira: parseArea(atividadeGranjeira),
    frustracaoSafra: parseArea(frustracaoSafra),
    grauUtilizacao: parsePct(grauUtilizacao),
    numeroCAR: numeroCAR && numeroCAR !== '-' ? numeroCAR : null,
    numeroADA: numeroADA && numeroADA !== '-' ? numeroADA : null,
    demaisBenfeitorias: parseArea(demaisBenfeitorias),
    areaMineracao: parseArea(areaMineracao),
    areaImprestavel: parseArea(areaImprestavel),
    areaInexplorada: parseArea(areaInexplorada),
    outrasAreas: parseArea(outrasAreas),
    pastagemNativa: parseArea(pastagemNativaLbl),
    pastagemPlantada: parseArea(pastagemPlantadaLbl),
    forrageiraCorte: parseArea(forrageiraCorte),
    declarado: {
      valorTotalImovel: parseMoeda(valorTotalImovel),
      valorConstrucoes: parseMoeda(valorConstrucoes),
      valorCulturasPastagens: parseMoeda(valorCulturasPastagens),
      valorTerraNua: parseMoeda(valorTerraNua),
      valorTerraNuaTributavel: parseMoeda(valorTerraNuaTributavel),
      aliquota: parsePct(aliquotaDeclarada),
      impostoCalculado: parseMoeda(impostoCalculado),
      impostoDevido: parseMoeda(impostoDevido),
    },
  };
}

// =====================================================================
// PARSER PRINCIPAL — detecta automaticamente qual dos dois formatos
// conhecidos foi enviado e delega para o parser correspondente. Se
// nenhum dos dois padrões for reconhecido, retorna tudo em branco (o
// chamador deve tratar isso como "arquivo não reconhecido", sem
// inventar dados).
// =====================================================================
export function parseDeclaracaoITR(lines) {
  if (detectaFormatoB(lines)) return parseFormatoB(lines);
  if (detectaFormatoA(lines)) return parseFormatoA(lines);
  // Formato desconhecido: tenta o Formato A como fallback (mais comum),
  // mas os campos provavelmente virão vazios — o app trata isso como erro.
  return parseFormatoA(lines);
}

// =====================================================================
// Converte os campos brutos da declaração nas 7 categorias da nossa
// calculadora. Áreas que não têm correspondência clara com nenhuma das
// 7 categorias (ex.: "área em descanso", "exploração extrativa") são
// somadas em "naoClassificado" e sinalizadas ao operador — nunca são
// atribuídas silenciosamente a uma categoria por suposição.
// =====================================================================
export function mapCategoriasFromDeclaracao(d) {
  const lavoura = d.produtosVegetais ?? 0;
  const reflorestamento = d.reflorestamento ?? 0;
  const ambiental = (d.preservacaoPermanente ?? 0) + (d.reservaLegal ?? 0) + (d.reservaParticular ?? 0)
    + (d.interesseEcologico ?? 0) + (d.servidaoAmbiental ?? 0) + (d.florestasNativas ?? 0)
    + (d.areaAlagadaReservatorio ?? 0);
  const benfeitorias = (d.benfeitoriasUteis ?? 0) + (d.demaisBenfeitorias ?? 0);
  const imprestavel = (d.areaMineracao ?? 0) + (d.areaImprestavel ?? 0) + (d.areaInexplorada ?? 0) + (d.outrasAreas ?? 0);

  let naoClassificado = (d.areaEmDescanso ?? 0) + (d.exploracaoExtrativa ?? 0)
    + (d.atividadeGranjeira ?? 0) + (d.frustracaoSafra ?? 0) + (d.forrageiraCorte ?? 0);

  let pastagemNativa = d.pastagemNativa;
  let pastagemPlantada = d.pastagemPlantada;
  let pastagemIndefinida = false;
  if (pastagemNativa == null && pastagemPlantada == null) {
    pastagemIndefinida = (d.pastagemTotal ?? 0) > 0;
    pastagemNativa = 0;
    pastagemPlantada = 0;
  } else {
    pastagemNativa = pastagemNativa ?? 0;
    pastagemPlantada = pastagemPlantada ?? 0;
  }

  return {
    lavoura, pastagemPlantada, pastagemNativa, reflorestamento, ambiental, benfeitorias, imprestavel,
    naoClassificado,
    pastagemIndefinida,
    pastagemTotalDeclarada: d.pastagemTotal ?? 0,
    areaTotalDeclarada: d.areaTotalImovel,
  };
}
