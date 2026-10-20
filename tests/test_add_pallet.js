const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const demo = path.join(__dirname, '..', 'dist', 'MAPA_EXP_DEMO.html');
const branco = path.join(__dirname, '..', 'dist', 'MAPA_EXP.html');
let fails = 0;
const ok = n => console.log('OK   ' + n);
const bad = n => { fails++; console.log('FALHA ' + n); };

function abrir(arquivo, preload) {
  const html = fs.readFileSync(arquivo, 'utf8');
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
  const dom1 = await abrir(demo, null);
  const W = dom1.window, d1 = W.document;
  const clicar = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));

  const posEl = () => d1.querySelector(`.posicao[data-fila="${fila}"][data-posicao="${pos}"]`);
  const balaoAberto = () => !d1.getElementById('painel').hidden;

  function adicionar(clicarPosicao) {
    if (clicarPosicao) clicar(posEl());
    const abrirAdd = d1.getElementById('balao-add-abrir');
    if (!abrirAdd) return null;
    clicar(abrirAdd);
    const sugestao = d1.querySelector('.balao-sugestao');
    if (!sugestao) return null;
    const material = sugestao.dataset.material;
    clicar(sugestao);
    const loteOp = d1.querySelector('.balao-lote-op');
    if (!loteOp) return null;
    clicar(loteOp);
    const confirmar = d1.getElementById('balao-add-confirmar');
    if (!confirmar || confirmar.disabled) return null;
    clicar(confirmar);
    return material;
  }

  const vazia = d1.querySelector('.posicao.vazia');
  if (!vazia) { bad('sem posicao vazia para testar'); return fim(); }
  const fila = vazia.dataset.fila, pos = vazia.dataset.posicao;

  const material = adicionar(true);
  if (!material) { bad('fluxo de adicionar nao completou'); return fim(); }
  if (!posEl() || !posEl().classList.contains('ocupada')) bad('posicao nao ficou ocupada');
  else ok(`pallet adicionado (fila ${fila}, pos ${pos}, material ${material})`);

  const segundo = adicionar(false);
  if (!segundo) bad('nao permitiu adicionar o 2o pallet');
  else if (d1.querySelectorAll('#painel-conteudo .balao-item').length !== 2) bad('balao nao mostra 2 pallets');
  else if (d1.getElementById('balao-add-abrir')) bad('ainda permite adicionar com a posicao cheia (2)');
  else ok('posicao limitada a 2 pallets');

  const remover = d1.querySelector('#painel-conteudo .balao-remover');
  if (!remover) bad('sem botao remover no pallet adicionado');
  else {
    clicar(remover);
    if (d1.querySelectorAll('#painel-conteudo .balao-item').length !== 1) bad('remover nao removeu o pallet');
    else if (!d1.getElementById('balao-add-abrir')) bad('nao liberou adicionar apos remover');
    else ok('pallet manual removido');
  }

  const salva = W.localStorage.getItem('mapa-exp-sessao');
  if (!salva) bad('sessao nao foi salva no aparelho');
  else if (salva.indexOf(String(material)) === -1) bad('material adicionado nao esta na sessao salva');
  else ok('sessao salva com a adicao');
  if (!balaoAberto()) bad('balao nao reabriu apos editar');
  dom1.window.close();

  const dom2 = await abrir(branco, { chave: 'mapa-exp-sessao', valor: salva });
  const d2 = dom2.window.document;
  if (!d2.getElementById('upload').hidden) bad('app em branco nao restaurou a sessao');
  else {
    const restaurada = d2.querySelector(`.posicao[data-fila="${fila}"][data-posicao="${pos}"]`);
    if (!restaurada) bad('posicao adicionada nao foi restaurada apos recarregar');
    else if (!restaurada.classList.contains('ocupada')) bad('posicao nao restaurou como ocupada');
    else ok('adicao restaurada apos recarregar o app em branco');
  }
  dom2.window.close();

  fim();
})();

function fim() {
  console.log('--- falhas: ' + fails);
  process.exit(fails ? 1 : 0);
}
