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
  const viewport = d.getElementById('planta-viewport');
  const camada = d.getElementById('sinais-borda');
  if (!viewport || !camada) { bad('sem viewport ou camada de sinais'); return fim(); }

  const LARGURA = 300;
  viewport.getBoundingClientRect = () => ({
    left: 0, top: 0, right: LARGURA, bottom: 200, width: LARGURA, height: 200,
  });
  camada.getBoundingClientRect = () => ({
    left: 0, top: 0, right: LARGURA, bottom: 200, width: LARGURA, height: 200,
  });

  const linha = d.querySelector('.fila-linha');
  if (!linha) { bad('sem fila-linha'); return fim(); }
  const ocupadas = [...linha.querySelectorAll('.posicao.ocupada:not(.coletada):not(.coleta-parcial)')];
  if (!ocupadas.length) { bad('fila sem posicao ocupada'); return fim(); }

  const originais = ocupadas.map(pos => pos.getBoundingClientRect.bind(pos));
  const aplicar = desloc => {
    ocupadas.forEach((pos, i) => {
      const left = 400 + i * 50 - desloc;
      pos.getBoundingClientRect = () => ({
        left, top: 20, right: left + 44, bottom: 64, width: 44, height: 44,
      });
    });
  };

  // Tudo fora da borda direita.
  aplicar(0);
  W.eval('atualizarSinaisLaterais()');
  if (!camada.querySelector('.sinal-borda.direita')) bad('sem seta direita com pallet fora a direita');
  else ok('seta direita aparece com pallet fora da tela');
  if (camada.querySelector('.sinal-borda.esquerda')) bad('seta esquerda indevida');
  else ok('sem seta esquerda quando o pallet esta a direita');

  // Pallet visível: nenhuma seta.
  aplicar(350);
  W.eval('atualizarSinaisLaterais()');
  if (camada.querySelectorAll('.sinal-borda').length) bad('setas deveriam sumir com pallet visivel');
  else ok('setas somem ao chegar no pallet');

  // Passou do pallet: agora tudo fora à esquerda.
  aplicar(700);
  W.eval('atualizarSinaisLaterais()');
  if (!camada.querySelector('.sinal-borda.esquerda')) bad('sem seta esquerda com pallet fora a esquerda');
  else ok('seta esquerda aparece ao passar do pallet');
  if (camada.querySelector('.sinal-borda.direita')) bad('seta direita indevida');
  else ok('sem seta direita quando o pallet ficou a esquerda');

  ocupadas.forEach((pos, i) => { pos.getBoundingClientRect = originais[i]; });
  fim();
}, 600);

function fim() {
  console.log('--- falhas: ' + fails);
  process.exit(fails ? 1 : 0);
}
