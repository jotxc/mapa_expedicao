const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const demo = path.join(__dirname, '..', 'dist', 'MAPA_EXP_DEMO.html');
let fails = 0;
const ok = n => console.log('OK   ' + n);
const bad = n => { fails++; console.log('FALHA ' + n); };

const html = fs.readFileSync(demo, 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  url: 'https://exemplo.test/',
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  },
});

setTimeout(() => {
  const W = dom.window, d = W.document;

  const badge0 = d.getElementById('indicador-busca');
  const viewport0 = d.getElementById('planta-viewport');
  if (!badge0 || !viewport0) { bad('sem viewport ou badge'); return fim(); }

  // --- 1. Sem filtro o badge nunca aparece ---
  W.eval('atualizarIndicadorBusca()');
  if (badge0.hidden) ok('badge oculto sem filtro');
  else bad('badge deveria estar oculto sem filtro');

  // --- Aplica filtro de um material (variante de cor solida) ---
  W.eval(
    'ESTADO.selecionados = [CATALOGO.porMaterial.keys().next().value];' +
    'aplicarFiltro();'
  );
  if (W.eval('ESTADO.filtroAtivo') !== true) { bad('filtro nao ativo apos aplicarFiltro'); return fim(); }

  // renderizarMapa recriou a DOM: reconsulta e moca os retangulos.
  const viewport = d.getElementById('planta-viewport');
  const badge = d.getElementById('indicador-busca');
  const LARGURA = 300;
  viewport.getBoundingClientRect = () => ({
    left: 0, top: 0, right: LARGURA, bottom: 200, width: LARGURA, height: 200,
  });

  const destaques = [...d.querySelectorAll('.posicao.destacada:not(.coletada):not(.coleta-parcial)')];
  if (!destaques.length) { bad('filtro nao gerou posicoes destacadas'); return fim(); }

  const originais = destaques.map(pos => pos.getBoundingClientRect.bind(pos));
  const aplicar = mapa => destaques.forEach((pos, i) => {
    const left = mapa(i, pos);
    pos.getBoundingClientRect = () => ({
      left, top: 20, right: left + 44, bottom: 64, width: 44, height: 44,
    });
  });
  const restaurar = () => destaques.forEach((pos, i) => { pos.getBoundingClientRect = originais[i]; });

  // --- 2. Matches todos fora da direita: badge mostra o mais proximo ---
  aplicar(i => 400 + i * 50);
  W.eval('atualizarIndicadorBusca()');
  if (badge.hidden) bad('badge nao apareceu com match fora da tela');
  else {
    ok('badge aparece com match fora da direita');
    const esperado = 'Pos. ' + String(destaques[0].dataset.posicao).padStart(2, '0');
    if (!badge.textContent.includes(esperado)) {
      bad(`badge sem '${esperado}' (texto: "${badge.textContent.trim()}")`);
    } else ok('badge mostra a posicao do match mais proximo');

    const seta = badge.textContent.includes('\u2192');
    if (seta) ok('badge tem seta direcional');
    else bad('badge sem seta direcional');

    const cor = badge.querySelector('.indicador-cor');
    if (!cor) bad('badge sem quadrado de cor');
    else {
      const estilo = cor.getAttribute('style') || '';
      if (estilo.includes('background')) ok('badge traz a cor do material');
      else bad('quadrado de cor sem background do material');
      if (cor.querySelector('svg')) ok('badge tem icone de pallet SVG');
      else bad('badge sem icone de pallet SVG');
    }
  }

  // --- 3. Alvo meio visivel na borda: badge continua (so some totalmente dentro) ---
  aplicar(i => (i === 0 ? 280 : 400 + i * 50));
  W.eval('atualizarIndicadorBusca()');
  if (badge.hidden) bad('badge sumiu com o pallet alvo ainda meio fora');
  else ok('badge permanece ate o pallet entrar totalmente');

  // --- 4. Todos totalmente visiveis: badge some ---
  aplicar(i => (i % 5) * 50);
  W.eval('atualizarIndicadorBusca()');
  if (badge.hidden) ok('badge some quando o alvo esta totalmente na viewport');
  else bad('badge deveria sumir com o alvo totalmente visivel');

  // --- 5. Passou do pallet (tudo a esquerda): badge some ---
  aplicar(i => -500 - i * 50);
  W.eval('atualizarIndicadorBusca()');
  if (badge.hidden) ok('badge oculto quando so ha matches a esquerda');
  else bad('badge apareceu com matches apenas a esquerda');

  restaurar();

  // --- 6. Limpar o filtro esconde o badge mesmo com match fora da tela ---
  W.eval('limparFiltro()');
  const viewport2 = d.getElementById('planta-viewport');
  const badge2 = d.getElementById('indicador-busca');
  viewport2.getBoundingClientRect = () => ({
    left: 0, top: 0, right: LARGURA, bottom: 200, width: LARGURA, height: 200,
  });
  W.eval('atualizarIndicadorBusca()');
  if (badge2.hidden) ok('badge volta a ficar oculto apos limpar filtro');
  else bad('badge continuou visivel apos limpar filtro');

  fim();
}, 600);

function fim() {
  console.log('--- falhas: ' + fails);
  process.exit(fails ? 1 : 0);
}
