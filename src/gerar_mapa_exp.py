import os
import sys

from mapa_dados import (
    ARQUIVO_COLETOR_PADRAO,
    ARQUIVO_LX02_PADRAO,
    DIR_SAIDA,
    montar_mapa,
    resolver_entrada,
    resolver_saida,
)
from gerar_mapa_html import _separar_argumentos

ARQUIVO_SAIDA_PADRAO = os.path.join(DIR_SAIDA, 'MAPA_EXP_FINAL.xlsx')


# --- EXECUÇÃO DO PROCESSO (Excel) ---
if __name__ == '__main__':
  # Aceita vários arquivos de coletor; ".xlsx" no fim define a saída
  entradas, arquivo_saida = _separar_argumentos(sys.argv[1:], ARQUIVO_SAIDA_PADRAO)
  entradas = [resolver_entrada(entrada) for entrada in entradas]
  if not entradas:
    entradas = [ARQUIVO_COLETOR_PADRAO]
  arquivo_saida = resolver_saida(arquivo_saida)
  if not arquivo_saida.lower().endswith('.xlsx'):
    arquivo_saida = ARQUIVO_SAIDA_PADRAO

  print(f'1. Lendo dados da LX02 ({ARQUIVO_LX02_PADRAO})...')
  print(f'2. Interpretando o coletor ({", ".join(entradas)})...')

  resultado = montar_mapa(ARQUIVO_LX02_PADRAO, entradas)
  df_fisico = resultado['df_fisico']
  df_sap = resultado['df_sap']
  problemas = resultado['problemas']
  alertas = resultado['alertas']

  # --- Relatório de conferência ---
  total_uds_sap = len(df_sap['UD_chave'].unique()) if df_sap is not None else 0
  nao_capturadas = (len(set(df_sap['UD_chave']) - set(df_fisico['UD_chave']))
                    if df_sap is not None else 0)

  print('\n========== CONFERÊNCIA ==========')
  print(f'Pallets interpretados no coletor:      {len(df_fisico)}')
  print(f'Posições vazias explícitas:            {len(resultado["posicoes_vazias"])}')
  print(f'UDs distintas na LX02:                 {total_uds_sap}')
  print(f'UDs da LX02 não capturadas:            {nao_capturadas}')
  print(f'Linhas antes do cruzamento:            {len(df_fisico)}')

  if alertas:
    print('\n---------- ALERTAS ----------')
    for item in alertas:
      print(f'  ! {item["mensagem"]}')

  if problemas:
    # Só erros estruturais interrompem; divergências de UD viram aviso.
    bloqueantes = [
        item for item in problemas
        if item.get('tipo') in ('coluna_ausente', 'erro_leitura_lx02')
    ]
    print('\n---------- ' + ('ERROS' if bloqueantes else 'AVISOS') + ' ----------')
    for item in problemas:
      print(f'  X {item["mensagem"]}')
    if bloqueantes:
      raise SystemExit(
          f'\nProcessamento interrompido: {len(bloqueantes)} erro(s). '
          'Nenhum arquivo foi gerado.'
      )

  # --- Exportação ---
  print('\n3. Cruzando informações pela UD...')
  df_final = resultado['df_final']
  print(f'Linhas depois do cruzamento:           {len(df_final)}')
  df_final.to_excel(arquivo_saida, index=False)
  print(f'\nArquivo gerado: {arquivo_saida}')
