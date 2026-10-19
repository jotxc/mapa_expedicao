const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const arquivo = process.argv[2] || path.join(__dirname, '..', 'dist', 'MAPA_EXP_DEMO.html');
const html = fs.readFileSync(arquivo, 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) { w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener() {}, removeEventListener() {} }); },
});
setTimeout(() => {
  const t = dom.window.document.getElementById('subtitulo').textContent;
  console.log('subtitulo =', JSON.stringify(t));
  process.exit(/^Última atualização: \d\d\/\d\d\/\d{4}/.test(t) ? 0 : 1);
}, 400);
