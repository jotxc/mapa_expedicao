import datetime
import os
import re
import unicodedata

import pandas as pd

# --- CAMINHOS DO PROJETO ---
# Tudo é ancorado na localização deste arquivo, então os scripts funcionam
# chamados de qualquer diretório.
DIR_SRC = os.path.dirname(os.path.abspath(__file__))
DIR_RAIZ = os.path.dirname(DIR_SRC)
DIR_WEB = os.path.join(DIR_SRC, 'web')
DIR_VENDOR = os.path.join(DIR_WEB, 'vendor')
DIR_ENTRADA = os.path.join(DIR_RAIZ, 'data', 'input')
DIR_SAIDA = os.path.join(DIR_RAIZ, 'dist')

# --- NOMES DE ARQUIVO PADRÃO (entrada do dia) ---
ARQUIVO_LX02_PADRAO = os.path.join(DIR_ENTRADA, 'lx02.xlsx')
ARQUIVO_COLETOR_PADRAO = os.path.join(DIR_ENTRADA, 'filas.pdf')


def resolver_entrada(caminho):
  """Resolve um caminho de entrada.

  Caminho absoluto ou com pasta (ex.: `sub/x.xlsx`) é usado como veio; um nome
  simples (ex.: `filas.pdf`) é procurado em `data/input`.
  """
  if not caminho:
    return caminho
  if os.path.isabs(caminho) or os.path.dirname(str(caminho)):
    return caminho
  return os.path.join(DIR_ENTRADA, caminho)


def resolver_saida(caminho):
  """Resolve um caminho de saída.

  Caminho absoluto ou com pasta é respeitado; nome simples vai para `dist/`.
  """
  if not caminho:
    return caminho
  if os.path.isabs(caminho) or os.path.dirname(str(caminho)):
    return caminho
  return os.path.join(DIR_SAIDA, caminho)

# Aceita somente "FILA" seguido de um número (ex.: FILA 2) no TXT do coletor
PADRAO_FILA = re.compile(r'^FILA\s+(\d+)$')

# Título de seção no PDF consolidado (Stock Count): "FILA 1" ou o legado
# "INVENTÁRIO 2" (aplicado sobre o texto já normalizado, sem acento)
PADRAO_TITULO_SECAO = re.compile(r'^(?:FILA|INVENT[AÁ]?RIO)\s*(\d+)$')

# Linha de item do PDF: "12 1025306046 1025306046 1 17.10.202609:46"
PADRAO_ITEM_PDF = re.compile(r'^\s*\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+')

# Como identificar a fila no nome do arquivo (ex.: "FILA 2", "INVENTARIO_3")
PADRAO_NUM_FILA_ARQ = re.compile(r'(?:FILA|INVENT[AÁ]?RIO)[\s_-]*(\d+)',
                                 re.IGNORECASE)

# No PDF, a UD do SAP tem sempre 10 dígitos. Número curto (ex.: "1", "2", "3")
# ou com sufixo "v" (ex.: "12v", formato antigo) marca uma posição vazia.
UD_COMPRIMENTO = 10
PADRAO_UD = re.compile(r'^\d{%d}$' % UD_COMPRIMENTO)
PADRAO_VAZIO = re.compile(r'^(?:\d{1,%d}|\d+[vV])$' % (UD_COMPRIMENTO - 1))

# A EXP tem aproximadamente 6 filas; acima disso apenas alertamos
MAX_FILA_ESPERADA = 6

# Comprimento do estante (nº de posições por fila). 0 = automático: usa a
# fila com mais posições do dia e completa as demais com posições vazias
# (o operador costuma parar de bipar antes do fim do estante).
MAX_POSICOES_POR_FILA = 0

# Colunas que precisam existir na exportação da LX02
# Colunas que precisam existir na exportação da LX02, com nomes alternativos
# que o SAP usa em algumas versões do relatório (a ordem dos apelidos importa:
# o primeiro que existir é o escolhido).
COLUNAS_LX02 = [
    'Unidade de depósito',
    'Material',
    'Texto breve de material',
    'Lote',
    'Estoque total',
    'UMB',
    'Data EM',
    'Data venc.',
]

APELIDOS_LX02 = {
    'Unidade de depósito': ['Unidade de depósito'],
    'Material': ['Material'],
    'Texto breve de material': ['Texto breve de material'],
    'Lote': ['Lote'],
    'Estoque total': ['Estoque total'],
    'UMB': ['UMB', 'UM básica'],
    'Data EM': ['Data EM', 'Data da entrada de mercadorias'],
    'Data venc.': ['Data venc.', 'Data do vencimento'],
}

# Ordem das colunas no arquivo de saída (Excel)
COLUNAS_FISICO = ['UD_chave', 'Fila', 'Posicao', 'Empilhamento']
COLUNAS_SAIDA = ['Fila', 'Posicao', 'Empilhamento'] + COLUNAS_LX02


def _chave_coluna(nome):
  """Normaliza o nome de uma coluna para comparação (sem acento/maiúscula)."""
  return _normalizar_texto(str(nome)).strip().lower()


def carregar_dados_sap(caminho):
  """Lê a exportação LX02 do SAP e devolve a tabela com a chave UD em texto.

  Aceita variações de nome de coluna entre versões do relatório (ver
  `APELIDOS_LX02`) e renomeia tudo para os nomes canônicos. Levanta erro
  (FileNotFoundError/ValueError) quando o arquivo não existe ou quando falta
  alguma coluna esperada. Quem chama decide o que fazer.
  """
  if not os.path.exists(caminho):
    raise FileNotFoundError(f'Arquivo "{caminho}" não encontrado.')

  df_sap = pd.read_excel(caminho, sheet_name=0)
  por_chave = {_chave_coluna(c): c for c in df_sap.columns}

  renomear = {}
  faltando = []
  for canonico in COLUNAS_LX02:
    encontrado = None
    for apelido in APELIDOS_LX02[canonico]:
      real = por_chave.get(_chave_coluna(apelido))
      if real is not None:
        encontrado = real
        break
    if encontrado is None:
      faltando.append(canonico)
    elif encontrado != canonico:
      renomear[encontrado] = canonico

  if faltando:
    raise ValueError(
        f'A exportação "{caminho}" não contém as colunas: '
        f'{", ".join(faltando)}. Colunas encontradas: '
        f'{", ".join(map(str, df_sap.columns))}'
    )

  df_sap = df_sap.rename(columns=renomear)

  # Descarta linhas de total/rodapé sem UD (o SAP às vezes inclui uma vazia)
  df_sap = df_sap[df_sap['Unidade de depósito'].notna()].copy()

  # Chave em texto: evita decimal (1025265479.0) e problemas de formatação
  serie_ud = df_sap['Unidade de depósito']
  if pd.api.types.is_numeric_dtype(serie_ud):
    serie_ud = serie_ud.round().astype('Int64')
  df_sap['UD_chave'] = serie_ud.astype(str).str.strip()
  return df_sap


def processar_coletor_txt(caminho):
  """Interpreta o TXT do coletor e calcula Fila, Posição e Empilhamento.

  Devolve quatro coisas:
    - DataFrame com os pallets (uma linha por pallet);
    - lista de posições vazias explícitas (marcadas com "0" no caso B);
    - lista de problemas (erros encontrados);
    - lista de alertas (avisos que não impedem o uso dos dados).
  Esta função não interrompe a execução: apenas relata os problemas.

  O TXT é convertido em tokens por fila e entregue ao motor compartilhado
  (`_motor_tokens`), o mesmo usado pelo PDF consolidado.
  """
  problemas = []
  alertas = []
  posicoes_vazias = []
  uds_vistas = set()
  marcou_fila = False

  fila_atual = 1
  # Tokens por fila, na ordem em que aparecem: ("U", ud, qty) ou ("V", rotulo, qty)
  tokens_por_fila = {}

  with open(caminho, 'r', encoding='utf-8') as arquivo:
    for numero, linha in enumerate(arquivo, start=1):
      linha_limpa = linha.strip().upper()

      # Linhas em branco não representam nada
      if not linha_limpa:
        continue

      # --- Marcador de mudança de fila ---
      if linha_limpa.startswith('FILA'):
        encontrou = PADRAO_FILA.match(linha_limpa)
        if not encontrou:
          problemas.append({
              'tipo': 'marcador_fila_invalido',
              'fila': fila_atual,
              'posicao': 1,
              'mensagem': f'Linha {numero}: marcador de fila inválido '
                          f'-> "{linha.strip()}"',
          })
          continue

        fila_atual = int(encontrou.group(1))
        if fila_atual > MAX_FILA_ESPERADA:
          alertas.append({
              'fila': fila_atual,
              'posicao': 1,
              'mensagem': f'Linha {numero}: FILA {fila_atual} acima do esperado '
                          f'(a EXP tem aproximadamente {MAX_FILA_ESPERADA} filas)',
          })
        marcou_fila = True
        continue

      # --- Regra do zero (marcador de controle, nunca é pallet) ---
      if linha_limpa == '0':
        tokens_por_fila.setdefault(fila_atual, []).append(('V', '0', 1))
        continue

      # --- Linha que não é UD numérica nem marcador conhecido ---
      if not linha_limpa.isdigit():
        problemas.append({
            'tipo': 'registro_desconhecido',
            'fila': fila_atual,
            'posicao': 1,
            'mensagem': f'Linha {numero}: registro desconhecido '
                        f'-> "{linha.strip()}"',
        })
        continue

      # --- UD válida: entra na posição atual ---
      tokens_por_fila.setdefault(fila_atual, []).append(('U', linha_limpa, 1))

  registros = []
  for fila in sorted(tokens_por_fila):
    registros.extend(_motor_tokens(
        tokens_por_fila[fila], fila, problemas, alertas, posicoes_vazias,
        uds_vistas, aceitar_terminador=False,
    ))

  if not marcou_fila and registros:
    alertas.append({
        'mensagem': 'Nenhum marcador FILA encontrado no arquivo: '
                    f'todas as {len(registros)} UDs foram classificadas na Fila 1',
    })

  if not registros and not problemas:
    problemas.append({
        'tipo': 'sem_uds',
        'mensagem': f'Nenhuma UD encontrada em "{caminho}"',
    })

  df_fisico = pd.DataFrame(registros, columns=COLUNAS_FISICO)
  return df_fisico, posicoes_vazias, problemas, alertas


def montar_mapa(caminho_lx02=ARQUIVO_LX02_PADRAO,
                caminho_coletor=ARQUIVO_COLETOR_PADRAO):
  """Junta LX02 + coletor (PDF e/ou TXT) e devolve tudo o que as telas precisam.

  `caminho_coletor` pode ser um caminho único ou uma lista de caminhos
  (vários PDFs por fila, por exemplo).

  Diferente do script do Excel, esta função NÃO interrompe em caso de
  problema: ela devolve a lista de problemas para quem chamar decidir.

  Devolve um dicionário com:
    df_final, df_fisico, df_sap, posicoes_vazias, problemas, alertas.
  """
  problemas = []
  alertas = []
  posicoes_vazias = []

  # --- 1. Leitura da LX02 ---
  df_sap = None
  try:
    df_sap = carregar_dados_sap(caminho_lx02)
  except FileNotFoundError:
    problemas.append({
        'tipo': 'arquivo_nao_encontrado',
        'mensagem': f'Arquivo "{caminho_lx02}" não encontrado nesta pasta.',
    })
  except ValueError as erro:
    problemas.append({'tipo': 'coluna_ausente', 'mensagem': str(erro)})
  except Exception as erro:  # arquivo corrompido, formato inesperado etc.
    problemas.append({
        'tipo': 'erro_leitura_lx02',
        'mensagem': f'Falha ao ler "{caminho_lx02}": {erro}',
    })

  # --- 2. Leitura do coletor (PDF consolidado e/ou TXT) ---
  df_fisico = pd.DataFrame(columns=COLUNAS_FISICO)
  if isinstance(caminho_coletor, (list, tuple)):
    caminhos_coletor = list(caminho_coletor)
  else:
    caminhos_coletor = [caminho_coletor]
  caminhos_coletor = [c for c in caminhos_coletor if c]
  existentes = [c for c in caminhos_coletor if os.path.exists(c)]
  if not existentes:
    problemas.append({
        'tipo': 'arquivo_nao_encontrado',
        'mensagem': 'Arquivo(s) do coletor não encontrado(s): '
                    + ', '.join(map(str, caminhos_coletor)),
    })
  else:
    try:
      df_fisico, posicoes_vazias, problemas_txt, alertas_txt = (
          processar_coletor(existentes)
      )
      problemas.extend(problemas_txt)
      alertas.extend(alertas_txt)
    except Exception as erro:  # PDF corrompido, formato inesperado etc.
      problemas.append({
          'tipo': 'erro_leitura_coletor',
          'mensagem': 'Falha ao ler o coletor: ' + str(erro),
      })

  # --- 3. Cruzamento pela UD ---
  df_final = None
  df_mapa = None
  if df_sap is not None and len(df_fisico) > 0:
    # Mapa UD -> posições físicas (para tornar os erros clicáveis na tela)
    posicoes_por_ud = {}
    for _, linha_fisica in df_fisico.iterrows():
      posicoes_por_ud.setdefault(str(linha_fisica['UD_chave']), []).append({
          'fila': int(linha_fisica['Fila']),
          'posicao': int(linha_fisica['Posicao']),
      })

    duplicadas_sap = sorted(
        df_sap.loc[df_sap['UD_chave'].duplicated(), 'UD_chave'].unique()
    )
    if duplicadas_sap:
      problemas.append({
          'tipo': 'ud_duplicada_lx02',
          'uds': duplicadas_sap,
          'fila': posicoes_por_ud.get(duplicadas_sap[0], [{}])[0].get('fila'),
          'posicao': posicoes_por_ud.get(duplicadas_sap[0], [{}])[0].get('posicao'),
          'mensagem': f'UDs duplicadas na LX02 ({len(duplicadas_sap)}): '
                      + ', '.join(duplicadas_sap),
      })

    ausentes = sorted(set(df_fisico['UD_chave']) - set(df_sap['UD_chave']))
    if ausentes:
      problemas.append({
          'tipo': 'ud_ausente_lx02',
          'uds': ausentes,
          'fila': posicoes_por_ud.get(ausentes[0], [{}])[0].get('fila'),
          'posicao': posicoes_por_ud.get(ausentes[0], [{}])[0].get('posicao'),
          'mensagem': f'UDs do coletor não encontradas na LX02 '
                      f'({len(ausentes)}): ' + ', '.join(ausentes),
      })

    df_mapa = pd.merge(df_fisico, df_sap, on='UD_chave', how='left')
    df_final = df_mapa[COLUNAS_SAIDA]

    if len(df_final) != len(df_fisico):
      problemas.append({
          'tipo': 'linhas_divergentes',
          'mensagem': 'A quantidade de linhas mudou durante o cruzamento. '
                      f'Antes: {len(df_fisico)} | Depois: {len(df_final)}',
      })

  return {
      'df_final': df_final,
      'df_mapa': df_mapa,
      'df_fisico': df_fisico,
      'df_sap': df_sap,
      'posicoes_vazias': posicoes_vazias,
      'problemas': problemas,
      'alertas': alertas,
  }


# --- MONTAGEM DA ESTRUTURA PARA A TELA ---
def _texto(valor):
  """Converte um valor da planilha em texto (ou None quando estiver vazio)."""
  if valor is None or pd.isna(valor):
    return None
  if isinstance(valor, (pd.Timestamp, datetime.datetime, datetime.date)):
    return valor.strftime('%Y-%m-%d')
  # Número sem casas decimais: evita "1000170.0" no material/lote
  if isinstance(valor, float) and valor.is_integer():
    return str(int(valor))
  return str(valor)


def _numero(valor):
  """Converte um valor da planilha em número (ou None quando estiver vazio)."""
  if valor is None or pd.isna(valor):
    return None
  try:
    return int(valor)
  except (TypeError, ValueError):
    try:
      return float(valor)
    except (TypeError, ValueError):
      return None


def estruturar_filas(df_mapa, posicoes_vazias, problemas):
  """Organiza os pallets em filas e posições para a interface.

  Devolve uma lista de filas; cada fila tem uma lista de posições; cada
  posição tem um estado (ocupada, vazia ou inconsistente) e seus pallets.
  """
  # UDs que deram problema no cruzamento (não casaram ou estão duplicadas)
  uds_problema = set()
  for item in problemas:
    if item.get('tipo') in ('ud_ausente_lx02', 'ud_duplicada_lx02'):
      uds_problema.update(item.get('uds', []))

  posicoes = {}

  # 1. Pallets vindos do cruzamento
  if df_mapa is not None:
    for _, linha in df_mapa.iterrows():
      fila = int(linha['Fila'])
      posicao = int(linha['Posicao'])
      ud = str(linha['UD_chave'])
      material = _texto(linha['Material'])

      pallet = {
          'ud': ud,
          'empilhamento': int(linha['Empilhamento']),
          'material': material,
          'descricao': _texto(linha['Texto breve de material']),
          'lote': _texto(linha['Lote']),
          'estoque': _numero(linha['Estoque total']),
          'umb': _texto(linha['UMB']),
          'data_em': _texto(linha['Data EM']),
          'data_venc': _texto(linha['Data venc.']),
          'inconsistente': (ud in uds_problema) or (material is None),
      }

      chave = (fila, posicao)
      if chave not in posicoes:
        posicoes[chave] = {
            'fila': fila,
            'posicao': posicao,
            'estado': 'ocupada',
            'pallets': [],
        }
      posicoes[chave]['pallets'].append(pallet)

  # 2. Posições vazias explícitas (marcador "0" no caso B)
  for item in posicoes_vazias:
    chave = (item['fila'], item['posicao'])
    if chave not in posicoes:
      posicoes[chave] = {
          'fila': item['fila'],
          'posicao': item['posicao'],
          'estado': 'vazia',
          'pallets': [],
      }

  # 3. Define o estado final e ordena os pallets (1 = baixo, 2 = cima)
  for posicao in posicoes.values():
    if posicao['pallets']:
      if any(p['inconsistente'] for p in posicao['pallets']):
        posicao['estado'] = 'inconsistente'
      else:
        posicao['estado'] = 'ocupada'
      posicao['pallets'].sort(key=lambda pallet: pallet['empilhamento'])
    else:
      posicao['estado'] = 'vazia'

  # 4. Agrupa por fila, em ordem crescente
  por_fila = {}
  for posicao in posicoes.values():
    por_fila.setdefault(posicao['fila'], []).append(posicao)

  filas = []
  for numero_fila in sorted(por_fila):
    filas.append({
        'fila': numero_fila,
        'posicoes': sorted(por_fila[numero_fila],
                           key=lambda posicao: posicao['posicao']),
    })
  return _completar_estante(filas)


def _completar_estante(filas):
  """Iguala todas as filas ao comprimento do estante.

  O comprimento é o da fila com mais posições (`MAX_POSICOES_POR_FILA == 0`)
  ou o valor fixo configurado. Posições faltantes viram `vazia`, para que o
  operador enxergue o estante inteiro mesmo quando parou de bipar antes do fim.
  """
  if not filas:
    return filas

  definidas = [posicao['posicao'] for fila in filas for posicao in fila['posicoes']]
  max_posicoes = MAX_POSICOES_POR_FILA or (max(definidas) if definidas else 0)
  if max_posicoes <= 0:
    return filas

  for fila in filas:
    existentes = {posicao['posicao'] for posicao in fila['posicoes']}
    for numero in range(1, max_posicoes + 1):
      if numero not in existentes:
        fila['posicoes'].append({
            'fila': fila['fila'],
            'posicao': numero,
            'estado': 'vazia',
            'pallets': [],
        })
    fila['posicoes'].sort(key=lambda posicao: posicao['posicao'])
  return filas


# --- COLETOR: PDF CONSOLIDADO (Stock Count) E TXT ---

def _normalizar_texto(texto):
  """Remove acento e o caractere de substituição (U+FFFD) do texto do PDF."""
  texto = str(texto if texto is not None else '').replace('\ufffd', '')
  decomposto = unicodedata.normalize('NFKD', texto)
  return ''.join(letra for letra in decomposto if not unicodedata.combining(letra))


def identificar_fila_pdf(caminho_arquivo, titulo_pdf=''):
  """Descobre a fila de um PDF: pelo nome do arquivo ou, na falta, pelo título.

  Prioriza o nome do arquivo (o operador pode renomeá-lo); se não houver
  número nem no nome nem no título, assume a Fila 1.
  """
  nome = _normalizar_texto(os.path.basename(str(caminho_arquivo))).upper()
  encontrou = PADRAO_NUM_FILA_ARQ.search(nome)
  if encontrou:
    return int(encontrou.group(1))
  if titulo_pdf:
    limpo = _normalizar_texto(titulo_pdf).strip().upper()
    encontrou = PADRAO_TITULO_SECAO.match(limpo)
    if encontrou:
      return int(encontrou.group(1))
  return 1


def extrair_linhas_pdf(caminho_arquivo):
  """Extrai todas as linhas de texto do PDF (todas as páginas)."""
  try:
    from pypdf import PdfReader
  except Exception as erro:  # dependência opcional
    raise RuntimeError('pypdf não disponível: ' + str(erro))
  if not os.path.exists(caminho_arquivo):
    raise FileNotFoundError(f'Arquivo não encontrado: {caminho_arquivo}')
  leitor = PdfReader(caminho_arquivo)
  linhas = []
  for pagina in leitor.pages:
    try:
      texto = pagina.extract_text() or ''
    except Exception:
      texto = ''
    linhas.extend(texto.splitlines())
  return linhas


def extrair_secoes_pdf(caminho_arquivo):
  """Divide o PDF em seções por fila: lista de {'fila', 'itens'}.

  Cada item é uma tupla (valor, qty), na ordem em que aparece no arquivo.
  `fila` é None quando a seção não tem título (aí a fila vem do nome do arquivo).
  O PDF consolidado (Stock Count) lista os registros do mais recente para o
  mais antigo; a inversão para ordem física é feita depois, por seção.
  """
  linhas = extrair_linhas_pdf(caminho_arquivo)
  secoes = []
  atual = None
  for linha in linhas:
    limpa = linha.strip()
    if not limpa:
      continue

    titulo = _normalizar_texto(limpa).strip().upper()
    encontrou = PADRAO_TITULO_SECAO.match(titulo)
    if encontrou:
      atual = {'fila': int(encontrou.group(1)), 'itens': []}
      secoes.append(atual)
      continue

    # Cabeçalhos ("# Name Barcode Qty...") não são itens
    if limpa.startswith('#'):
      continue

    item = PADRAO_ITEM_PDF.match(linha)
    if item:
      if atual is None:
        atual = {'fila': None, 'itens': []}
        secoes.append(atual)
      atual['itens'].append((item.group(1).strip(), int(item.group(3))))
  return secoes


def _itens_para_tokens(itens):
  """Inverte a seção (ordem física) e classifica cada item em tokens.

  Tokens: ('U', ud, qty) para UD do SAP; ('V', rotulo, qty) para marcador de
  posição vazia; ('?', valor, 1) para algo não reconhecido.
  """
  tokens = []
  for valor, qty in reversed(itens):
    valor = str(valor).strip()
    qty = max(1, int(qty))
    if PADRAO_UD.match(valor):
      tokens.append(('U', valor, qty))
    elif PADRAO_VAZIO.match(valor):
      tokens.append(('V', valor, qty))
    else:
      tokens.append(('?', valor, 1))
  return tokens


def _motor_tokens(seq, fila, problemas, alertas, posicoes_vazias,
                  uds_vistas, aceitar_terminador):
  """Converte uma sequência de tokens em registros físicos (por fila).

  Regras (iguais às do TXT, mais o duplo scan do PDF):
    - token de vazio: fecha a posição como vazia e avança;
    - UD qty=1: entra na posição; a 2ª UD diferente fecha (2 pallets) e avança;
    - UD qty=2 (duplo scan, só no PDF): 1 pallet e avança.

  `uds_vistas` é compartilhado entre as filas para detectar UD repetida.
  """
  registros = []
  posicao = 1
  pallets = []  # UDs na posição atual

  for tipo, valor, qty in seq:
    if tipo == 'V':
      if not pallets:
        for _ in range(qty):
          posicoes_vazias.append({'fila': fila, 'posicao': posicao})
          posicao += 1
      else:
        # Marcador de vazio no meio de posição ocupada: apenas avança
        posicao += 1
      pallets = []
      continue

    if tipo == '?':
      problemas.append({
          'tipo': 'registro_desconhecido',
          'fila': fila,
          'posicao': posicao,
          'mensagem': f'Registro desconhecido (Fila {fila}, posição {posicao})'
                      f' -> "{valor}"',
      })
      continue

    # tipo == 'U': UD do SAP
    if aceitar_terminador and qty >= 2:
      # Duplo scan: sinaliza posição com 1 pallet e avança
      if qty > 2:
        problemas.append({
            'tipo': 'qty_inesperada',
            'fila': fila,
            'posicao': posicao,
            'mensagem': f'UD {valor} com Qty={qty} (Fila {fila}, posição '
                        f'{posicao}); tratada como 1 pallet',
        })
      if valor in uds_vistas:
        problemas.append({
            'tipo': 'ud_repetida',
            'ud': valor,
            'fila': fila,
            'posicao': posicao,
            'mensagem': f'UD {valor} repetida (Fila {fila}, posição {posicao})',
        })
      else:
        uds_vistas.add(valor)
        registros.append({
            'UD_chave': valor,
            'Fila': fila,
            'Posicao': posicao,
            'Empilhamento': 1,
        })
      posicao += 1
      pallets = []
      continue

    for _ in range(qty):
      if valor in uds_vistas:
        problemas.append({
            'tipo': 'ud_repetida',
            'ud': valor,
            'fila': fila,
            'posicao': posicao,
            'mensagem': f'UD {valor} repetida (Fila {fila}, posição {posicao})',
        })
        continue
      uds_vistas.add(valor)
      pallets.append(valor)
      registros.append({
          'UD_chave': valor,
          'Fila': fila,
          'Posicao': posicao,
          'Empilhamento': len(pallets),
      })
      if len(pallets) == 2:
        posicao += 1
        pallets = []

  if len(pallets) == 1:
    alertas.append({
        'fila': fila,
        'posicao': posicao,
        'mensagem': f'Última posição (Fila {fila}, Posição {posicao}) ficou '
                    'com apenas 1 pallet',
    })
  return registros


def processar_coletor_pdf(caminhos):
  """Processa um ou vários PDFs consolidados (Stock Count).

  Cada PDF pode conter várias seções "FILA N"; cada seção é invertida
  separadamente (ordem física) antes de virar registros.
  """
  if isinstance(caminhos, str):
    caminhos = [caminhos]

  problemas = []
  alertas = []
  posicoes_vazias = []
  uds_vistas = set()
  registros = []
  tokens_por_fila = {}

  for caminho in caminhos:
    if not os.path.exists(caminho):
      raise FileNotFoundError(f'Arquivo não encontrado: {caminho}')
    secoes = extrair_secoes_pdf(caminho)
    if not secoes:
      problemas.append({
          'tipo': 'pdf_sem_itens',
          'mensagem': f'Nenhum item encontrado em "{os.path.basename(caminho)}"',
      })
      continue
    fila_arquivo = identificar_fila_pdf(caminho)
    for secao in secoes:
      fila = secao['fila'] if secao['fila'] is not None else fila_arquivo
      tokens_por_fila.setdefault(fila, []).extend(_itens_para_tokens(secao['itens']))

  for fila in sorted(tokens_por_fila):
    registros.extend(_motor_tokens(
        tokens_por_fila[fila], fila, problemas, alertas, posicoes_vazias,
        uds_vistas, aceitar_terminador=True,
    ))

  if not registros and not problemas:
    problemas.append({
        'tipo': 'sem_uds',
        'mensagem': 'Nenhuma UD encontrada nos PDFs',
    })

  df_fisico = pd.DataFrame(registros, columns=COLUNAS_FISICO)
  return df_fisico, posicoes_vazias, problemas, alertas


def processar_coletor(caminhos):
  """Processa o coletor a partir de um caminho ou de uma lista.

  Se houver PDF, usa o parser de PDF consolidado; caso contrário, usa o TXT.
  Devolve sempre a mesma tupla: (df_fisico, posicoes_vazias, problemas, alertas).
  """
  if isinstance(caminhos, str):
    caminhos = [caminhos]
  caminhos = [c for c in caminhos if c]

  pdfs = [c for c in caminhos if str(c).lower().endswith('.pdf')]
  txts = [c for c in caminhos if str(c).lower().endswith('.txt')]

  if pdfs:
    return processar_coletor_pdf(pdfs)
  if txts:
    return processar_coletor_txt(txts[0])
  return (
      pd.DataFrame(columns=COLUNAS_FISICO), [], [{
          'tipo': 'formato_nao_suportado',
          'mensagem': 'Nenhum arquivo .pdf ou .txt informado',
      }], [],
  )
