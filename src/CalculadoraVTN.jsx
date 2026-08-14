import React, { useState, useMemo } from 'react';
import { Sprout, MapPin, Calculator, AlertTriangle, TrendingUp, TrendingDown, Info, ClipboardCopy, ChevronDown, ChevronUp, Leaf } from 'lucide-react';
import VTN_DATA_2026 from './vtn_2026.json';

// =====================================================================
// PALETA E TOKENS DE DESIGN
// (Tailwind core apenas cuida de layout/spacing/tipografia; cores de
// marca via inline style, já que classes arbitrárias não compilam aqui)
// =====================================================================
const C = {
  bg: '#F6F4EE',           // fundo geral, bege-claro suave (papel/talhão)
  paper: '#FFFFFF',
  ink: '#1C2620',           // texto principal, verde-carvão
  inkSoft: '#54614F',
  forest: '#1F5C3F',        // verde principal (marca)
  forestDark: '#153F2B',
  forestSoft: '#E7EFE7',
  clay: '#B5652E',          // terracota/argila — acento de alerta/destaque secundário
  claySoft: '#F6E9DD',
  wheat: '#D8A93A',         // trigo — acento de aviso
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

// Índice de cada categoria dentro da linha de dados da Receita Federal
// [uf, municipio, lavouraBoa, lavouraRegular, lavouraRestrita, pastagemPlantada, silviculturaPastagemNatural, preservacao, fonte]
function getVtnFieldIndex(catKey, aptidao) {
  switch (catKey) {
    case 'lavoura':
      if (aptidao === 'BOA') return 2;
      if (aptidao === 'REGULAR') return 3;
      return 4; // RESTRITA
    case 'pastagemPlantada': return 5;
    case 'pastagemNativa': return 6;
    case 'reflorestamento': return 6; // mesma coluna da Receita ("Silvicultura ou Pastagem Natural")
    case 'ambiental': return 7;
    case 'benfeitorias': return 7; // confirmado: usa a taxa de Preservação, propositalmente
    case 'imprestavel': return 7;  // confirmado: usa a taxa de Preservação, propositalmente
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

// Tabela oficial de alíquotas do ITR — Grau de Utilização acima de 80%
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
// MOTOR DE CÁLCULO — função pura, sem estado de interface.
// Reproduz fielmente a lógica identificada na planilha "VTN 2025 v3".
// =====================================================================
function calcularVTN({ areaTotal, aptidao, areas, vtnRow, vtnHaAnterior }) {
  const itens = CATEGORIAS.map((cat) => {
    const area = Number(areas[cat.key]) || 0;
    const idx = getVtnFieldIndex(cat.key, aptidao);
    const vtnUnitario = vtnRow ? vtnRow[idx] : null; // null = s/informação na Receita
    const indisponivel = area > 0 && (vtnUnitario === null || vtnUnitario === undefined);
    const vtnParcial = vtnUnitario != null ? area * vtnUnitario : 0;
    return {
      ...cat,
      area,
      idxCampo: idx,
      nomeCampoVtn: NOME_CAMPO_VTN[idx],
      vtnUnitario,
      indisponivel,
      vtnParcial,
    };
  });

  const somaAreas = round1(itens.reduce((s, i) => s + i.area, 0));
  const areaTotalNum = Number(areaTotal) || 0;
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

  const inconsistencias = [];
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
function truncate(n, casas) {
  const f = Math.pow(10, casas);
  return Math.trunc(n * f) / f;
}
function formatHA(n) {
  return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ha';
}
function formatBRL(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatPct1(n) {
  return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
function formatPct2(n) {
  return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

// =====================================================================
// COMPONENTE
// =====================================================================
export default function CalculadoraVTN() {
  const ufs = useMemo(() => {
    const s = new Set(VTN_DATA_2026.map((r) => r[0]));
    return Array.from(s).sort();
  }, []);

  const [uf, setUf] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [aptidao, setAptidao] = useState('BOA');
  const [areaTotal, setAreaTotal] = useState('');
  const [vtnHaAnterior, setVtnHaAnterior] = useState('');
  const [areas, setAreas] = useState({
    lavoura: '', pastagemPlantada: '', pastagemNativa: '',
    reflorestamento: '', ambiental: '', benfeitorias: '', imprestavel: '',
  });
  const [memoriaAberta, setMemoriaAberta] = useState(true);
  const [copiado, setCopiado] = useState(false);

  const municipios = useMemo(() => {
    if (!uf) return [];
    return VTN_DATA_2026.filter((r) => r[0] === uf)
      .map((r) => r[1])
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [uf]);

  const vtnRow = useMemo(() => {
    if (!uf || !municipio) return null;
    return VTN_DATA_2026.find((r) => r[0] === uf && r[1] === municipio) || null;
  }, [uf, municipio]);

  const resultado = useMemo(() => calcularVTN({ areaTotal, aptidao, areas, vtnRow, vtnHaAnterior }),
    [areaTotal, aptidao, areas, vtnRow, vtnHaAnterior]);

  function handleAreaChange(key, value) {
    setAreas((prev) => ({ ...prev, [key]: value }));
  }

  function handleCopiar() {
    const linhas = resultado.itens
      .filter((i) => i.area > 0)
      .map((i) => `${i.label}: ${formatHA(i.area)} × ${i.vtnUnitario != null ? formatBRL(i.vtnUnitario) : 'indisponível'}/ha = ${formatBRL(i.vtnParcial)}`);
    const texto = [
      `Calculadora de VTN — ${municipio || '(município)'}/${uf || '--'} — Exercício 2026`,
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

  const bloqueado = resultado.saldo < -0.05;

  return (
    <div className="min-h-screen w-full" style={{ background: C.bg, color: C.ink }}>
      <style>{`
        .vtn-serif { font-family: Georgia, 'Times New Roman', serif; }
        .vtn-mono { font-variant-numeric: tabular-nums; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
      `}</style>

      {/* Cabeçalho */}
      <header className="border-b" style={{ borderColor: C.line }}>
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: C.forest }}>
            <Sprout size={20} color="#fff" />
          </div>
          <div>
            <p className="text-xs tracking-widest uppercase font-semibold" style={{ color: C.forest }}>Gestão Fundiária · Safras &amp; Cifras</p>
            <h1 className="vtn-serif text-2xl md:text-3xl font-bold leading-tight" style={{ color: C.forestDark }}>Calculadora de VTN Ponderado</h1>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ============ COLUNA ESQUERDA: FORMULÁRIO ============ */}
        <section className="lg:col-span-3 space-y-6">

          {/* Localização */}
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
                  value={uf}
                  onChange={(e) => { setUf(e.target.value); setMunicipio(''); }}
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
                  value={municipio}
                  disabled={!uf}
                  onChange={(e) => setMunicipio(e.target.value)}
                >
                  <option value="">{uf ? 'Selecione…' : 'Escolha o Estado primeiro'}</option>
                  {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: C.forestSoft }}>
              <span className="text-sm font-medium" style={{ color: C.forestDark }}>Exercício</span>
              <span className="text-sm font-semibold" style={{ color: C.forestDark }}>2026 (Receita Federal)</span>
            </div>

            {uf && municipio && !vtnRow && (
              <div className="mt-3 flex items-start gap-2 text-sm rounded-lg px-3 py-2" style={{ background: C.dangerSoft, color: C.danger }}>
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>Não há registro de VTN para este município no exercício 2026. Não é possível calcular.</span>
              </div>
            )}

            {vtnRow && (
              <div className="mt-3 flex items-start gap-2 text-xs rounded-lg px-3 py-2" style={{ background: C.forestSoft, color: C.inkSoft }}>
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <span>Fonte dos valores: {vtnRow[8] === 1 ? 'município' : 'órgão estadual'} · Tabela oficial da Receita Federal, Exercício 2026.</span>
              </div>
            )}
          </div>

          {/* Área total e aptidão */}
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
                  value={areaTotal}
                  onChange={(e) => setAreaTotal(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.inkSoft }}>VTN/ha do exercício anterior <span className="font-normal">(opcional)</span></label>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none vtn-mono"
                  style={{ border: `1px solid ${C.line}` }}
                  placeholder="R$ 0,00"
                  value={vtnHaAnterior}
                  onChange={(e) => setVtnHaAnterior(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: C.inkSoft }}>Aptidão da lavoura</label>
              <div className="flex gap-2">
                {['BOA', 'REGULAR', 'RESTRITA'].map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => setAptidao(op)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                    style={aptidao === op
                      ? { background: C.forest, color: '#fff' }
                      : { background: '#fff', color: C.inkSoft, border: `1px solid ${C.line}` }}
                  >
                    {op.charAt(0) + op.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Composição de área por categoria */}
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
                          {item.usaAptidao && <div className="text-xs" style={{ color: C.inkSoft }}>aptidão: {aptidao.toLowerCase()}</div>}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            type="number" min="0" step="0.1" inputMode="decimal"
                            className="w-24 rounded-md px-2 py-1 text-sm outline-none vtn-mono"
                            style={{ border: `1px solid ${C.line}` }}
                            placeholder="0,0"
                            value={areas[item.key]}
                            onChange={(e) => handleAreaChange(item.key, e.target.value)}
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
                    <td></td>
                    <td></td>
                    <td className="px-2 pt-2 text-right font-semibold vtn-mono">{formatBRL(resultado.vtnTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {resultado.inconsistencias.length > 0 && (
              <div className="mt-4 space-y-2">
                {resultado.inconsistencias.map((msg, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm rounded-lg px-3 py-2"
                    style={msg.startsWith('Erro')
                      ? { background: C.dangerSoft, color: C.danger }
                      : { background: C.wheatSoft, color: '#7A5A18' }}>
                    <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                    <span>{msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ============ COLUNA DIREITA: RESULTADO ============ */}
        <aside className="lg:col-span-2">
          <div className="lg:sticky lg:top-6 space-y-4">

            <div className="rounded-2xl p-6 shadow-md" style={{ background: C.forestDark, color: '#fff' }}>
              <p className="text-xs uppercase tracking-widest font-semibold opacity-80">Imposto (ITR) estimado</p>
              <p className="vtn-serif vtn-mono text-4xl font-bold mt-1 mb-4">
                {bloqueado ? '—' : formatBRL(resultado.imposto)}
              </p>

              <div className="grid grid-cols-2 gap-3 text-sm border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
                <div>
                  <p className="opacity-70 text-xs">Área tributável</p>
                  <p className="font-semibold vtn-mono">{formatHA(resultado.areaTributavel)}</p>
                </div>
                <div>
                  <p className="opacity-70 text-xs">Alíquota aplicada</p>
                  <p className="font-semibold vtn-mono">{formatPct2(resultado.faixaAliquota.aliquota * 100)}</p>
                </div>
                <div>
                  <p className="opacity-70 text-xs">Coeficiente</p>
                  <p className="font-semibold vtn-mono">{resultado.coeficiente.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</p>
                </div>
                <div>
                  <p className="opacity-70 text-xs">Faixa (GU acima de 80%)</p>
                  <p className="font-semibold text-xs">{resultado.faixaAliquota.label}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl p-5 shadow-sm" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs" style={{ color: C.inkSoft }}>VTN Ponderado</p>
                  <p className="text-xl font-bold vtn-mono" style={{ color: C.forestDark }}>{formatBRL(resultado.vtnPorHa)}<span className="text-xs font-normal">/ha</span></p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: C.inkSoft }}>VTN Total</p>
                  <p className="text-xl font-bold vtn-mono" style={{ color: C.forestDark }}>{formatBRL(resultado.vtnTotal)}</p>
                </div>
              </div>

              {resultado.diferencaPct != null && (
                <div className="mt-4 flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ background: C.forestSoft }}>
                  {resultado.diferencaPct >= 0 ? <TrendingUp size={16} color={C.forest} /> : <TrendingDown size={16} color={C.clay} />}
                  <span style={{ color: C.inkSoft }}>
                    {resultado.diferencaPct >= 0 ? 'Alta' : 'Queda'} de <strong className="vtn-mono">{formatPct1(Math.abs(resultado.diferencaPct))}</strong> vs. exercício anterior
                  </span>
                </div>
              )}

              <button
                type="button" onClick={handleCopiar}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors"
                style={{ background: copiado ? C.forestSoft : C.forest, color: copiado ? C.forestDark : '#fff' }}
              >
                <ClipboardCopy size={15} />
                {copiado ? 'Copiado!' : 'Copiar resultado'}
              </button>
            </div>

            {/* Memória de cálculo */}
            <div className="rounded-2xl shadow-sm overflow-hidden" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <button
                type="button" onClick={() => setMemoriaAberta((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold"
              >
                Memória de cálculo
                {memoriaAberta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {memoriaAberta && (
                <div className="px-5 pb-5 text-xs space-y-3 vtn-mono" style={{ color: C.inkSoft }}>
                  <p className="font-sans" style={{ color: C.ink }}>Área total: <strong>{formatHA(resultado.areaTotalNum)}</strong></p>
                  {resultado.itens.filter((i) => i.area > 0).map((i) => (
                    <div key={i.key} className="border-t pt-2" style={{ borderColor: C.line }}>
                      <p className="font-sans font-medium" style={{ color: C.ink }}>{i.label}</p>
                      <p>Área: {formatHA(i.area)} · Participação: {formatPct1(resultado.areaTotalNum > 0 ? (i.area / resultado.areaTotalNum) * 100 : 0)}</p>
                      <p>VTN unitário ({i.nomeCampoVtn}): {i.vtnUnitario != null ? formatBRL(i.vtnUnitario) + '/ha' : 'indisponível'}</p>
                      <p className="font-sans font-medium" style={{ color: C.forestDark }}>Contribuição: {formatBRL(i.vtnParcial)}</p>
                    </div>
                  ))}
                  <div className="border-t pt-2" style={{ borderColor: C.forest }}>
                    <p className="font-sans" style={{ color: C.ink }}>VTN Total = {formatBRL(resultado.vtnTotal)}</p>
                    <p className="font-sans" style={{ color: C.ink }}>VTN Ponderado = VTN Total ÷ Área Total = {formatBRL(resultado.vtnPorHa)}/ha</p>
                    <p className="font-sans mt-2" style={{ color: C.ink }}>Área Tributável = Área Total − Área Ambiental = {formatHA(resultado.areaTributavel)}</p>
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

      {/* Tabela de alíquotas oficiais, para transparência/auditoria */}
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
                  <tr key={f.label} className="border-t vtn-mono" style={{
                    borderColor: C.line,
                    background: resultado.faixaAliquota.label === f.label ? C.forestSoft : 'transparent',
                  }}>
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
