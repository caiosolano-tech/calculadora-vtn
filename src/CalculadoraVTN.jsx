import React, { useState, useMemo, useRef } from 'react';
import {
  Sprout, MapPin, Calculator, AlertTriangle, TrendingUp, TrendingDown, Info, ClipboardCopy,
  ChevronDown, ChevronUp, Leaf, Table2, PenLine, FileDown, User, Plus, X, UploadCloud,
  FileCheck2, Loader2, CheckCircle2,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import VTN_DATA_2026 from './vtn_2026.json';
import { extractLinesFromPdf, parseDeclaracaoITR, mapCategoriasFromDeclaracao } from './parseDeclaracaoITR';
import { LOGO_SAFRAS_CIFRAS_PNG_BASE64 } from './logoSafrasCifras';
import { POPPINS_REGULAR_BASE64, POPPINS_BOLD_BASE64 } from './poppinsFont';

// =====================================================================
// PALETA E TOKENS DE DESIGN
// =====================================================================
const C = {
  bg: '#F6F4EE',
  paper: '#FFFFFF',
  ink: '#1C2620',
  inkSoft: '#54614F',
  forest: '#1F5C3F',
  forestDark: '#153F2B',
  forestSoft: '#E7EFE7',
  clay: '#B5652E',
  claySoft: '#F6E9DD',
  wheat: '#D8A93A',
  wheatSoft: '#FBF1DA',
  line: '#DFDACD',
  danger: '#A3382C',
  dangerSoft: '#F7E7E4',
};

const CATEGORIAS = [
  { key: 'lavoura', label: 'Lavoura', usaAptidao: true },
  { key: 'pastagemPlantada', label: 'Pastagem Plantada', usaAptidao: false },
  { key: 'pastagemNativa', label: 'Pastagem Nativa', usaAptidao: false },
  { key: 'reflorestamento', label: 'Reflorestamento', usaAptidao: false },
  { key: 'ambiental', label: 'Ambiental (preservação)', usaAptidao: false },
  { key: 'benfeitorias', label: 'Benfeitorias', usaAptidao: false },
  { key: 'imprestavel', label: 'Imprestável / Não utilizada', usaAptidao: false },
];

function getVtnFieldIndex(catKey, aptidao) {
  switch (catKey) {
    case 'lavoura':
      if (aptidao === 'BOA') return 2;
      if (aptidao === 'REGULAR') return 3;
      return 4;
    case 'pastagemPlantada': return 5;
    case 'pastagemNativa': return 6;
    case 'reflorestamento': return 6;
    case 'ambiental': return 7;
    case 'benfeitorias': return 7;
    case 'imprestavel': return 7;
    default: return null;
  }
}

const NOME_CAMPO_VTN = {
  2: 'Lavoura Aptidão Boa',
  3: 'Lavoura Aptidão Regular',
  4: 'Lavoura Aptidão Restrita',
  5: 'Pastagem Plantada',
  6: 'Silvicultura ou Pastagem Natural',
  7: 'Preservação da Fauna e da Flora',
};

const CAMPOS_PAUTA = [2, 3, 4, 5, 6, 7];

const ALIQUOTA_FAIXAS = [
  { limite: 49.9, aliquota: 0.0003, label: 'até 50 ha' },
  { limite: 199.9, aliquota: 0.0007, label: '50,1 a 200 ha' },
  { limite: 499.9, aliquota: 0.0010, label: '200,1 a 500 ha' },
  { limite: 999.9, aliquota: 0.0015, label: '500,1 a 1.000 ha' },
  { limite: 4999.9, aliquota: 0.0030, label: '1.000,1 a 5.000 ha' },
  { limite: Infinity, aliquota: 0.0045, label: 'acima de 5.000 ha' },
];

function getAliquota(areaTotal) {
  if (!(areaTotal > 0)) return { aliquota: 0, label: '—' };
  for (const faixa of ALIQUOTA_FAIXAS) {
    if (areaTotal <= faixa.limite) return faixa;
  }
  return ALIQUOTA_FAIXAS[ALIQUOTA_FAIXAS.length - 1];
}

// =====================================================================
// MOTOR DE CÁLCULO — função pura
// =====================================================================
function calcularVTN({ modo, areaTotal, aptidao, areas, vtnRow, vtnHaAnterior, vtnManual, areaNaoTributavelManual }) {
  const areaTotalNum = Number(areaTotal) || 0;
  const inconsistencias = [];

  if (modo === 'manual') {
    const vtnPorHa = Number(vtnManual) || 0;
    const areaNaoTrib = Number(areaNaoTributavelManual) || 0;
    const vtnTotal = areaTotalNum * vtnPorHa;
    const areaTributavel = round1(areaTotalNum - areaNaoTrib);
    const coeficiente = areaTotalNum > 0 ? truncate(areaTributavel / areaTotalNum, 4) : 0;
    const vtnTributavel = vtnTotal * coeficiente;
    const faixaAliquota = getAliquota(areaTotalNum);
    const imposto = vtnTributavel * faixaAliquota.aliquota;

    const anteriorNum = Number(vtnHaAnterior);
    const diferencaPct = anteriorNum > 0 ? (vtnPorHa / anteriorNum) * 100 - 100 : null;

    if (areaTotalNum <= 0) inconsistencias.push('Informe a área total do imóvel (maior que zero).');
    if (vtnPorHa <= 0) inconsistencias.push('Informe o VTN por hectare do imóvel (maior que zero).');
    if (areaNaoTrib > areaTotalNum) inconsistencias.push('Erro: a área não tributável ultrapassa a área total do imóvel.');

    return {
      itens: [], somaAreas: 0, saldo: 0, vtnTotal, vtnPorHa, diferencaPct,
      areaAmbiental: areaNaoTrib, areaTributavel, coeficiente, faixaAliquota, imposto,
      inconsistencias, areaTotalNum,
    };
  }

  const itens = CATEGORIAS.map((cat) => {
    const area = Number(areas[cat.key]) || 0;
    const idx = getVtnFieldIndex(cat.key, aptidao);
    const vtnUnitario = vtnRow ? vtnRow[idx] : null;
    const indisponivel = area > 0 && (vtnUnitario === null || vtnUnitario === undefined);
    const vtnParcial = vtnUnitario != null ? area * vtnUnitario : 0;
    return { ...cat, area, idxCampo: idx, nomeCampoVtn: NOME_CAMPO_VTN[idx], vtnUnitario, indisponivel, vtnParcial };
  });

  const somaAreas = round1(itens.reduce((s, i) => s + i.area, 0));
  const saldo = round1(areaTotalNum - somaAreas);

  const temIndisponivel = itens.some((i) => i.indisponivel);
  const vtnTotal = itens.reduce((s, i) => s + i.vtnParcial, 0);
  const vtnPorHa = areaTotalNum > 0 ? vtnTotal / areaTotalNum : 0;

  const anteriorNum = Number(vtnHaAnterior);
  const diferencaPct = anteriorNum > 0 ? (vtnPorHa / anteriorNum) * 100 - 100 : null;

  const areaAmbiental = itens.find((i) => i.key === 'ambiental').area;
  const areaTributavel = round1(areaTotalNum - areaAmbiental);
  const coeficiente = areaTotalNum > 0 ? truncate(areaTributavel / areaTotalNum, 4) : 0;
  const vtnTributavel = vtnTotal * coeficiente;
  const faixaAliquota = getAliquota(areaTotalNum);
  const imposto = vtnTributavel * faixaAliquota.aliquota;

  if (areaTotalNum <= 0) inconsistencias.push('Informe a área total do imóvel (maior que zero).');
  if (saldo > 0.05) inconsistencias.push(`Existem ${formatHA(saldo)} ainda não classificados.`);
  if (saldo < -0.05) inconsistencias.push('Erro: a soma das áreas informadas ultrapassa a área total do imóvel.');
  if (temIndisponivel) inconsistencias.push('Há categoria com área informada, mas sem valor de VTN disponível para este município — verifique abaixo.');

  return {
    itens, somaAreas, saldo, vtnTotal, vtnPorHa, diferencaPct,
    areaAmbiental, areaTributavel, coeficiente, faixaAliquota, imposto,
    inconsistencias, areaTotalNum,
  };
}

function round1(n) { return Math.round(n * 10) / 10; }
function truncate(n, casas) { const f = Math.pow(10, casas); return Math.trunc(n * f) / f; }
function formatHA(n) { return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ha'; }
function formatBRL(n) { if (n == null || Number.isNaN(n)) return '—'; return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatPct1(n) { return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
function formatPct2(n) { return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }

function normalizaTexto(s) {
  return (s || '').trim().toUpperCase();
}

let contadorId = 0;
function criarImovelVazio() {
  contadorId += 1;
  return {
    id: `im_${Date.now()}_${contadorId}`,
    nomeImovel: '', cib: '',
    uf: '', municipio: '', aptidao: 'BOA', areaTotal: '', vtnHaAnterior: '',
    areas: { lavoura: '', pastagemPlantada: '', pastagemNativa: '', reflorestamento: '', ambiental: '', benfeitorias: '', imprestavel: '' },
    modo: 'automatico', vtnManual: '', areaNaoTributavelManual: '',
    importado: null,
  };
}

// =====================================================================
// COMPONENTE
// =====================================================================
export default function CalculadoraVTN() {
  const ufs = useMemo(() => {
    const s = new Set(VTN_DATA_2026.map((r) => r[0]));
    return Array.from(s).sort();
  }, []);

  const [imoveis, setImoveis] = useState(() => [criarImovelVazio()]);
  const [vtnGlobal, setVtnGlobal] = useState('');
  const [vtnGlobalAplicado, setVtnGlobalAplicado] = useState(false);
  const [activeId, setActiveId] = useState(() => imoveis[0].id);
  const [memoriaAberta, setMemoriaAberta] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const [tentouGerar, setTentouGerar] = useState(false);
  const [importando, setImportando] = useState(false);
  const [previewImportacao, setPreviewImportacao] = useState(null);
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);

  const activeIndex = Math.max(0, imoveis.findIndex((im) => im.id === activeId));
  const imovel = imoveis[activeIndex] || imoveis[0];

  function updateActiveImovel(patch) {
    setImoveis((prev) => prev.map((im) => (im.id === activeId ? { ...im, ...patch } : im)));
    setTentouGerar(false);
  }
  function updateActiveAreas(key, value) {
    setImoveis((prev) => prev.map((im) => (im.id === activeId ? { ...im, areas: { ...im.areas, [key]: value } } : im)));
  }

  function handleNovoImovel() {
    const novo = criarImovelVazio();
    setImoveis((prev) => [...prev, novo]);
    setActiveId(novo.id);
    setTentouGerar(false);
  }

  function handleAplicarVtnGlobal() {
    const valor = Number(vtnGlobal);
    if (!(valor > 0)) return;
    setImoveis((prev) => prev.map((im) => {
      // Preserva uma área não tributável já digitada manualmente; caso contrário,
      // usa a área "Ambiental" já conhecida do imóvel (digitada ou importada da
      // declaração de ITR) — sem isso, o modo manual zerava essa área.
      const jaTemManual = im.areaNaoTributavelManual !== '' && Number(im.areaNaoTributavelManual) > 0;
      const areaNaoTributavelManual = jaTemManual
        ? im.areaNaoTributavelManual
        : (im.areas.ambiental || '');
      return { ...im, modo: 'manual', vtnManual: String(valor), areaNaoTributavelManual };
    }));
    setVtnGlobalAplicado(true);
    setTimeout(() => setVtnGlobalAplicado(false), 2500);
  }

  function handleRemoverImovel(id, ev) {
    ev.stopPropagation();
    setImoveis((prev) => {
      const resto = prev.filter((im) => im.id !== id);
      if (resto.length === 0) {
        const novo = criarImovelVazio();
        setActiveId(novo.id);
        return [novo];
      }
      if (id === activeId) setActiveId(resto[0].id);
      return resto;
    });
  }

  const municipios = useMemo(() => {
    if (!imovel.uf) return [];
    return VTN_DATA_2026.filter((r) => r[0] === imovel.uf).map((r) => r[1]).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [imovel.uf]);

  const vtnRow = useMemo(() => {
    if (!imovel.uf || !imovel.municipio) return null;
    return VTN_DATA_2026.find((r) => r[0] === imovel.uf && r[1] === imovel.municipio) || null;
  }, [imovel.uf, imovel.municipio]);

  const resultado = useMemo(() => calcularVTN({
    modo: imovel.modo, areaTotal: imovel.areaTotal, aptidao: imovel.aptidao, areas: imovel.areas,
    vtnRow, vtnHaAnterior: imovel.vtnHaAnterior, vtnManual: imovel.vtnManual,
    areaNaoTributavelManual: imovel.areaNaoTributavelManual,
  }), [imovel, vtnRow]);

  const bloqueado = resultado.inconsistencias.some((m) => m.startsWith('Erro'));
  const semIdentificacao = imoveis.filter((im) => !im.nomeImovel.trim() || !im.cib.trim());
  const identificacaoFaltando = tentouGerar && (!imovel.nomeImovel.trim() || !imovel.cib.trim());
  const algumSemIdentificacao = tentouGerar && semIdentificacao.length > 0;

  async function processarArquivos(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (files.length === 0) return;
    setImportando(true);
    const resultados = [];
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const lines = await extractLinesFromPdf(buf);
        const parsed = parseDeclaracaoITR(lines);
        if (!parsed.cib && !parsed.nomeImovel) {
          resultados.push({ arquivo: file.name, erro: 'Não foi possível reconhecer este arquivo como uma declaração de ITR (DIAT/DIAC).' });
          continue;
        }
        const categorias = mapCategoriasFromDeclaracao(parsed);
        const municipioEncontrado = VTN_DATA_2026.find(
          (r) => r[0] === normalizaTexto(parsed.uf) && r[1] === normalizaTexto(parsed.municipio)
        );
        resultados.push({ arquivo: file.name, parsed, categorias, municipioEncontrado: !!municipioEncontrado, incluir: true });
      } catch (err) {
        resultados.push({ arquivo: file.name, erro: 'Falha ao ler o PDF (arquivo corrompido ou em formato não suportado).' });
      }
    }
    setPreviewImportacao(resultados);
    setImportando(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleArquivosSelecionados(e) {
    processarArquivos(e.target.files);
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
      dragCounter.current += 1;
      setArrastandoArquivo(true);
    }
  }
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setArrastandoArquivo(false);
    }
  }
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setArrastandoArquivo(false);
    processarArquivos(e.dataTransfer.files);
  }

  function alternarInclusaoPreview(idx) {
    setPreviewImportacao((prev) => prev.map((r, i) => (i === idx ? { ...r, incluir: !r.incluir } : r)));
  }

  function handleConfirmarImportacao() {
    const validos = previewImportacao.filter((r) => !r.erro && r.incluir);
    setImoveis((prev) => {
      let novaLista = [...prev];
      const soExisteVazio = prev.length === 1 && !prev[0].nomeImovel && !prev[0].cib && !prev[0].areaTotal;
      if (soExisteVazio) novaLista = [];

      let primeiroNovoId = null;
      for (const r of validos) {
        const { parsed, categorias } = r;
        const cibNormalizado = parsed.cib;
        const existenteIdx = novaLista.findIndex((im) => im.cib && cibNormalizado && im.cib === cibNormalizado);
        const municipioEncontrado = VTN_DATA_2026.find(
          (row) => row[0] === normalizaTexto(parsed.uf) && row[1] === normalizaTexto(parsed.municipio)
        );
        const novoImovel = {
          ...criarImovelVazio(),
          nomeImovel: parsed.nomeImovel || '',
          cib: parsed.cib || '',
          uf: municipioEncontrado ? municipioEncontrado[0] : '',
          municipio: municipioEncontrado ? municipioEncontrado[1] : '',
          areaTotal: parsed.areaTotalImovel != null ? String(parsed.areaTotalImovel) : '',
          areas: {
            lavoura: String(round1(categorias.lavoura)),
            pastagemPlantada: String(round1(categorias.pastagemPlantada)),
            pastagemNativa: String(round1(categorias.pastagemNativa)),
            reflorestamento: String(round1(categorias.reflorestamento)),
            ambiental: String(round1(categorias.ambiental)),
            benfeitorias: String(round1(categorias.benfeitorias)),
            imprestavel: String(round1(categorias.imprestavel)),
          },
          importado: {
            arquivoNome: r.arquivo,
            exercicioDeclaracao: parsed.exercicio,
            naoClassificado: round1(categorias.naoClassificado),
            pastagemIndefinida: categorias.pastagemIndefinida,
            pastagemTotalDeclarada: categorias.pastagemTotalDeclarada,
            declarado: parsed.declarado,
            municipioNaoEncontrado: !municipioEncontrado,
          },
        };
        if (existenteIdx > -1) {
          novaLista[existenteIdx] = { ...novoImovel, id: novaLista[existenteIdx].id };
          if (!primeiroNovoId) primeiroNovoId = novaLista[existenteIdx].id;
        } else {
          novaLista.push(novoImovel);
          if (!primeiroNovoId) primeiroNovoId = novoImovel.id;
        }
      }
      if (primeiroNovoId) setActiveId(primeiroNovoId);
      return novaLista;
    });
    setPreviewImportacao(null);
  }

  function handleCancelarImportacao() {
    setPreviewImportacao(null);
  }

  function handleCopiar() {
    const linhas = imovel.modo === 'automatico'
      ? resultado.itens.filter((i) => i.area > 0)
        .map((i) => `${i.label}: ${formatHA(i.area)} × ${i.vtnUnitario != null ? formatBRL(i.vtnUnitario) : 'indisponível'}/ha = ${formatBRL(i.vtnParcial)}`)
      : [`VTN informado manualmente: ${formatBRL(resultado.vtnPorHa)}/ha`];
    const texto = [
      `Calculadora de VTN — ${imovel.municipio || '(município)'}/${imovel.uf || '--'} — Exercício 2026`,
      `Área total: ${formatHA(resultado.areaTotalNum)}`,
      ...linhas,
      `VTN Total: ${formatBRL(resultado.vtnTotal)}`,
      `VTN Ponderado: ${formatBRL(resultado.vtnPorHa)}/ha`,
      `Área tributável: ${formatHA(resultado.areaTributavel)} · Coeficiente: ${resultado.coeficiente}`,
      `Alíquota (GU>80%, ${resultado.faixaAliquota.label}): ${formatPct2(resultado.faixaAliquota.aliquota * 100)}`,
      `Imposto (ITR) estimado: ${formatBRL(resultado.imposto)}`,
    ].join('\n');
    navigator.clipboard?.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  function handleGerarRelatorio() {
    const semIdentificacao = imoveis.filter((im) => !im.nomeImovel.trim() || !im.cib.trim());
    if (semIdentificacao.length > 0) {
      setTentouGerar(true);
      return;
    }

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.addFileToVFS('Poppins-Regular.ttf', POPPINS_REGULAR_BASE64);
    doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal');
    doc.addFileToVFS('Poppins-Bold.ttf', POPPINS_BOLD_BASE64);
    doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold');

    const pageW = 210;
    const margem = 14;
    const FOREST = [21, 63, 43];
    const FOREST_SOFT = [231, 239, 231];
    const INK_SOFT = [90, 100, 85];

    // Calcula o resultado de cada imóvel da sessão (não só o ativo)
    const linhasRelatorio = imoveis.map((im) => {
      const linha = VTN_DATA_2026.find((r) => r[0] === im.uf && r[1] === im.municipio) || null;
      const res = calcularVTN({
        modo: im.modo, areaTotal: im.areaTotal, aptidao: im.aptidao, areas: im.areas,
        vtnRow: linha, vtnHaAnterior: im.vtnHaAnterior, vtnManual: im.vtnManual,
        areaNaoTributavelManual: im.areaNaoTributavelManual,
      });
      const temErro = res.inconsistencias.some((m) => m.startsWith('Erro'));
      return { im, vtnRow: linha, resultado: res, temErro };
    });

    // --- Faixa superior (banner) ---
    doc.setFillColor(...FOREST);
    doc.rect(0, 0, pageW, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(15);
    doc.text('Gestão Fundiária', margem, 15);
    try {
      doc.addImage(LOGO_SAFRAS_CIFRAS_PNG_BASE64, 'PNG', pageW - margem - 16, 4, 16, 16 * (283 / 300));
    } catch (e) { /* segue sem logo se falhar */ }

    let y = 34;
    doc.setTextColor(0, 0, 0);
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(16);
    doc.text('Relatório de VTN e ITR', margem, y);
    y += 6;
    doc.setFont('Poppins', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK_SOFT);
    const dataGeracao = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const qtdTexto = imoveis.length === 1 ? '1 imóvel' : `${imoveis.length} imóveis`;
    doc.text(`${qtdTexto} · Exercício 2026 · Gerado em ${dataGeracao}`, margem, y);

    doc.setDrawColor(...FOREST);
    doc.setLineWidth(0.6);
    y += 4;
    doc.line(margem, y, pageW - margem, y);
    y += 8;

    const sectionHeader = (titulo, yPos) => {
      doc.setFillColor(...FOREST_SOFT);
      doc.rect(margem, yPos, pageW - margem * 2, 7, 'F');
      doc.setFont('Poppins', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...FOREST);
      doc.text(titulo, margem + 3, yPos + 5);
      return yPos + 7;
    };

    function garantirEspaco(alturaNecessaria) {
      if (y + alturaNecessaria > 280) {
        doc.addPage();
        y = 20;
      }
    }

    // --- Tabela de valores de pauta (municípios distintos envolvidos) ---
    const municipiosDistintos = [];
    const vistos = new Set();
    for (const { im, vtnRow: vr } of linhasRelatorio) {
      if (im.uf && im.municipio && !vistos.has(im.uf + '|' + im.municipio)) {
        vistos.add(im.uf + '|' + im.municipio);
        municipiosDistintos.push({ uf: im.uf, municipio: im.municipio, vtnRow: vr });
      }
    }

    if (municipiosDistintos.length > 0) {
      garantirEspaco(20);
      y = sectionHeader('Valores de pauta — Receita Federal, Exercício 2026', y);
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        margin: { left: margem, right: margem },
        headStyles: { fillColor: FOREST, fontSize: 7.5, font: 'Poppins', fontStyle: 'bold' },
        styles: { fontSize: 7.5, cellPadding: 1.6, font: 'Poppins' },
        head: [['Município/UF', ...CAMPOS_PAUTA.map((idx) => NOME_CAMPO_VTN[idx])]],
        body: municipiosDistintos.map((m) => [
          `${m.municipio}/${m.uf}`,
          ...CAMPOS_PAUTA.map((idx) => (m.vtnRow && m.vtnRow[idx] != null ? formatBRL(m.vtnRow[idx]) : 'indisponível')),
        ]),
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // --- Um quadro verde de resumo por imóvel ---
    const boxH = 36;
    for (const { im, resultado: res, temErro } of linhasRelatorio) {
      garantirEspaco(boxH + 4);

      doc.setFillColor(...FOREST);
      doc.roundedRect(margem, y, pageW - margem * 2, boxH, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);

      doc.setFont('Poppins', 'bold');
      doc.setFontSize(12);
      doc.text(im.nomeImovel, margem + 5, y + 8);
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(9);
      doc.text(`CIB: ${im.cib}`, pageW - margem - 5, y + 8, { align: 'right' });

      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.2);
      doc.line(margem + 5, y + 11, pageW - margem - 5, y + 11);

      doc.setFont('Poppins', 'normal');
      doc.setFontSize(7.5);
      doc.text('IMPOSTO (ITR) ESTIMADO', margem + 5, y + 18);
      doc.setFont('Poppins', 'bold');
      doc.setFontSize(17);
      doc.text(temErro ? '—' : formatBRL(res.imposto), margem + 5, y + 27);

      const colX = [100, 135, 165];
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(7.5);
      doc.text('VTN/ha', colX[0], y + 18);
      doc.text('Alíquota', colX[1], y + 18);
      doc.text('Área tributável', colX[2], y + 18);
      doc.setFont('Poppins', 'bold');
      doc.setFontSize(10.5);
      doc.text(temErro ? '—' : `${formatBRL(res.vtnPorHa)}/ha`, colX[0], y + 25);
      doc.text(temErro ? '—' : formatPct2(res.faixaAliquota.aliquota * 100), colX[1], y + 25);
      doc.text(temErro ? '—' : formatHA(res.areaTributavel), colX[2], y + 25);

      if (im.municipio) {
        doc.setFont('Poppins', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(220, 230, 222);
        doc.text(`${im.municipio}/${im.uf}`, margem + 5, y + 33);
      }

      y += boxH + 5;
    }

    // --- Rodapé (todas as páginas) ---
    const totalPaginas = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPaginas; p++) {
      doc.setPage(p);
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...INK_SOFT);
      doc.text('Gestão Fundiária', margem, 289);
      doc.text(`Página ${p} de ${totalPaginas}`, pageW - margem, 289, { align: 'right' });
    }

    const nomeArquivo = imoveis.length === 1
      ? `Relatorio_VTN_${imovel.nomeImovel.replace(/\s+/g, '_')}.pdf`
      : `Relatorio_VTN_Lote_${imoveis.length}_imoveis.pdf`;
    doc.save(nomeArquivo);
  }

  return (
    <div className="vtn-app min-h-screen w-full" style={{ background: C.bg, color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        .vtn-app, .vtn-app * { font-family: 'Poppins', system-ui, sans-serif; }
        .vtn-mono { font-variant-numeric: tabular-nums; }
        .vtn-app input[type=number] { -moz-appearance: textfield; }
        .vtn-app input[type=number]::-webkit-outer-spin-button,
        .vtn-app input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>

      <header className="border-b" style={{ borderColor: C.line }}>
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.forest }}>
            <Sprout size={20} color="#fff" />
          </div>
          <div>
            <p className="text-xs tracking-widest uppercase font-semibold" style={{ color: C.forest }}>Gestão Fundiária · Safras &amp; Cifras</p>
            <h1 className="text-2xl md:text-3xl font-extrabold leading-tight" style={{ color: C.forestDark }}>Calculadora de VTN Ponderado</h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pt-6">
        <div className="rounded-2xl p-4 shadow-sm mb-6" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.inkSoft }}>Imóveis nesta sessão ({imoveis.length})</p>
            <button type="button" onClick={handleNovoImovel}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{ background: '#fff', color: C.forest, border: `1px dashed ${C.forest}` }}
            >
              <Plus size={14} /> Novo imóvel
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {imoveis.map((im) => (
              <button
                key={im.id}
                type="button"
                onClick={() => setActiveId(im.id)}
                className="group flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
                style={im.id === activeId ? { background: C.forest, color: '#fff' } : { background: C.bg, color: C.inkSoft, border: `1px solid ${C.line}` }}
              >
                <span className="max-w-[140px] truncate">{im.nomeImovel || 'Sem nome'}</span>
                <span className="opacity-70">{im.cib || 'sem CIB'}</span>
                {imoveis.length > 1 && (
                  <X size={13} className="opacity-60 hover:opacity-100" onClick={(ev) => handleRemoverImovel(im.id, ev)} />
                )}
              </button>
            ))}
          </div>

          {/* Aplicar um único VTN/ha a todos os imóveis da sessão */}
          <div className="flex flex-wrap items-center gap-2 mb-4 rounded-xl px-3 py-2.5" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
            <PenLine size={15} color={C.forest} className="flex-shrink-0" />
            <span className="text-xs font-medium" style={{ color: C.inkSoft }}>Aplicar um VTN/ha a todos os {imoveis.length} imóve{imoveis.length === 1 ? 'l' : 'is'}:</span>
            <input
              type="number" min="0" step="0.01" inputMode="decimal"
              className="rounded-lg px-2.5 py-1.5 text-sm outline-none vtn-mono w-32"
              style={{ border: `1px solid ${C.line}` }}
              placeholder="R$ 0,00"
              value={vtnGlobal}
              onChange={(e) => setVtnGlobal(e.target.value)}
            />
            <button
              type="button" onClick={handleAplicarVtnGlobal}
              disabled={!(Number(vtnGlobal) > 0)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ background: vtnGlobalAplicado ? C.forestSoft : C.forest, color: vtnGlobalAplicado ? C.forestDark : '#fff' }}
            >
              {vtnGlobalAplicado ? <CheckCircle2 size={14} /> : null}
              {vtnGlobalAplicado ? `Aplicado a ${imoveis.length}` : 'Aplicar a todos'}
            </button>
            <span className="text-xs" style={{ color: C.inkSoft }}>— muda cada imóvel para o modo "VTN manual" com esse valor.</span>
          </div>

          {/* Zona de arrastar-e-soltar */}
          <label
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-6 text-center cursor-pointer transition-colors"
            style={{
              border: `2px dashed ${arrastandoArquivo ? C.forest : C.line}`,
              background: arrastandoArquivo ? C.forestSoft : C.bg,
            }}
          >
            <UploadCloud size={22} color={arrastandoArquivo ? C.forest : C.inkSoft} />
            <p className="text-sm font-semibold" style={{ color: arrastandoArquivo ? C.forestDark : C.inkSoft }}>
              {arrastandoArquivo ? 'Solte os arquivos aqui' : 'Arraste declarações de ITR (PDF) aqui'}
            </p>
            <p className="text-xs" style={{ color: C.inkSoft }}>ou clique para selecionar — pode escolher vários arquivos de uma vez</p>
            <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={handleArquivosSelecionados} />
          </label>

          {importando && (
            <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: C.inkSoft }}>
              <Loader2 size={14} className="animate-spin" /> Lendo declarações…
            </div>
          )}
        </div>

        {previewImportacao && (
          <div className="rounded-2xl p-5 shadow-sm mb-6" style={{ background: C.paper, border: `2px solid ${C.forest}` }}>
            <div className="flex items-center gap-2 mb-3">
              <FileCheck2 size={18} color={C.forest} />
              <h2 className="font-semibold text-base">Prévia da importação — confirme antes de aplicar</h2>
            </div>
            <div className="space-y-3">
              {previewImportacao.map((r, idx) => (
                <div key={idx} className="rounded-xl p-3" style={{ background: r.erro ? C.dangerSoft : C.forestSoft, border: `1px solid ${r.erro ? C.danger : C.forest}` }}>
                  {r.erro ? (
                    <div className="flex items-start gap-2 text-sm" style={{ color: C.danger }}>
                      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                      <div><strong>{r.arquivo}</strong><br />{r.erro}</div>
                    </div>
                  ) : (
                    <div>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={r.incluir} onChange={() => alternarInclusaoPreview(idx)} className="mt-1" />
                        <div className="flex-1 text-sm">
                          <p className="font-semibold" style={{ color: C.forestDark }}>
                            {r.parsed.nomeImovel || '(sem nome)'} <span className="font-normal opacity-70">· CIB {r.parsed.cib || '—'}</span>
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: C.inkSoft }}>
                            {r.parsed.municipio}/{r.parsed.uf} · Área total: {formatHA(r.categorias.areaTotalDeclarada)} · Declaração {r.parsed.exercicio || '—'}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs" style={{ color: C.inkSoft }}>
                            <span>Lavoura: {formatHA(r.categorias.lavoura)}</span>
                            <span>Pastagem Nativa: {formatHA(r.categorias.pastagemNativa)}</span>
                            <span>Pastagem Plantada: {formatHA(r.categorias.pastagemPlantada)}</span>
                            <span>Reflorestamento: {formatHA(r.categorias.reflorestamento)}</span>
                            <span>Ambiental: {formatHA(r.categorias.ambiental)}</span>
                            <span>Benfeitorias: {formatHA(r.categorias.benfeitorias)}</span>
                            <span>Imprestável: {formatHA(r.categorias.imprestavel)}</span>
                          </div>
                          {!r.municipioEncontrado && (
                            <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: C.danger }}>
                              <AlertTriangle size={12} /> Município "{r.parsed.municipio}/{r.parsed.uf}" não encontrado na tabela de VTN 2026 — selecione manualmente depois de importar.
                            </p>
                          )}
                          {r.categorias.pastagemIndefinida && (
                            <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#7A5A18' }}>
                              <AlertTriangle size={12} /> Declaração não detalha pastagem nativa/plantada (total: {formatHA(r.categorias.pastagemTotalDeclarada)}) — divida manualmente depois de importar.
                            </p>
                          )}
                          {r.categorias.naoClassificado > 0 && (
                            <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#7A5A18' }}>
                              <AlertTriangle size={12} /> {formatHA(r.categorias.naoClassificado)} da declaração (área em descanso, exploração extrativa, etc.) não têm categoria correspondente e não foram somados a nenhuma — verifique o saldo depois de importar.
                            </p>
                          )}
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={handleCancelarImportacao}
                className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: '#fff', color: C.inkSoft, border: `1px solid ${C.line}` }}>
                Cancelar
              </button>
              <button type="button" onClick={handleConfirmarImportacao}
                disabled={!previewImportacao.some((r) => !r.erro && r.incluir)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ background: C.forest, color: '#fff' }}>
                <CheckCircle2 size={15} />
                Confirmar importação ({previewImportacao.filter((r) => !r.erro && r.incluir).length} imóve{previewImportacao.filter((r) => !r.erro && r.incluir).length === 1 ? 'l' : 'is'})
              </button>
            </div>
          </div>
        )}
      </div>

      <main className="max-w-6xl mx-auto px-6 pb-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 space-y-6">

          {imovel.importado && (
            <div className="rounded-2xl p-4 text-sm flex items-start gap-2" style={{ background: C.forestSoft, border: `1px solid ${C.forest}`, color: C.forestDark }}>
              <FileCheck2 size={16} className="flex-shrink-0 mt-0.5" />
              <span>Áreas importadas de <strong>{imovel.importado.arquivoNome}</strong> (declaração {imovel.importado.exercicioDeclaracao || '—'}). Confira e ajuste os campos abaixo se necessário.</span>
            </div>
          )}

          <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={18} color={C.forest} />
              <h2 className="font-semibold text-base">Localização e exercício</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.inkSoft }}>Estado (UF)</label>
                <select
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ border: `1px solid ${C.line}`, background: '#fff' }}
                  value={imovel.uf}
                  onChange={(e) => updateActiveImovel({ uf: e.target.value, municipio: '' })}
                >
                  <option value="">Selecione…</option>
                  {ufs.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.inkSoft }}>Município</label>
                <select
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
                  style={{ border: `1px solid ${C.line}`, background: '#fff' }}
                  value={imovel.municipio}
                  disabled={!imovel.uf}
                  onChange={(e) => updateActiveImovel({ municipio: e.target.value })}
                >
                  <option value="">{imovel.uf ? 'Selecione…' : 'Escolha o Estado primeiro'}</option>
                  {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: C.forestSoft }}>
              <span className="text-sm font-medium" style={{ color: C.forestDark }}>Exercício</span>
              <span className="text-sm font-semibold" style={{ color: C.forestDark }}>2026 (Receita Federal)</span>
            </div>

            {imovel.uf && imovel.municipio && !vtnRow && (
              <div className="mt-3 flex items-start gap-2 text-sm rounded-lg px-3 py-2" style={{ background: C.dangerSoft, color: C.danger }}>
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>Não há registro de VTN para este município no exercício 2026. Não é possível calcular.</span>
              </div>
            )}
          </div>

          {vtnRow && (
            <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.forestSoft, border: `1px solid ${C.forest}` }}>
              <div className="flex items-center gap-2 mb-3">
                <Table2 size={18} color={C.forestDark} />
                <h2 className="font-semibold text-base" style={{ color: C.forestDark }}>
                  Valores de pauta — {imovel.municipio}/{imovel.uf}
                </h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {CAMPOS_PAUTA.map((idx) => {
                  const valor = vtnRow[idx];
                  return (
                    <div key={idx} className="rounded-lg px-3 py-2" style={{ background: '#fff', border: `1px solid ${C.line}` }}>
                      <p className="text-xs leading-tight" style={{ color: C.inkSoft }}>{NOME_CAMPO_VTN[idx]}</p>
                      <p className="text-sm font-bold vtn-mono" style={{ color: valor != null ? C.forestDark : C.danger }}>
                        {valor != null ? formatBRL(valor) + '/ha' : 'indisponível'}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-start gap-2 text-xs" style={{ color: C.inkSoft }}>
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <span>Fonte: {vtnRow[8] === 1 ? 'município' : 'órgão estadual'} · Tabela oficial da Receita Federal, Exercício 2026.</span>
              </div>
            </div>
          )}

          <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <div className="flex items-center gap-2 mb-4">
              <Leaf size={18} color={C.forest} />
              <h2 className="font-semibold text-base">Área do imóvel</h2>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.inkSoft }}>Área Total (ha)</label>
                <input
                  type="number" min="0" step="0.1" inputMode="decimal"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none vtn-mono"
                  style={{ border: `1px solid ${C.line}` }}
                  placeholder="0,0"
                  value={imovel.areaTotal}
                  onChange={(e) => updateActiveImovel({ areaTotal: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.inkSoft }}>VTN/ha do exercício anterior <span className="font-normal">(opcional)</span></label>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none vtn-mono"
                  style={{ border: `1px solid ${C.line}` }}
                  placeholder="R$ 0,00"
                  value={imovel.vtnHaAnterior}
                  onChange={(e) => updateActiveImovel({ vtnHaAnterior: e.target.value })}
                />
              </div>
            </div>

            <div className="mb-1">
              <label className="block text-xs font-medium mb-2" style={{ color: C.inkSoft }}>Como calcular o VTN deste imóvel?</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button" onClick={() => updateActiveImovel({ modo: 'automatico' })}
                  className="flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors"
                  style={imovel.modo === 'automatico' ? { background: C.forest, color: '#fff' } : { background: '#fff', color: C.inkSoft, border: `1px solid ${C.line}` }}
                >
                  <Calculator size={14} /> Por composição de área
                </button>
                <button
                  type="button" onClick={() => updateActiveImovel({ modo: 'manual' })}
                  className="flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors"
                  style={imovel.modo === 'manual' ? { background: C.forest, color: '#fff' } : { background: '#fff', color: C.inkSoft, border: `1px solid ${C.line}` }}
                >
                  <PenLine size={14} /> Informar VTN manualmente
                </button>
              </div>
            </div>
          </div>

          {imovel.modo === 'automatico' ? (
            <>
              <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
                <label className="block text-xs font-medium mb-2" style={{ color: C.inkSoft }}>Aptidão da lavoura</label>
                <div className="flex gap-2">
                  {['BOA', 'REGULAR', 'RESTRITA'].map((op) => (
                    <button
                      key={op} type="button" onClick={() => updateActiveImovel({ aptidao: op })}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                      style={imovel.aptidao === op ? { background: C.forest, color: '#fff' } : { background: '#fff', color: C.inkSoft, border: `1px solid ${C.line}` }}
                    >
                      {op.charAt(0) + op.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <Calculator size={18} color={C.forest} />
                  <h2 className="font-semibold text-base">Composição da área por categoria</h2>
                </div>
                <p className="text-xs mb-4" style={{ color: C.inkSoft }}>O valor de VTN unitário é buscado automaticamente na tabela da Receita Federal para o município selecionado.</p>

                <div className="overflow-x-auto -mx-2">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left" style={{ color: C.inkSoft }}>
                        <th className="px-2 pb-2 font-medium">Categoria</th>
                        <th className="px-2 pb-2 font-medium">Área (ha)</th>
                        <th className="px-2 pb-2 font-medium">%</th>
                        <th className="px-2 pb-2 font-medium">VTN unitário</th>
                        <th className="px-2 pb-2 font-medium text-right">VTN ponderado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.itens.map((item) => {
                        const pct = resultado.areaTotalNum > 0 ? (item.area / resultado.areaTotalNum) * 100 : 0;
                        return (
                          <tr key={item.key} className="border-t" style={{ borderColor: C.line }}>
                            <td className="px-2 py-2 align-top">
                              <div className="font-medium">{item.label}</div>
                              {item.usaAptidao && <div className="text-xs" style={{ color: C.inkSoft }}>aptidão: {imovel.aptidao.toLowerCase()}</div>}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <input
                                type="number" min="0" step="0.1" inputMode="decimal"
                                className="w-24 rounded-md px-2 py-1 text-sm outline-none vtn-mono"
                                style={{ border: `1px solid ${C.line}` }}
                                placeholder="0,0"
                                value={imovel.areas[item.key]}
                                onChange={(e) => updateActiveAreas(item.key, e.target.value)}
                              />
                            </td>
                            <td className="px-2 py-2 align-top vtn-mono" style={{ color: C.inkSoft }}>{formatPct1(pct)}</td>
                            <td className="px-2 py-2 align-top vtn-mono">
                              {!vtnRow ? '—' : item.vtnUnitario != null ? formatBRL(item.vtnUnitario) + '/ha' : (
                                <span style={{ color: C.danger }}>indisponível</span>
                              )}
                            </td>
                            <td className="px-2 py-2 align-top text-right vtn-mono font-medium">{formatBRL(item.vtnParcial)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2" style={{ borderColor: C.forest }}>
                        <td className="px-2 pt-2 font-semibold">Total</td>
                        <td className="px-2 pt-2 font-semibold vtn-mono">{formatHA(resultado.somaAreas)}</td>
                        <td></td><td></td>
                        <td className="px-2 pt-2 text-right font-semibold vtn-mono">{formatBRL(resultado.vtnTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {resultado.inconsistencias.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {resultado.inconsistencias.map((msg, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm rounded-lg px-3 py-2"
                        style={msg.startsWith('Erro') ? { background: C.dangerSoft, color: C.danger } : { background: C.wheatSoft, color: '#7A5A18' }}>
                        <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                        <span>{msg}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-2 mb-1">
                <PenLine size={18} color={C.forest} />
                <h2 className="font-semibold text-base">VTN informado manualmente</h2>
              </div>
              <p className="text-xs mb-4" style={{ color: C.inkSoft }}>Use este modo quando o VTN/ha do imóvel já for conhecido e não for necessário decompor por categoria de uso.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: C.inkSoft }}>VTN por hectare (R$)</label>
                  <input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none vtn-mono"
                    style={{ border: `1px solid ${C.line}` }}
                    placeholder="R$ 0,00"
                    value={imovel.vtnManual}
                    onChange={(e) => updateActiveImovel({ vtnManual: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: C.inkSoft }}>Área não tributável (ha)<br /><span className="font-normal">APP, Reserva Legal, etc.</span></label>
                  <input
                    type="number" min="0" step="0.1" inputMode="decimal"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none vtn-mono"
                    style={{ border: `1px solid ${C.line}` }}
                    placeholder="0,0"
                    value={imovel.areaNaoTributavelManual}
                    onChange={(e) => updateActiveImovel({ areaNaoTributavelManual: e.target.value })}
                  />
                </div>
              </div>
              {resultado.inconsistencias.length > 0 && (
                <div className="mt-4 space-y-2">
                  {resultado.inconsistencias.map((msg, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm rounded-lg px-3 py-2"
                      style={msg.startsWith('Erro') ? { background: C.dangerSoft, color: C.danger } : { background: C.wheatSoft, color: '#7A5A18' }}>
                      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                      <span>{msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="lg:col-span-2">
          <div className="lg:sticky lg:top-6 space-y-4">

            <div className="rounded-2xl p-6 shadow-md" style={{ background: C.forestDark, color: '#fff' }}>
              <p className="text-xs uppercase tracking-widest font-semibold opacity-80">Imposto (ITR) estimado</p>
              <p className="vtn-mono text-4xl font-extrabold mt-1 mb-4">{bloqueado ? '—' : formatBRL(resultado.imposto)}</p>
              <div className="grid grid-cols-2 gap-3 text-sm border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
                <div><p className="opacity-70 text-xs">Área tributável</p><p className="font-semibold vtn-mono">{formatHA(resultado.areaTributavel)}</p></div>
                <div><p className="opacity-70 text-xs">Alíquota aplicada</p><p className="font-semibold vtn-mono">{formatPct2(resultado.faixaAliquota.aliquota * 100)}</p></div>
                <div><p className="opacity-70 text-xs">Coeficiente</p><p className="font-semibold vtn-mono">{resultado.coeficiente.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</p></div>
                <div><p className="opacity-70 text-xs">Faixa (GU acima de 80%)</p><p className="font-semibold text-xs">{resultado.faixaAliquota.label}</p></div>
              </div>
            </div>

            <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs" style={{ color: C.inkSoft }}>VTN Ponderado</p><p className="text-xl font-bold vtn-mono" style={{ color: C.forestDark }}>{formatBRL(resultado.vtnPorHa)}<span className="text-xs font-normal">/ha</span></p></div>
                <div><p className="text-xs" style={{ color: C.inkSoft }}>VTN Total</p><p className="text-xl font-bold vtn-mono" style={{ color: C.forestDark }}>{formatBRL(resultado.vtnTotal)}</p></div>
              </div>

              {resultado.diferencaPct != null && (
                <div className="mt-4 flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ background: C.forestSoft }}>
                  {resultado.diferencaPct >= 0 ? <TrendingUp size={16} color={C.forest} /> : <TrendingDown size={16} color={C.clay} />}
                  <span style={{ color: C.inkSoft }}>
                    {resultado.diferencaPct >= 0 ? 'Alta' : 'Queda'} de <strong className="vtn-mono">{formatPct1(Math.abs(resultado.diferencaPct))}</strong> vs. exercício anterior
                  </span>
                </div>
              )}

              <div className="mt-4 pt-4 border-t" style={{ borderColor: C.line }}>
                <p className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: C.inkSoft }}>
                  <User size={13} /> Identificação do imóvel <span style={{ color: C.danger }}>*</span>
                </p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input
                    type="text"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ border: `1px solid ${identificacaoFaltando && !imovel.nomeImovel.trim() ? C.danger : C.line}` }}
                    placeholder="Nome do imóvel"
                    value={imovel.nomeImovel}
                    onChange={(e) => updateActiveImovel({ nomeImovel: e.target.value })}
                  />
                  <input
                    type="text"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ border: `1px solid ${identificacaoFaltando && !imovel.cib.trim() ? C.danger : C.line}` }}
                    placeholder="CIB do imóvel"
                    value={imovel.cib}
                    onChange={(e) => updateActiveImovel({ cib: e.target.value })}
                  />
                </div>
                {identificacaoFaltando && (
                  <p className="text-xs mb-2" style={{ color: C.danger }}>Preencha Nome do imóvel e CIB para gerar o relatório.</p>
                )}
                {!identificacaoFaltando && algumSemIdentificacao && (
                  <p className="text-xs mb-2" style={{ color: C.danger }}>
                    {semIdentificacao.length === 1 ? 'Há 1 outro imóvel' : `Há ${semIdentificacao.length} outros imóveis`} nesta sessão sem Nome/CIB preenchidos — o relatório inclui todos os imóveis, preencha-os antes de gerar.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button" onClick={handleCopiar}
                  className="flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors"
                  style={{ background: copiado ? C.forestSoft : '#fff', color: copiado ? C.forestDark : C.inkSoft, border: `1px solid ${C.line}` }}
                >
                  <ClipboardCopy size={15} />
                  {copiado ? 'Copiado!' : 'Copiar'}
                </button>
                <button
                  type="button" onClick={handleGerarRelatorio}
                  className="flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors"
                  style={{ background: C.forest, color: '#fff' }}
                >
                  <FileDown size={15} />
                  {imoveis.length > 1 ? `Gerar relatório (${imoveis.length})` : 'Gerar relatório'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl shadow-sm overflow-hidden" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <button type="button" onClick={() => setMemoriaAberta((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold">
                Memória de cálculo
                {memoriaAberta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {memoriaAberta && (
                <div className="px-5 pb-5 text-xs space-y-3 vtn-mono" style={{ color: C.inkSoft }}>
                  <p className="font-sans" style={{ color: C.ink }}>Área total: <strong>{formatHA(resultado.areaTotalNum)}</strong></p>
                  {imovel.modo === 'automatico' ? (
                    resultado.itens.filter((i) => i.area > 0).map((i) => (
                      <div key={i.key} className="border-t pt-2" style={{ borderColor: C.line }}>
                        <p className="font-sans font-medium" style={{ color: C.ink }}>{i.label}</p>
                        <p>Área: {formatHA(i.area)} · Participação: {formatPct1(resultado.areaTotalNum > 0 ? (i.area / resultado.areaTotalNum) * 100 : 0)}</p>
                        <p>VTN unitário ({i.nomeCampoVtn}): {i.vtnUnitario != null ? formatBRL(i.vtnUnitario) + '/ha' : 'indisponível'}</p>
                        <p className="font-sans font-medium" style={{ color: C.forestDark }}>Contribuição: {formatBRL(i.vtnParcial)}</p>
                      </div>
                    ))
                  ) : (
                    <div className="border-t pt-2" style={{ borderColor: C.line }}>
                      <p className="font-sans font-medium" style={{ color: C.ink }}>VTN informado manualmente</p>
                      <p>VTN/ha: {formatBRL(resultado.vtnPorHa)}</p>
                      <p>Área não tributável: {formatHA(resultado.areaAmbiental)}</p>
                    </div>
                  )}
                  <div className="border-t pt-2" style={{ borderColor: C.forest }}>
                    <p className="font-sans" style={{ color: C.ink }}>VTN Total = {formatBRL(resultado.vtnTotal)}</p>
                    <p className="font-sans" style={{ color: C.ink }}>VTN Ponderado = VTN Total ÷ Área Total = {formatBRL(resultado.vtnPorHa)}/ha</p>
                    <p className="font-sans mt-2" style={{ color: C.ink }}>Área Tributável = Área Total − Área {imovel.modo === 'automatico' ? 'Ambiental' : 'Não Tributável'} = {formatHA(resultado.areaTributavel)}</p>
                    <p className="font-sans" style={{ color: C.ink }}>Coeficiente = TRUNC(Área Tributável ÷ Área Total, 4) = {resultado.coeficiente}</p>
                    <p className="font-sans" style={{ color: C.ink }}>VTN Tributável = VTN Total × Coeficiente = {formatBRL(resultado.vtnTotal * resultado.coeficiente)}</p>
                    <p className="font-sans" style={{ color: C.ink }}>Alíquota (GU&gt;80%, {resultado.faixaAliquota.label}) = {formatPct2(resultado.faixaAliquota.aliquota * 100)}</p>
                    <p className="font-sans font-semibold" style={{ color: C.forestDark }}>Imposto (ITR) = VTN Tributável × Alíquota = {formatBRL(resultado.imposto)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>

      <section className="max-w-6xl mx-auto px-6 pb-12">
        <div className="rounded-2xl p-5" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
          <h3 className="font-semibold text-sm mb-3">Tabela de alíquotas do ITR aplicada (Grau de Utilização acima de 80%)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead>
                <tr className="text-left" style={{ color: C.inkSoft }}>
                  <th className="pb-2 pr-4 font-medium">Área Total</th>
                  <th className="pb-2 font-medium">Alíquota (GU &gt; 80%)</th>
                </tr>
              </thead>
              <tbody>
                {ALIQUOTA_FAIXAS.map((f) => (
                  <tr key={f.label} className="border-t vtn-mono" style={{ borderColor: C.line, background: resultado.faixaAliquota.label === f.label ? C.forestSoft : 'transparent' }}>
                    <td className="py-1.5 pr-4">{f.label}</td>
                    <td className="py-1.5 font-semibold">{formatPct2(f.aliquota * 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-3" style={{ color: C.inkSoft }}>Fonte dos valores de VTN: Receita Federal, Tabela de Valores de Terra Nua, Exercício 2026. Este simulador considera exclusivamente imóveis com Grau de Utilização acima de 80%, conforme metodologia interna.</p>
        </div>
      </section>
    </div>
  );
}

