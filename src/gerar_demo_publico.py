"""Gera um mapa sintético (100% fictício) para divulgação pública.

Nenhum dado real de SAP/LX02/coletor é utilizado: materiais, lotes, UDs e
marca são inventados. Serve para gravar demonstrações (ex.: LinkedIn,
vídeos, screenshots) sem expor informação da empresa.

Os materiais aparecem como "Produto A", "Produto B", ... e cada um recebe
uma cor/padrão próprio na tela, virando o elemento visual da demonstração.

Uso:
  python gerar_demo_publico.py [saida.html]
"""

import datetime
import os
import random
import sys

import pandas as pd

from gerar_mapa_html import SUBTITULO, VERSAO, injetar_template
from mapa_dados import DIR_SAIDA, estruturar_filas, resolver_saida

ARQUIVO_SAIDA_PADRAO = os.path.join(DIR_SAIDA, 'MAPA_EXP_LINKEDIN.html')

# Identidade neutra: sem nome de empresa.
MARCA_PUBLICA = 'Mapa EXP'
ARQUIVOS_PUBLICOS = {'lx02': 'estoque.xlsx', 'coletor': 'coletor.txt'}

# Cenário da planta fictícia
TOTAL_FILAS = 6
POSICOES_POR_FILA = 18
LETRAS_MATERIAIS = list('ABCDEFGHIJKL')  # 12 produtos -> variação de cores
SEMENTE = 42  # deixa o cenário reproduzível entre execuções

# Colunas que `estruturar_filas` consome ao montar a tela.
COLUNAS_MAPA = [
    'UD_chave', 'Fila', 'Posicao', 'Empilhamento',
    'Material', 'Texto breve de material', 'Lote',
    'Estoque total', 'UMB', 'Data EM', 'Data venc.',
]


def _nome_material(indice):
  """Nome fictício neutro no formato MAT001, MAT002, ..."""
  return f'MAT{indice + 1:03d}'


def _catalogo():
  """Cria os produtos fictícios e seus lotes (1 a 3 lotes por produto)."""
  produtos = []
  for indice, letra in enumerate(LETRAS_MATERIAIS):
    quantidade_lotes = (indice % 3) + 1
    produtos.append({
        'material': letra,
        'descricao': _nome_material(indice),
        'lotes': [f'Lote {n}' for n in range(1, quantidade_lotes + 1)],
    })
  return produtos


def _gerar_posicoes(rng, produtos):
  """Distribui pallets (0, 1 ou 2 por posição) pelas filas."""
  registros = []
  posicoes_vazias = []
  ud = 0

  for fila in range(1, TOTAL_FILAS + 1):
    for posicao in range(1, POSICOES_POR_FILA + 1):
      quantidade = rng.choices([0, 1, 2], weights=[15, 40, 45])[0]
      if quantidade == 0:
        posicoes_vazias.append({'fila': fila, 'posicao': posicao})
        continue

      produto = rng.choice(produtos)
      for nivel in range(1, quantidade + 1):
        ud += 1
        registros.append({
            'UD_chave': f'PAL-{ud:04d}',
            'Fila': fila,
            'Posicao': posicao,
            'Empilhamento': nivel,
            'Material': produto['material'],
            'Texto breve de material': produto['descricao'],
            'Lote': rng.choice(produto['lotes']),
            'Estoque total': rng.randint(10, 900),
            'UMB': 'UN',
            'Data EM': f'2026-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}',
            'Data venc.': f'2027-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}',
        })

  return registros, posicoes_vazias


def _validar_publico(filas):
  """Trava de segurança: garante que nada com aparência de dado real vazou."""
  codigos = set(LETRAS_MATERIAIS)
  nomes = {_nome_material(i) for i in range(len(LETRAS_MATERIAIS))}
  for fila in filas:
    for posicao in fila['posicoes']:
      for pallet in posicao['pallets']:
        if not str(pallet['ud']).startswith('PAL-'):
          raise SystemExit(f'UD inesperada no demo público: {pallet["ud"]}')
        if pallet['material'] not in codigos:
          raise SystemExit(f'Material inesperado: {pallet["material"]}')
        if pallet['descricao'] not in nomes:
          raise SystemExit(f'Descrição inesperada: {pallet["descricao"]}')


def gerar_demo(saida=ARQUIVO_SAIDA_PADRAO):
  """Monta e grava o HTML de demonstração pública. Devolve o payload."""
  rng = random.Random(SEMENTE)

  produtos = _catalogo()
  registros, posicoes_vazias = _gerar_posicoes(rng, produtos)
  problemas = []

  df_mapa = pd.DataFrame(registros, columns=COLUNAS_MAPA)
  filas = estruturar_filas(df_mapa, posicoes_vazias, problemas)

  payload = {
      'marca': MARCA_PUBLICA,
      'subtitulo': SUBTITULO,
      'versao': VERSAO,
      'gerado_em': datetime.datetime.now().strftime('%d/%m/%Y %H:%M'),
      'arquivos': ARQUIVOS_PUBLICOS,
      'filas': filas,
      'problemas': problemas,
      'alertas': [],
  }

  _validar_publico(filas)
  injetar_template(payload, saida)
  return payload


if __name__ == '__main__':
  arquivo_saida = resolver_saida(sys.argv[1]) if len(sys.argv) > 1 else ARQUIVO_SAIDA_PADRAO

  print('Gerando cenário fictício (sem dados reais)...')
  payload = gerar_demo(arquivo_saida)

  total_pallets = sum(
      len(posicao['pallets'])
      for fila in payload['filas']
      for posicao in fila['posicoes']
  )
  total_vazias = sum(
      1
      for fila in payload['filas']
      for posicao in fila['posicoes']
      if posicao['estado'] == 'vazia'
  )
  print(f'Filas: {len(payload["filas"])} | Pallets: {total_pallets} '
        f'| Posições vazias: {total_vazias} '
        f'| Avisos: {len(payload["problemas"]) + len(payload["alertas"])}')
  print(f'\nArquivo gerado: {arquivo_saida}')
  print('Seguro para publicar: contém apenas dados fictícios.')
