const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const arquivo = process.argv[2] || path.join(__dirname, '..', 'dist', 'MAPA_EXP.html');
const html = fs.readFileSync(arquivo, 'utf8');
const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => erros.push('jsdomError: ' + e.message));
vc.on('error', (...a) => erros.push('error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = () => ({
      matches: false,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
    });
    window.print = () => {};
  },
});
const doc = dom.window.document;

setTimeout(() => {
  const checks = [];
  const ok = (n, c) => checks.push([n, !!c]);
  ok('sem erros de script', erros.length === 0);
  ok('tela de upload visivel (app em branco)', !doc.getElementById('upload').hidden);
  ok('header oculto na tela de upload', doc.querySelector('header').hidden);
  ok('sem botoes de tela cheia', !doc.getElementById('botao-cheio') && !doc.getElementById('mapa-acoes'));
  checks.forEach(([n, c]) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + n));
  const falhas = checks.filter(c => !c[1]).length;
  console.log('--- ' + path.basename(arquivo) + ' | falhas:', falhas);
  if (erros.length) console.log(erros.join('\n'));
  process.exit(falhas ? 1 : 0);
}, 400);
