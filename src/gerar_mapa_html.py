import base64
import datetime
import json
import os
import re
import sys

from mapa_dados import (
    ARQUIVO_LX02_PADRAO,
    DIR_SAIDA,
    DIR_VENDOR,
    DIR_WEB,
    estruturar_filas,
    montar_mapa,
    resolver_entrada,
    resolver_saida,
)

ARQUIVO_TEMPLATE = os.path.join(DIR_WEB, 'mapa_template.html')
ARQUIVO_SAIDA_PADRAO = os.path.join(DIR_SAIDA, 'MAPA_EXP.html')
LIB_PDFJS = os.path.join(DIR_VENDOR, 'pdf.min.js')
LIB_XLSX = os.path.join(DIR_VENDOR, 'xlsx.full.min.js')
LIB_PDFJS_WORKER = os.path.join(DIR_VENDOR, 'pdf.worker.min.js')
ARQUIVO_CORE = os.path.join(DIR_WEB, 'mapa_core.js')

# Identidade exibida no cabeçalho e no título da página
MARCA = 'Mapa EXP'
SUBTITULO = 'Expedição — Conferência de pallets'
VERSAO = '1.0'


def _ler_js(caminho):
  """Lê um arquivo JS para embutir em <script>.

  Escapa a sequência "</script" para que o conteúdo do arquivo não feche a
  tag prematuramente (em JS, "<\\/script" é equivalente a "</script").
  """
  with open(caminho, 'r', encoding='utf-8') as arquivo:
    return re.sub(r'</script', r'<\\/script', arquivo.read(), flags=re.IGNORECASE)


def _worker_b64():
  """Devolve o worker do PDF.js em base64 (vira um Blob no navegador)."""
  with open(LIB_PDFJS_WORKER, 'rb') as arquivo:
    return base64.b64encode(arquivo.read()).decode('ascii')


def _injetar_libs(html):
  """Substitui os marcadores do template pelas bibliotecas embutidas."""
  for caminho in (LIB_PDFJS, LIB_XLSX, LIB_PDFJS_WORKER, ARQUIVO_CORE):
    if not os.path.exists(caminho):
      raise SystemExit(
          f'Recurso "{caminho}" não encontrado. Baixe as bibliotecas para a '
          f'pasta "{DIR_VENDOR}" e mantenha o arquivo "{ARQUIVO_CORE}".'
      )
  html = html.replace('/*__LIB_PDFJS__*/', _ler_js(LIB_PDFJS))
  html = html.replace('/*__LIB_XLSX__*/', _ler_js(LIB_XLSX))
  html = html.replace('/*__MAPA_CORE__*/', _ler_js(ARQUIVO_CORE))
  html = html.replace('__PDF_WORKER_B64__', _worker_b64())
  return html


def injetar_template(payload, caminho_saida):
  """Escreve o HTML único (dados + tela) a partir de um payload já montado.

  `payload=None` gera o **app em branco** (só a tela de upload, sem dados).
  Separado de `gerar_html` para permitir reutilizar o mesmo template em
  outras origens de dados (por exemplo, um cenário totalmente fictício).
  """
  if not os.path.exists(ARQUIVO_TEMPLATE):
    raise SystemExit(f'Template "{ARQUIVO_TEMPLATE}" não encontrado.')

  # json.dumps gera um texto válido de JavaScript. Trocamos "<" por "\u003c"
  # para que nenhum texto do SAP consiga "fechar" a tag <script>.
  if payload is None:
    dados_js = 'null'
  else:
    dados_js = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c')

  with open(ARQUIVO_TEMPLATE, 'r', encoding='utf-8') as arquivo:
    template = arquivo.read()

  html = template.replace('__DADOS_MAPA__', dados_js)
  html = _injetar_libs(html)

  diretorio = os.path.dirname(os.path.abspath(caminho_saida))
  os.makedirs(diretorio, exist_ok=True)
  with open(caminho_saida, 'w', encoding='utf-8') as arquivo:
    arquivo.write(html)


def montar_payload(resultado, arquivos):
  """Monta o dicionário de dados que a tela consome."""
  return {
      'marca': MARCA,
      'subtitulo': SUBTITULO,
      'versao': VERSAO,
      'gerado_em': datetime.datetime.now().strftime('%d/%m/%Y %H:%M'),
      'arquivos': arquivos,
      'filas': estruturar_filas(
          resultado['df_mapa'],
          resultado['posicoes_vazias'],
          resultado['problemas'],
      ),
      'problemas': resultado['problemas'],
      'alertas': resultado['alertas'],
  }


def gerar_html(caminho_lx02, caminho_coletor, caminho_saida):
  """Monta o arquivo HTML único (dados + tela) para abrir no celular.

  `caminho_coletor` pode ser um caminho único ou uma lista (vários PDFs/TXTs).
  """
  resultado = montar_mapa(caminho_lx02, caminho_coletor)
  coletores = (list(caminho_coletor)
               if isinstance(caminho_coletor, (list, tuple))
               else [caminho_coletor])
  payload = montar_payload(resultado, {
      'lx02': os.path.basename(str(caminho_lx02)),
      'coletor': ', '.join(os.path.basename(str(c)) for c in coletores),
  })
  injetar_template(payload, caminho_saida)
  return payload


def _separar_argumentos(argumentos, saida_padrao=ARQUIVO_SAIDA_PADRAO):
  """Trata os argumentos da linha de comando.

  Qualquer argumento terminado em ".html" ou ".xlsx" é a saída; os demais são
  entradas do coletor (aceita vários). A lista de entradas pode voltar vazia
  (quem chama decide o padrão).
  """
  saida = saida_padrao
  entradas = []
  for argumento in argumentos:
    if argumento.lower().endswith(('.html', '.xlsx')):
      saida = argumento
    else:
      entradas.append(argumento)
  return entradas, saida


if __name__ == '__main__':
  entradas, arquivo_saida = _separar_argumentos(sys.argv[1:])
  # Nomes simples entram por data/input e saem em dist/ (aceita caminhos também).
  entradas = [resolver_entrada(entrada) for entrada in entradas]
  arquivo_saida = resolver_saida(arquivo_saida)

  if not entradas:
    # Sem arquivos: gera o app em branco (abre a tela de upload no navegador)
    print(f'1. Gerando o app em branco (tela de upload) em "{arquivo_saida}"...')
    injetar_template(None, arquivo_saida)
    print(f'\nArquivo gerado: {arquivo_saida}')
    print('Abra no navegador e carregue a LX02 (.xlsx) e o coletor (PDF/TXT).')
  else:
    print(f'1. Lendo LX02 ({ARQUIVO_LX02_PADRAO}) e coletor '
          f'({", ".join(entradas)})...')
    payload = gerar_html(ARQUIVO_LX02_PADRAO, entradas, arquivo_saida)

    total_pallets = sum(
        len(posicao['pallets'])
        for fila in payload['filas']
        for posicao in fila['posicoes']
    )
    print(f'2. Filas: {len(payload["filas"])} | Pallets: {total_pallets} '
          f'| Problemas: {len(payload["problemas"])} '
          f'| Alertas: {len(payload["alertas"])}')
    print(f'\nArquivo gerado: {arquivo_saida}')
    print('Abra esse arquivo no navegador (no PC ou no celular).')
