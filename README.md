# Mapa EXP — Mapa da Expedição

Ferramenta que transforma a exportação **LX02 do SAP** + a **bipagem do coletor** (PDF consolidado do Stock Count ou TXT) em um **mapa visual da área de expedição**, mostrando em qual fila e posição está cada pallet — direto no navegador do celular, sem instalar nada.

O `MAPA_EXP.html` é um **app autônomo**: abre numa tela de **"Carregar arquivos do dia"** onde você seleciona a `lx02.xlsx` e o PDF/TXT da bipagem. Todo o processamento acontece **no próprio navegador** (offline), sem servidor.

## O problema

Encontrar um pallet na expedição dependia de memória e conferência manual. O operador sabia o material, mas não onde ele estava fisicamente no pátio. Isso gerava tempo perdido e riscos de separar o pallet errado.

## A solução

1. O sistema lê a **LX02** (estoque SAP) e a **bipagem do coletor** — o PDF consolidado do Stock Count (seções `FILA N`) ou o TXT legado — com a sequência física das UDs e marcadores de posição vazia.
2. Interpreta filas, posições e empilhamento (1 = baixo, 2 = cima) e cruza tudo pela UD.
3. Gera dois produtos:
   - `MAPA_EXP_FINAL.xlsx` — relatório de conferência em Excel;
   - `MAPA_EXP.html` — **planta baixa interativa**, arquivo único que abre no PC ou no celular. Sem argumentos, ele abre a **tela de upload**; apontando arquivos, os dados vão embutidos e o mapa abre direto.

A mesma lógica de leitura existe em duas linguagens: `mapa_dados.py` (CLI/Excel/testes) e `mapa_core.js` (usado pelo app no navegador), garantindo resultados idênticos.

## Funcionalidades da tela

- **Tela de upload**: selecione (ou arraste) a `lx02.xlsx` e um ou mais arquivos da bipagem (`.pdf`/`.txt`); o mapa é montado no navegador, sem enviar nada para servidor. O botão **Arquivos** no topo reabre a tela para trocar os arquivos do dia.
- **Planta baixa** das filas, com um quadrado por posição. Todas as filas têm o **mesmo comprimento** (o da fila mais longa do dia); as posições sem pallet aparecem como vazias, mantendo o alinhamento da estante.
- **Busca** por material, descrição, UD ou lote (ignora acento e maiúscula).
- **Filtro multi-material** com cores e **filtro por lote**.
- **Painel lateral** (no desktop) com os **materiais filtrados**: cada material vem com a cor, o nome e a quantidade de pallets; ao clicar no material, abrem os **lotes** dele para seleção, e o botão **×** exclui o material do filtro. A lista tem rolagem própria e o mapa fica enquadrado automaticamente, sem rolar a página. As cores são escolhidas por contraste (materiais vizinhos usam cores bem diferentes) e ganham listras quando se repetem.
- **Avisos clicáveis**: toque em um problema/alerta e o mapa vai até a posição. O botão **Entendido** (dentro da própria caixa colorida) recolhe a mensagem, que vira uma linha discreta **Avisos (n)** — toque nela para reabrir. No celular os avisos ficam abaixo do mapa e das descrições dos materiais.
- **Resumo no rodapé**: pallets, ocupação % e posições livres (e o total de pallets já **coletados**).
- **Detalhe da posição**: balão ancorado no próprio quadrado (funciona igual no celular), com descrição, código do material e lote.
- **Marcar coletado**: dentro do balão, **um toque** no botão **Marcar coletado** marca a posição inteira (os dois pallets de uma vez) e vira **✓ Coletado**; toque de novo para desfazer. A posição coletada fica **esmaecida/apagada com um V**. A marcação fica salva no aparelho (localStorage) e sobrevive a recarregar a página, começando zerada ao trocar os arquivos do dia.
- **Auto-enquadrar** no desktop, e **modo escuro** (preferência salva).
- **PWA**: dá para "adicionar à tela inicial" do celular.

## Como usar

Requisitos: Python 3 com as dependências de `requirements.txt`:

```powershell
pip install -r requirements.txt
```

Coloque os arquivos de entrada em `data/input/` (nomes padrão ajustáveis em `src/mapa_dados.py`):

- `data/input/lx02.xlsx` — exportação da LX02 do dia;
- `data/input/filas.pdf` — PDF consolidado da bipagem (uma seção `FILA N` por fila).

A forma mais simples é abrir o `dist/MAPA_EXP.html` gerado sem argumentos e usar a **tela de upload**: selecione a `lx02.xlsx` do dia e o PDF (ou TXT) da bipagem. Você pode trocar os arquivos quantas vezes quiser pelo botão **Arquivos**, sem regenerar o HTML.

Para deixar os dados **embutidos** no HTML (abre já no mapa, funciona offline), gere apontando os arquivos. Um nome simples é procurado em `data/input/` e a saída vai para `dist/` (caminhos absolutos ou com pasta são usados como estão):

```powershell
python src/gerar_mapa_html.py                 # app em branco (tela de upload) -> dist/MAPA_EXP.html
python src/gerar_mapa_html.py filas.pdf       # dados embutidos -> dist/MAPA_EXP.html
python src/gerar_mapa_html.py outro.pdf saida.html
python src/gerar_mapa_html.py fila1.pdf fila2.pdf MAPA_EXP.html   # vários PDFs
python src/gerar_mapa_html.py coletor_teste.txt MAPA_EXP.html     # TXT (legado)
```

Para gerar a versão de demonstração (6 filas × 18 posições, com posições vazias e variadas):

```powershell
python src/gerar_mapa_html.py coletor_demo.txt MAPA_EXP_DEMO.html
```

Para gerar uma **versão pública** (LinkedIn, vídeos, screenshots), com dados
**100% fictícios** — sem material, lote, UD ou marca reais — e materiais
exibidos como `Produto A`, `Produto B`, ... com cores:

```powershell
python src/gerar_demo_publico.py                 # -> dist/MAPA_EXP_LINKEDIN.html
```

Gerar o relatório em Excel:

```powershell
python src/gerar_mapa_exp.py                  # usa filas.pdf -> dist/MAPA_EXP_FINAL.xlsx
```

Depois abra `dist/MAPA_EXP.html` no navegador (PC ou celular).

## Estrutura do projeto

```text
.
├─ src/                      # código-fonte
│  ├─ mapa_dados.py          # núcleo Python: LX02, parsing do coletor (PDF/TXT) e cruzamento
│  ├─ mapa_core.js           # núcleo JS (espelho do Python), usado pelo app no navegador
│  ├─ gerar_mapa_html.py     # gera o MAPA_EXP.html
│  ├─ gerar_mapa_exp.py      # gera o MAPA_EXP_FINAL.xlsx
│  ├─ gerar_demo_publico.py  # gera o MAPA_EXP_LINKEDIN.html (dados fictícios)
│  └─ web/
│     ├─ mapa_template.html  # tela (HTML + CSS + JS): upload, planta, filtros, tema
│     └─ vendor/             # libs embutidas: pdf.js e SheetJS
├─ data/input/               # arquivos do dia (NÃO versionados — contêm dados reais)
├─ dist/                     # artefatos gerados (NÃO versionados — reproduzíveis)
├─ tests/                    # testes de navegador (jsdom) e checagem de sintaxe
├─ requirements.txt
└─ README.md
```

| Arquivo | Papel |
| --- | --- |
| `src/mapa_dados.py` | Núcleo Python: leitura da LX02, parsing do coletor (PDF consolidado e TXT) e cruzamento |
| `src/mapa_core.js` | Núcleo JS (espelho do Python): processa os arquivos do upload no navegador |
| `src/gerar_mapa_html.py` | Gera o `MAPA_EXP.html` (sem args: tela de upload; com args: injeta dados + libs) |
| `src/web/mapa_template.html` | Tela (HTML + CSS + JS): upload, planta, filtros, tema |
| `src/web/vendor/` | Libs embutidas no HTML: `pdf.min.js`, `pdf.worker.min.js` (pdf.js) e `xlsx.full.min.js` (SheetJS) |
| `src/gerar_demo_publico.py` | Gera o `MAPA_EXP_LINKEDIN.html` com dados fictícios (sem dados reais) |
| `src/gerar_mapa_exp.py` | Gera o relatório `MAPA_EXP_FINAL.xlsx` |
| `data/input/coletor_teste.txt` / `coletor_teste_zeros.txt` | Exemplos de leitura do coletor (TXT) |
| `data/input/coletor_demo.txt` | Cenário apresentável para o vídeo (6 filas × 18 posições) |
| `data/input/LX02-1.xlsx` / `lx02.xlsx` | Exemplo de exportação da LX02 |
| `data/input/filas.pdf` | Exemplo de PDF consolidado da bipagem |
| `dist/MAPA_EXP_DEMO.html` | Cenário de demonstração (gerado) |
| `dist/MAPA_EXP_LINKEDIN.html` | Versão pública fictícia para divulgação (gerada) |

## Testes

Os testes abrem os HTMLs de `dist/` num DOM (via **jsdom**) e verificam o render do mapa, a marcação de **coletado** e a persistência, além do app em branco. Gere os artefatos antes:

```powershell
python src/gerar_mapa_html.py
python src/gerar_mapa_html.py coletor_demo.txt MAPA_EXP_DEMO.html
python src/gerar_demo_publico.py
cd tests; npm install; npm test
```

Checagem de sintaxe do app embutido no HTML (`node --check`):

```powershell
python tests/check_app.py
```

## Formato do TXT do coletor

```text
FILA 1
1000000001
1000000002
0                 # marca uma posição vazia (caso sem pallets)
FILA 2
...
```

Regras: cada posição recebe até **2 pallets** (empilhamento); a linha `0` avança a posição marcando-a como vazia quando não houve pallet; `FILA N` reinicia a posição em 1.

## Formato do PDF consolidado (Stock Count)

O PDF da bipagem traz uma seção por fila, aberta pelo título `FILA N`:

```text
FILA 1
# Name Barcode Qty Added At
1 1000000001 1000000001 1 17.10.202609:46
...
47 12v 12v 1 17.10.202609:42
...
TOTAL 67
```

Regras de leitura:

- O PDF lista os registros **do mais recente para o mais antigo**; cada seção é
  invertida para recuperar a ordem física (posição 1 primeiro).
- **Posição vazia**: um número curto (`1`, `2`, `3`, …). O formato antigo com
  sufixo `v` (`1v`, `12v`) também é aceito. Cada token marca **1 posição vazia**.
- **Posição com 1 pallet**: a mesma UD bipada 2x aparece como `Qty=2` → conta
  como **1 pallet** e avança.
- **Posição com 2 pallets**: duas UDs diferentes, uma bipada cada.
- A UD do SAP tem sempre **10 dígitos** (ajustável em `UD_COMPRIMENTO`).

Também é possível usar **vários PDFs** (um por fila), identificando a fila pelo
nome do arquivo (`FILA 2`, `INVENTARIO_3`, …) quando não houver título.

## Storyboard do vídeo (demo)

| # | Cena | Duração |
| --- | --- | --- |
| 1 | Contexto: `LX02-1.xlsx` + `coletor_demo.txt` em `data/input/` | 5s |
| 2 | Terminal: `python src/gerar_mapa_html.py coletor_demo.txt MAPA_EXP_DEMO.html` | 5s |
| 3 | Abrir `dist/MAPA_EXP_DEMO.html` no celular e mostrar a planta + resumo | 10s |
| 4 | Buscar um material → Aplicar → posições destacadas em cor | 15s |
| 5 | Filtro de lotes → desmarcar um lote → posições atenuam | 15s |
| 6 | Tocar uma posição → detalhes (descrição, código, lote) | 10s |
| 7 | Modo escuro | 10s |
| 8 | Fecho: resumo de números no rodapé | 10s |

## Observações técnicas

- O zoom usa a propriedade CSS `zoom` (Chrome/Edge/Safari).
- No desktop (`≥ 1024px`) a tela fica em duas colunas: mapa à esquerda e painel lateral à direita, com o mapa enquadrado automaticamente para não cortar nenhuma fila; a lista de materiais rola dentro do próprio painel.
- No celular (`< 1024px`) o mapa ocupa a área principal (com altura calculada por variáveis CSS medidas em JS) e tem **rolagem própria**, com barra visível, tanto na vertical quanto na horizontal; o cabeçalho é fixo (`sticky`) e **compacto** (título + botões numa linha; busca + Aplicar na mesma linha), para sobrar mais tela para o mapa. Abaixo do mapa ficam a lista de materiais e, por último, os avisos.
- O `manifest` do PWA é gerado em memória (Blob). Abrindo o arquivo via `file://`, o navegador pode não oferecer a instalação; ao publicar em um servidor, o recurso habilita.
- O HTML embute as libs **pdf.js** e **SheetJS** (via `src/web/vendor/`) e, quando gerado com dados, também o conteúdo — por isso o arquivo tem ~2,6 MB. Funciona **offline** depois de aberto, e a leitura de PDF no upload usa o worker embutido (Blob), sem depender de CDN.
- O `src/gerar_mapa_html.py` monta o HTML a partir de `src/web/mapa_template.html`, substituindo os placeholders `__DADOS_MAPA__`, `/*__MAPA_CORE__*/`, `/*__LIB_PDFJS__*/`, `/*__LIB_XLSX__*/` e `__PDF_WORKER_B64__`.
- Os scripts ancoram os caminhos na própria localização (`__file__`), então rodam de qualquer diretório: entram por `data/input/` e saem em `dist/`. Os arquivos de `data/input/` e `dist/` **não vão para o Git** (dados reais e artefatos reproduzíveis).
