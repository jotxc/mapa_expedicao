import os, re, sys, subprocess, tempfile

raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
caminho = sys.argv[1] if len(sys.argv) > 1 else os.path.join(raiz, 'dist', 'MAPA_EXP.html')
html = open(caminho, encoding='utf-8').read()
tag_re = re.compile(r'<script\b[^>]*>', re.I)
opens = [m for m in tag_re.finditer(html)]
# último <script> = app
m = opens[-1]
start = m.end()
end = html.find('</script>', start)
js = html[start:end]
tmp = os.path.join(tempfile.gettempdir(), 'app_check.js')
open(tmp, 'w', encoding='utf-8').write(js)
res = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
print('node --check rc =', res.returncode)
print(res.stdout)
print(res.stderr)
