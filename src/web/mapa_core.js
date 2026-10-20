/*
 * Núcleo do Mapa EXP (JavaScript) — espelha mapa_dados.py.
 *
 * Lê a LX02 (.xlsx, via SheetJS), o coletor (PDF consolidado via PDF.js ou
 * TXT) e o cruzamento pela UD, produzindo o mesmo payload que a tela consome.
 * Foi escrito para rodar tanto no navegador quanto no Node (para testes):
 * no fim, exporta em `module.exports` quando existir.
 */
(function (global) {
  'use strict';

  var UD_COMPRIMENTO = 10;
  var MAX_FILA_ESPERADA = 6;
  // Comprimento do estante (nº de posições por fila). 0 = automático: usa a
  // fila com mais posições do dia e completa as demais com posições vazias.
  var MAX_POSICOES_POR_FILA = 0;

  // --- Padrões (espelham mapa_dados.py) ---
  var PADRAO_FILA = /^FILA\s+(\d+)$/;
  var PADRAO_TITULO_SECAO = /^(?:FILA|INVENTARIO)\s*(\d+)$/;
  var PADRAO_ITEM_PDF = /^\s*\d+\s+(\S+)\s+(\S+)\s+(\d+)(?=\s|$)/;
  var PADRAO_NUM_FILA_ARQ = /(?:FILA|INVENTARIO)[\s_-]*(\d+)/i;
  var PADRAO_UD = /^\d{10}$/;
  var PADRAO_VAZIO = /^(?:\d{1,9}|\d+[vV])$/;

  // Colunas canônicas da LX02 e apelidos aceitos (ordem importa)
  var COLUNAS_LX02 = [
    'Unidade de depósito',
    'Material',
    'Texto breve de material',
    'Lote',
    'Estoque total',
    'UMB',
    'Data EM',
    'Data venc.',
  ];

  var APELIDOS_LX02 = {
    'Unidade de depósito': ['Unidade de depósito'],
    'Material': ['Material'],
    'Texto breve de material': ['Texto breve de material'],
    'Lote': ['Lote'],
    'Estoque total': ['Estoque total'],
    'UMB': ['UMB', 'UM básica'],
    'Data EM': ['Data EM', 'Data da entrada de mercadorias'],
    'Data venc.': ['Data venc.', 'Data do vencimento'],
  };

  var COLUNAS_FISICO = ['UD_chave', 'Fila', 'Posicao', 'Empilhamento'];
  var COLUNAS_SAIDA = ['Fila', 'Posicao', 'Empilhamento'].concat(COLUNAS_LX02);

  // --- Utilidades de texto ---
  function normalizarTexto(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .replace(/\uFFFD/g, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function chaveColuna(nome) {
    return normalizarTexto(nome).trim().toLowerCase();
  }

  function formatarData(data) {
    var ano = data.getFullYear();
    var mes = String(data.getMonth() + 1).padStart(2, '0');
    var dia = String(data.getDate()).padStart(2, '0');
    return ano + '-' + mes + '-' + dia;
  }

  function vazio(valor) {
    return valor === null || valor === undefined || valor === '';
  }

  function texto(valor) {
    if (vazio(valor)) return null;
    if (valor instanceof Date) return formatarData(valor);
    if (typeof valor === 'number') {
      return Number.isInteger(valor) ? String(valor) : String(valor);
    }
    return String(valor).trim();
  }

  function numero(valor) {
    if (vazio(valor)) return null;
    var n = Number(valor);
    return Number.isNaN(n) ? null : n;
  }

  // --- Leitura da LX02 (SheetJS) ---
  function carregarLx02(arrayBuffer) {
    var XLSX = global.XLSX;
    if (!XLSX) throw new Error('Biblioteca SheetJS (XLSX) não disponível.');

    var dados = new Uint8Array(arrayBuffer);
    var livro = XLSX.read(dados, { type: 'array', cellDates: true });
    var aba = livro.Sheets[livro.SheetNames[0]];
    if (!aba) throw new Error('Planilha vazia ou sem abas.');

    var linhas = XLSX.utils.sheet_to_json(aba, { header: 1, raw: true, defval: null });
    if (!linhas.length) throw new Error('Planilha vazia.');

    var cabecalho = linhas[0];
    var porChave = {};
    for (var c = 0; c < cabecalho.length; c++) {
      porChave[chaveColuna(cabecalho[c])] = c;
    }

    var indice = {};
    var faltando = [];
    for (var k = 0; k < COLUNAS_LX02.length; k++) {
      var canonico = COLUNAS_LX02[k];
      var apelidos = APELIDOS_LX02[canonico];
      var achou = -1;
      for (var a = 0; a < apelidos.length; a++) {
        var pos = porChave[chaveColuna(apelidos[a])];
        if (pos !== undefined) { achou = pos; break; }
      }
      if (achou === -1) faltando.push(canonico);
      else indice[canonico] = achou;
    }
    if (faltando.length) {
      throw new Error(
        'A exportação não contém as colunas: ' + faltando.join(', ') +
        '. Colunas encontradas: ' + cabecalho.map(String).join(', ')
      );
    }

    var registros = [];
    for (var i = 1; i < linhas.length; i++) {
      var linha = linhas[i];
      var ud = linha[indice['Unidade de depósito']];
      if (vazio(ud)) continue;
      var reg = { UD_chave: String(ud).trim() };
      for (var j = 0; j < COLUNAS_LX02.length; j++) {
        reg[COLUNAS_LX02[j]] = linha[indice[COLUNAS_LX02[j]]];
      }
      registros.push(reg);
    }
    return registros;
  }

  // --- Coletor: motor de tokens (comum ao TXT e ao PDF) ---
  function motorTokens(seq, fila, ctx, aceitarTerminador) {
    var problemas = ctx.problemas;
    var alertas = ctx.alertas;
    var posicoesVazias = ctx.posicoes_vazias;
    var udsVistas = ctx.uds_vistas;

    var registros = [];
    var posicao = 1;
    var pallets = [];

    for (var t = 0; t < seq.length; t++) {
      var tipo = seq[t][0];
      var valor = seq[t][1];
      var qty = seq[t][2];

      if (tipo === 'V') {
        if (!pallets.length) {
          for (var v = 0; v < qty; v++) {
            posicoesVazias.push({ fila: fila, posicao: posicao });
            posicao += 1;
          }
        } else {
          posicao += 1;
        }
        pallets = [];
        continue;
      }

      if (tipo === '?') {
        problemas.push({
          tipo: 'registro_desconhecido', fila: fila, posicao: posicao,
          mensagem: 'Registro desconhecido (Fila ' + fila + ', posição ' +
            posicao + ') -> "' + valor + '"',
        });
        continue;
      }

      // tipo === 'U'
      if (aceitarTerminador && qty >= 2) {
        if (qty > 2) {
          problemas.push({
            tipo: 'qty_inesperada', fila: fila, posicao: posicao,
            mensagem: 'UD ' + valor + ' com Qty=' + qty + ' (Fila ' + fila +
              ', posição ' + posicao + '); tratada como 1 pallet',
          });
        }
        if (udsVistas.has(valor)) {
          problemas.push({
            tipo: 'ud_repetida', ud: valor, fila: fila, posicao: posicao,
            mensagem: 'UD ' + valor + ' repetida (Fila ' + fila +
              ', posição ' + posicao + ')',
          });
        } else {
          udsVistas.add(valor);
          registros.push({
            UD_chave: valor, Fila: fila, Posicao: posicao, Empilhamento: 1,
          });
        }
        posicao += 1;
        pallets = [];
        continue;
      }

      for (var n = 0; n < qty; n++) {
        if (udsVistas.has(valor)) {
          problemas.push({
            tipo: 'ud_repetida', ud: valor, fila: fila, posicao: posicao,
            mensagem: 'UD ' + valor + ' repetida (Fila ' + fila +
              ', posição ' + posicao + ')',
          });
          continue;
        }
        udsVistas.add(valor);
        pallets.push(valor);
        registros.push({
          UD_chave: valor, Fila: fila, Posicao: posicao,
          Empilhamento: pallets.length,
        });
        if (pallets.length === 2) {
          posicao += 1;
          pallets = [];
        }
      }
    }

    if (pallets.length === 1) {
      alertas.push({
        fila: fila, posicao: posicao,
        mensagem: 'Última posição (Fila ' + fila + ', Posição ' + posicao +
          ') ficou com apenas 1 pallet',
      });
    }
    return registros;
  }

  // --- Coletor: TXT ---
  function processarTxt(textoArquivo, nome) {
    var problemas = [];
    var alertas = [];
    var posicoesVazias = [];
    var udsVistas = new Set();
    var marcouFila = false;

    var filaAtual = 1;
    var tokensPorFila = {};
    var linhas = String(textoArquivo).split(/\r\n|\r|\n/);

    for (var i = 0; i < linhas.length; i++) {
      var numero = i + 1;
      var limpa = linhas[i].trim().toUpperCase();
      if (!limpa) continue;

      if (limpa.indexOf('FILA') === 0) {
        var encontrou = PADRAO_FILA.exec(limpa);
        if (!encontrou) {
          problemas.push({
            tipo: 'marcador_fila_invalido', fila: filaAtual, posicao: 1,
            mensagem: 'Linha ' + numero + ': marcador de fila inválido -> "' +
              linhas[i].trim() + '"',
          });
          continue;
        }
        filaAtual = parseInt(encontrou[1], 10);
        if (filaAtual > MAX_FILA_ESPERADA) {
          alertas.push({
            fila: filaAtual, posicao: 1,
            mensagem: 'Linha ' + numero + ': FILA ' + filaAtual +
              ' acima do esperado (a EXP tem aproximadamente ' +
              MAX_FILA_ESPERADA + ' filas)',
          });
        }
        marcouFila = true;
        continue;
      }

      if (limpa === '0') {
        if (!tokensPorFila[filaAtual]) tokensPorFila[filaAtual] = [];
        tokensPorFila[filaAtual].push(['V', '0', 1]);
        continue;
      }

      if (!/^\d+$/.test(limpa)) {
        problemas.push({
          tipo: 'registro_desconhecido', fila: filaAtual, posicao: 1,
          mensagem: 'Linha ' + numero + ': registro desconhecido -> "' +
            linhas[i].trim() + '"',
        });
        continue;
      }

      if (!tokensPorFila[filaAtual]) tokensPorFila[filaAtual] = [];
      tokensPorFila[filaAtual].push(['U', limpa, 1]);
    }

    var registros = [];
    var ctxTxt = {
      problemas: problemas, alertas: alertas,
      posicoes_vazias: posicoesVazias, uds_vistas: udsVistas,
    };
    var filasOrdenadas = Object.keys(tokensPorFila).map(Number).sort(function (a, b) {
      return a - b;
    });
    for (var f = 0; f < filasOrdenadas.length; f++) {
      var fila = filasOrdenadas[f];
      var parte = motorTokens(tokensPorFila[fila], fila, ctxTxt, false);
      for (var r = 0; r < parte.length; r++) registros.push(parte[r]);
    }

    if (!marcouFila && registros.length) {
      alertas.push({
        mensagem: 'Nenhum marcador FILA encontrado no arquivo: todas as ' +
          registros.length + ' UDs foram classificadas na Fila 1',
      });
    }
    if (!registros.length && !problemas.length) {
      problemas.push({
        tipo: 'sem_uds',
        mensagem: 'Nenhuma UD encontrada em "' + (nome || 'arquivo') + '"',
      });
    }
    return {
      registros: registros, posicoes_vazias: posicoesVazias,
      problemas: problemas, alertas: alertas,
    };
  }

  // --- Coletor: PDF consolidado ---
  function identificarFilaPdf(nomeArquivo, tituloPdf) {
    var nome = normalizarTexto(nomeArquivo || '').toUpperCase();
    var encontrou = PADRAO_NUM_FILA_ARQ.exec(nome);
    if (encontrou) return parseInt(encontrou[1], 10);
    if (tituloPdf) {
      var limpo = normalizarTexto(tituloPdf).trim().toUpperCase();
      encontrou = PADRAO_TITULO_SECAO.exec(limpo);
      if (encontrou) return parseInt(encontrou[1], 10);
    }
    return 1;
  }

  // Reconstrói linhas de texto a partir dos itens do PDF.js (agrupando por Y).
  // `itens` = [{ str, transform:[a,b,c,d,e,f], width, hasEOL }]
  function linhasDeItens(itens, tolerancia) {
    var tol = tolerancia || 3;
    var itensUteis = [];
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (!it || it.str === undefined || it.str === null) continue;
      if (!String(it.str).trim()) continue;
      var t = it.transform || [0, 0, 0, 0, 0, 0];
      itensUteis.push({ x: t[4] || 0, y: t[5] || 0, s: String(it.str) });
    }
    itensUteis.sort(function (a, b) { return b.y - a.y; });

    var linhas = [];
    var atual = null;
    for (var g = 0; g < itensUteis.length; g++) {
      var item = itensUteis[g];
      if (!atual || Math.abs(item.y - atual.y) > tol) {
        atual = { y: item.y, itens: [] };
        linhas.push(atual);
      }
      atual.itens.push(item);
    }
    return linhas.map(function (linha) {
      linha.itens.sort(function (a, b) { return a.x - b.x; });
      return linha.itens.map(function (it) { return it.s; }).join(' ');
    });
  }

  function secoesDeLinhas(linhas) {
    var secoes = [];
    var atual = null;
    for (var i = 0; i < linhas.length; i++) {
      var limpa = String(linhas[i]).trim();
      if (!limpa) continue;

      var titulo = normalizarTexto(limpa).trim().toUpperCase();
      var encontrou = PADRAO_TITULO_SECAO.exec(titulo);
      if (encontrou) {
        atual = { fila: parseInt(encontrou[1], 10), itens: [] };
        secoes.push(atual);
        continue;
      }

      if (limpa.charAt(0) === '#') continue;

      var item = PADRAO_ITEM_PDF.exec(String(linhas[i]));
      if (item) {
        if (atual === null) {
          atual = { fila: null, itens: [] };
          secoes.push(atual);
        }
        atual.itens.push([item[1].trim(), parseInt(item[3], 10)]);
      }
    }
    return secoes;
  }

  function itensParaTokens(itens) {    var tokens = [];
    for (var i = itens.length - 1; i >= 0; i--) {
      var valor = String(itens[i][0]).trim();
      var qty = Math.max(1, parseInt(itens[i][1], 10) || 1);
      if (PADRAO_UD.test(valor)) tokens.push(['U', valor, qty]);
      else if (PADRAO_VAZIO.test(valor)) tokens.push(['V', valor, qty]);
      else tokens.push(['?', valor, 1]);
    }
    return tokens;
  }

  // arquivos: [{ nome, linhas }]
  function processarPdf(arquivos) {
    var problemas = [];
    var alertas = [];
    var posicoesVazias = [];
    var udsVistas = new Set();
    var registros = [];
    var tokensPorFila = {};

    for (var a = 0; a < arquivos.length; a++) {
      var arq = arquivos[a];
      var secoes = secoesDeLinhas(arq.linhas);
      if (!secoes.length) {
        problemas.push({
          tipo: 'pdf_sem_itens',
          mensagem: 'Nenhum item encontrado em "' + arq.nome + '"',
        });
        continue;
      }
      var filaArquivo = identificarFilaPdf(arq.nome, '');
      for (var s = 0; s < secoes.length; s++) {
        var secao = secoes[s];
        var fila = secao.fila === null ? filaArquivo : secao.fila;
        if (!tokensPorFila[fila]) tokensPorFila[fila] = [];
        var toks = itensParaTokens(secao.itens);
        for (var t = 0; t < toks.length; t++) tokensPorFila[fila].push(toks[t]);
      }
    }

    var ctxPdf = {
      problemas: problemas, alertas: alertas,
      posicoes_vazias: posicoesVazias, uds_vistas: udsVistas,
    };
    var filasOrdenadas = Object.keys(tokensPorFila).map(Number).sort(function (x, y) {
      return x - y;
    });
    for (var f = 0; f < filasOrdenadas.length; f++) {
      var parte = motorTokens(tokensPorFila[filasOrdenadas[f]], filasOrdenadas[f], ctxPdf, true);
      for (var r = 0; r < parte.length; r++) registros.push(parte[r]);
    }

    if (!registros.length && !problemas.length) {
      problemas.push({ tipo: 'sem_uds', mensagem: 'Nenhuma UD encontrada nos PDFs' });
    }
    return {
      registros: registros, posicoes_vazias: posicoesVazias,
      problemas: problemas, alertas: alertas,
    };
  }

  // --- Cruzamento e montagem da estrutura da tela ---
  function estruturarFilas(dfMapa, posicoesVazias, problemas) {
    var udsProblema = new Set();
    for (var i = 0; i < problemas.length; i++) {
      var tipo = problemas[i].tipo;
      if (tipo === 'ud_ausente_lx02' || tipo === 'ud_duplicada_lx02') {
        var uds = problemas[i].uds || [];
        for (var u = 0; u < uds.length; u++) udsProblema.add(uds[u]);
      }
    }

    var posicoes = {};
    function pegarPosicao(fila, posicao) {
      var chave = fila + '|' + posicao;
      if (!posicoes[chave]) {
        posicoes[chave] = { fila: fila, posicao: posicao, estado: 'ocupada', pallets: [] };
      }
      return posicoes[chave];
    }

    if (dfMapa) {
      for (var l = 0; l < dfMapa.length; l++) {
        var linha = dfMapa[l];
        var fila = parseInt(linha.Fila, 10);
        var posicao = parseInt(linha.Posicao, 10);
        var ud = String(linha.UD_chave);
        var material = texto(linha['Material']);
        var pallet = {
          ud: ud,
          empilhamento: parseInt(linha.Empilhamento, 10),
          material: material,
          descricao: texto(linha['Texto breve de material']),
          lote: texto(linha['Lote']),
          estoque: numero(linha['Estoque total']),
          umb: texto(linha['UMB']),
          data_em: texto(linha['Data EM']),
          data_venc: texto(linha['Data venc.']),
          inconsistente: udsProblema.has(ud) || material === null,
        };
        pegarPosicao(fila, posicao).pallets.push(pallet);
      }
    }

    for (var p = 0; p < posicoesVazias.length; p++) {
      var item = posicoesVazias[p];
      var pos = pegarPosicao(item.fila, item.posicao);
      if (!pos.pallets.length) pos.estado = 'vazia';
    }

    var porFila = {};
    var chaves = Object.keys(posicoes);
    for (var c = 0; c < chaves.length; c++) {
      var posObj = posicoes[chaves[c]];
      if (posObj.pallets.length) {
        posObj.estado = posObj.pallets.some(function (pal) { return pal.inconsistente; })
          ? 'inconsistente' : 'ocupada';
        posObj.pallets.sort(function (x, y) { return x.empilhamento - y.empilhamento; });
      } else {
        posObj.estado = 'vazia';
      }
      if (!porFila[posObj.fila]) porFila[posObj.fila] = [];
      porFila[posObj.fila].push(posObj);
    }

    var filas = [];
    var numeros = Object.keys(porFila).map(Number).sort(function (a, b) { return a - b; });
    for (var n = 0; n < numeros.length; n++) {
      var lista = porFila[numeros[n]].sort(function (a, b) { return a.posicao - b.posicao; });
      filas.push({ fila: numeros[n], posicoes: lista });
    }
    return completarEstante(filas);
  }

  // Iguala todas as filas ao comprimento do estante (espelha _completar_estante).
  function completarEstante(filas) {
    if (!filas.length) return filas;
    var maxPosicoes = MAX_POSICOES_POR_FILA;
    if (!maxPosicoes) {
      for (var f = 0; f < filas.length; f++) {
        var lista = filas[f].posicoes;
        if (lista.length) {
          maxPosicoes = Math.max(maxPosicoes, lista[lista.length - 1].posicao);
        }
      }
    }
    if (!maxPosicoes || maxPosicoes <= 0) return filas;
    for (var g = 0; g < filas.length; g++) {
      var fila = filas[g];
      var existentes = {};
      for (var p = 0; p < fila.posicoes.length; p++) {
        existentes[fila.posicoes[p].posicao] = true;
      }
      for (var numero = 1; numero <= maxPosicoes; numero++) {
        if (!existentes[numero]) {
          fila.posicoes.push({
            fila: fila.fila, posicao: numero, estado: 'vazia', pallets: [],
          });
        }
      }
      fila.posicoes.sort(function (a, b) { return a.posicao - b.posicao; });
    }
    return filas;
  }

  function montarPayload(coletor, lx02, arquivos) {
    var problemas = coletor.problemas.slice();
    var alertas = coletor.alertas.slice();
    var registros = coletor.registros;
    var posicoesVazias = coletor.posicoes_vazias;

    // Índice da LX02 pela UD e posições físicas por UD (erros clicáveis)
    var sapPorUd = {};
    var udsSap = [];
    var contagem = {};
    if (lx02) {
      for (var i = 0; i < lx02.length; i++) {
        var ud = lx02[i].UD_chave;
        if (!sapPorUd[ud]) sapPorUd[ud] = lx02[i];
        contagem[ud] = (contagem[ud] || 0) + 1;
        udsSap.push(ud);
      }
    }
    var duplicadas = Object.keys(contagem).filter(function (k) { return contagem[k] > 1; });

    var posicoesPorUd = {};
    for (var r = 0; r < registros.length; r++) {
      var reg = registros[r];
      if (!posicoesPorUd[reg.UD_chave]) posicoesPorUd[reg.UD_chave] = [];
      posicoesPorUd[reg.UD_chave].push({ fila: reg.Fila, posicao: reg.Posicao });
    }

    function posicao(ud) {
      var lista = posicoesPorUd[ud];
      return lista && lista.length ? lista[0] : {};
    }

    // UDs da LX02 que não aparecem na bipagem: candidatas a serem
    // adicionadas manualmente na tela. Agrupadas por material -> lotes.
    var lx02Livres = montarLx02Livres(sapPorUd, posicoesPorUd);

    if (duplicadas.length) {
      var dupl = duplicadas.slice().sort();
      var pd = posicao(dupl[0]);
      problemas.push({
        tipo: 'ud_duplicada_lx02', uds: dupl, fila: pd.fila, posicao: pd.posicao,
        mensagem: 'UDs duplicadas na LX02 (' + dupl.length + '): ' + dupl.join(', '),
      });
    }

    if (lx02) {
      var ausentes = [];
      for (var a = 0; a < registros.length; a++) {
        var valor = registros[a].UD_chave;
        if (!sapPorUd[valor] && ausentes.indexOf(valor) === -1) ausentes.push(valor);
      }
      ausentes.sort();
      if (ausentes.length) {
        var pa = posicao(ausentes[0]);
        problemas.push({
          tipo: 'ud_ausente_lx02', uds: ausentes, fila: pa.fila, posicao: pa.posicao,
          mensagem: 'UDs do coletor não encontradas na LX02 (' + ausentes.length +
            '): ' + ausentes.join(', '),
        });
      }
    }

    var dfMapa = registros.map(function (reg) {
      var sap = sapPorUd[reg.UD_chave] || {};
      var linha = {
        UD_chave: reg.UD_chave, Fila: reg.Fila, Posicao: reg.Posicao,
        Empilhamento: reg.Empilhamento,
      };
      for (var k = 0; k < COLUNAS_LX02.length; k++) {
        var col = COLUNAS_LX02[k];
        linha[col] = sap[col] === undefined ? null : sap[col];
      }
      return linha;
    });

    if (lx02 && dfMapa.length !== registros.length) {
      problemas.push({
        tipo: 'linhas_divergentes',
        mensagem: 'A quantidade de linhas mudou durante o cruzamento. Antes: ' +
          registros.length + ' | Depois: ' + dfMapa.length,
      });
    }

    return {
      arquivos: arquivos,
      filas: estruturarFilas(dfMapa, posicoesVazias, problemas),
      problemas: problemas,
      alertas: alertas,
      lx02_livres: lx02Livres,
    };
  }

  // Monta a lista de materiais da LX02 ainda sem posição na bipagem,
  // no formato consumido pelo seletor da tela:
  //   [{ material, descricao, lotes: [{ lote, pallets }] }]
  function montarLx02Livres(sapPorUd, posicoesPorUd) {
    var porMaterial = {};
    var ordem = [];
    var uds = Object.keys(sapPorUd);
    for (var i = 0; i < uds.length; i++) {
      var ud = uds[i];
      if (posicoesPorUd[ud] && posicoesPorUd[ud].length) continue;
      var sap = sapPorUd[ud];
      var material = texto(sap['Material']);
      if (material === null) continue;
      var descricao = texto(sap['Texto breve de material']);
      if (!porMaterial[material]) {
        porMaterial[material] = { material: material, descricao: descricao, lotes: {} };
        ordem.push(material);
      } else if (!porMaterial[material].descricao) {
        porMaterial[material].descricao = descricao;
      }
      var lote = texto(sap['Lote']);
      var chave = lote === null ? '' : String(lote);
      porMaterial[material].lotes[chave] = (porMaterial[material].lotes[chave] || 0) + 1;
    }
    var livres = [];
    for (var m = 0; m < ordem.length; m++) {
      var info = porMaterial[ordem[m]];
      var lotes = Object.keys(info.lotes).map(function (chave) {
        return { lote: chave, pallets: info.lotes[chave] };
      });
      livres.push({ material: info.material, descricao: info.descricao, lotes: lotes });
    }
    return livres;
  }

  var MapaCore = {
    UD_COMPRIMENTO: UD_COMPRIMENTO,
    MAX_FILA_ESPERADA: MAX_FILA_ESPERADA,
    MAX_POSICOES_POR_FILA: MAX_POSICOES_POR_FILA,
    COLUNAS_LX02: COLUNAS_LX02,
    COLUNAS_FISICO: COLUNAS_FISICO,
    COLUNAS_SAIDA: COLUNAS_SAIDA,
    normalizarTexto: normalizarTexto,
    carregarLx02: carregarLx02,
    identificarFilaPdf: identificarFilaPdf,
    linhasDeItens: linhasDeItens,
    secoesDeLinhas: secoesDeLinhas,
    itensParaTokens: itensParaTokens,
    motorTokens: motorTokens,
    processarTxt: processarTxt,
    processarPdf: processarPdf,
    estruturarFilas: estruturarFilas,
    montarPayload: montarPayload,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapaCore;
  }
  global.MapaCore = MapaCore;
})(typeof self !== 'undefined' ? self : this);
