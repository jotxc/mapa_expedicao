const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const arquivo = path.join(__dirname, '..', 'dist', 'MAPA_EXP_DEMO.html');
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
  },
});
const { window } = dom;
const doc = window.document;

setTimeout(() => {
  const checks = [];
  const ok = (nome, cond) => checks.push([nome, !!cond]);

  ok('sem erros de script', erros.length === 0);
  ok('sem #botao-cheio', !doc.getElementById('botao-cheio'));
  ok('sem .mapa-acoes', !doc.querySelector('.mapa-acoes'));
  ok('upload oculto com dados', doc.getElementById('upload').hidden);
  ok('CSS .upload[hidden] presente', /\.upload\[hidden\]\s*\{\s*display:\s*none/.test(html));
  ok('avisos renderizados', doc.querySelector('#avisos .aviso'));
  ok('mapa renderizado', doc.querySelectorAll('.posicao').length > 0);
  ok('rodape com resumo', doc.querySelector('.resumo-rodape'));

  doc.getElementById('botao-arquivos').click();
  ok('upload visivel apos Arquivos', !doc.getElementById('upload').hidden);
  ok('cancelar visivel com dados', !doc.getElementById('upload-cancelar').hidden);

  doc.getElementById('upload-cancelar').click();
  ok('upload oculto ao voltar', doc.getElementById('upload').hidden);
  ok('mapa visivel ao voltar', !doc.getElementById('mapa').hidden);

  checks.forEach(([n, c]) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + n));
  console.log('--- posicoes:', doc.querySelectorAll('.posicao').length, '| falhas:', checks.filter(c => !c[1]).length);
  if (erros.length) console.log(erros.join('\n'));
  process.exit(checks.some(c => !c[1]) ? 1 : 0);
}, 400);
