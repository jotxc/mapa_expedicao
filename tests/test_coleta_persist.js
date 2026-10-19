const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const arquivo = path.join(__dirname, '..', 'dist', 'MAPA_EXP_DEMO.html');
const html = fs.readFileSync(arquivo, 'utf8');
let fails = 0;
const ok = n => console.log('OK   ' + n);
const bad = n => { fails++; console.log('FALHA ' + n); };

function abrir(preload) {
  return new Promise(resolve => {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
      url: 'https://exemplo.test/',
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        if (preload) w.localStorage.setItem(preload.chave, preload.valor);
      },
    });
    setTimeout(() => resolve(dom), 600);
  });
}

(async () => {
  const dom1 = await abrir(null);
  const W = dom1.window, d1 = W.document;
  const clicar = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));

  const alvo = d1.querySelector('.posicao.ocupada') || d1.querySelector('.posicao.inconsistente');
  if (!alvo) { bad('sem posicao para testar'); return fim(); }
  const fila = alvo.dataset.fila, pos = alvo.dataset.posicao;
  clicar(alvo);
  [...d1.querySelectorAll('.balao-coleta')].forEach(clicar);
  if (!alvo.classList.contains('coletada')) bad('nao marcou antes de recarregar'); else ok('marcado antes de recarregar');

  const chave = Object.keys(W.localStorage).find(k => k.startsWith('mapa-exp-coletados::'));
  const valor = W.localStorage.getItem(chave);
  ok('estado salvo: ' + valor);
  dom1.window.close();

  const dom2 = await abrir({ chave, valor });
  const d2 = dom2.window.document;
  const restaurada = d2.querySelector(`.posicao[data-fila="${fila}"][data-posicao="${pos}"]`);
  if (!restaurada) bad('posicao nao encontrada apos recarregar');
  else if (!restaurada.classList.contains('coletada')) bad('posicao nao restaurou como coletada');
  else if (!restaurada.querySelector('.selo-coleta')) bad('selo V nao restaurou');
  else ok('posicao restaurada coletada com selo V apos recarregar');
  dom2.window.close();

  fim();
})();

function fim() {
  console.log('--- falhas: ' + fails);
  process.exit(fails ? 1 : 0);
}
