const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const arquivo = path.join(__dirname, '..', 'dist', 'MAPA_EXP_DEMO.html');
const html = fs.readFileSync(arquivo, 'utf8');
const vc = new VirtualConsole();
let fails = 0;
const ok = n => console.log('OK   ' + n);
const bad = n => { fails++; console.log('FALHA ' + n); };

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'https://exemplo.test/',
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  },
});
const W = dom.window;

setTimeout(() => {
  const d = W.document;
  const clicar = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));

  const ocupadas = [...d.querySelectorAll('.posicao.ocupada')];
  if (!ocupadas.length) { bad('nenhuma posicao ocupada'); return fim(); }
  const alvo = ocupadas[0];

  clicar(alvo);
  const painel = d.getElementById('painel');
  if (painel.hidden) bad('balao nao abriu'); else ok('balao abriu');

  const botoes = [...d.querySelectorAll('.balao-coleta')];
  if (!botoes.length) { bad('sem botoes de coleta'); return fim(); }
  ok('balao com ' + botoes.length + ' botao(oes) de coleta');

  // Parcial (se houver mais de 1 pallet): marca so o primeiro
  if (botoes.length > 1) {
    clicar(botoes[0]);
    const selo = alvo.querySelector('.selo-coleta');
    if (alvo.classList.contains('coleta-parcial') && selo && /^\d+\/\d+$/.test(selo.textContent))
      ok('estado parcial mostra ' + selo.textContent);
    else bad('estado parcial incorreto');
  }

  // Marca todos restantes
  [...d.querySelectorAll('.balao-coleta')]
    .filter(b => b.getAttribute('aria-pressed') !== 'true')
    .forEach(clicar);
  if (!alvo.classList.contains('coletada')) bad('posicao nao ficou coletada'); else ok('posicao coletada');
  const itens = d.querySelectorAll('.balao-item');
  const itensCol = d.querySelectorAll('.balao-item.coletado');
  if (!itens.length || itens.length !== itensCol.length)
    bad('um clique nao marcou todos os pallets (' + itensCol.length + '/' + itens.length + ')');
  else ok('um clique marcou os ' + itens.length + ' pallets');
  const selo = alvo.querySelector('.selo-coleta');
  if (!selo || selo.textContent.trim() !== '\u2713') bad('selo V ausente'); else ok('selo V presente');
  if (!d.querySelector('.balao-item.coletado')) bad('item do balao nao marcado'); else ok('item do balao marcado');
  if (!/coletado/i.test(d.getElementById('rodape').textContent)) bad('rodape sem contagem de coletado'); else ok('rodape com coletado');

  const chaves = Object.keys(W.localStorage).filter(k => k.startsWith('mapa-exp-coletados::'));
  if (!chaves.length) bad('localStorage nao gravou'); else ok('localStorage gravou (' + chaves[0] + ')');

  // Desmarcar tudo pelo balao
  [...d.querySelectorAll('.balao-coleta')].forEach(clicar);
  if (alvo.classList.contains('coletada')) bad('posicao continua coletada apos desmarcar'); else ok('posicao voltou ao normal');
  const gravado = JSON.parse(W.localStorage.getItem(chaves[0]) || '[]');
  if (gravado.length) bad('localStorage nao esvaziou'); else ok('localStorage esvaziou ao desmarcar');

  // Remover pallet original (bipado): deve sumir e a contagem cair
  const antesRemover = d.querySelectorAll('#painel-conteudo .balao-item').length;
  const remover = d.querySelector('#painel-conteudo .balao-remover');
  if (antesRemover < 1 || !remover) bad('sem botao remover para pallet bipado');
  else {
    clicar(remover);
    const depoisRemover = d.querySelectorAll('#painel-conteudo .balao-item').length;
    if (depoisRemover !== antesRemover - 1) bad('remover nao reduziu a contagem de pallets');
    else ok('pallet bipado removido (' + antesRemover + '->' + depoisRemover + ')');
  }

  fim();
}, 600);

function fim() {
  console.log('--- falhas: ' + fails);
  process.exit(fails ? 1 : 0);
}
