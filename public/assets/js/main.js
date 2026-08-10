/**
 * NEXO WEB — comportamento e animações.
 *
 * Sem dependências. Sem eval, sem innerHTML, sem handler inline.
 * O número de WhatsApp vem de assets/js/config.js — não é repetido aqui.
 *
 * Ordem: o que é navegação liga na hora; o que é animação só começa depois
 * que o loader sai de cena, para a entrada do Hero ser realmente vista.
 */
(function () {
  'use strict';

  var CFG = window.NEXO || {};
  var WA = String(CFG.whatsapp || '').replace(/\D/g, '');
  var MSGS = CFG.mensagens || {};
  var reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- utils */

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /** Normaliza texto vindo do usuário antes de virar parte de uma URL. */
  function limpar(texto, max) {
    return String(texto == null ? '' : texto)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 500);
  }

  function linkWhatsApp(mensagem) {
    if (!WA) return '';
    var base = 'https://wa.me/' + WA;
    return mensagem ? base + '?text=' + encodeURIComponent(mensagem) : base;
  }

  /* ------------------------------------------------- links de WhatsApp */

  $$('[data-wa]').forEach(function (el) {
    var chave = el.getAttribute('data-wa');
    var msg = MSGS[chave] || MSGS.padrao || '';
    var href = linkWhatsApp(msg);
    if (!href) return;
    el.setAttribute('href', href);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  });

  $$('[data-wa-display]').forEach(function (el) {
    if (CFG.whatsappDisplay) el.textContent = CFG.whatsappDisplay;
  });

  /* ------------------------------------------------- trava de rolagem */

  var travas = 0;

  function travarRolagem() {
    if (travas++ > 0) return;
    var barra = window.innerWidth - document.documentElement.clientWidth;
    if (barra > 0) document.body.style.setProperty('padding-right', barra + 'px');
    document.body.classList.add('is-locked');
  }

  function destravarRolagem() {
    if (--travas > 0) return;
    travas = 0;
    document.body.classList.remove('is-locked');
    document.body.style.removeProperty('padding-right');
  }

  /** Mantém o Tab dentro de um container enquanto ele estiver aberto. */
  function prenderFoco(container, evento) {
    if (evento.key !== 'Tab' || !container) return;
    var focaveis = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', container)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    if (!focaveis.length) return;

    var primeiro = focaveis[0];
    var ultimo = focaveis[focaveis.length - 1];

    if (evento.shiftKey && document.activeElement === primeiro) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  /* ------------------------------------------------------------ header */

  var header = $('#header');
  var ticking = false;

  function aoRolar() {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(aoRolar);
  }, { passive: true });

  aoRolar();

  /* ------------------------------------------------------ menu mobile */

  var nav = $('#menu-principal');
  var botaoMenu = $('.nav-toggle');
  var scrim = $('.nav-scrim');

  function menuAberto() { return nav && nav.classList.contains('is-open'); }

  function abrirMenu() {
    if (!nav || menuAberto()) return;
    nav.classList.add('is-open');
    botaoMenu.setAttribute('aria-expanded', 'true');
    botaoMenu.setAttribute('aria-label', 'Fechar menu de navegação');
    if (scrim) { scrim.hidden = false; window.requestAnimationFrame(function () { scrim.classList.add('is-open'); }); }
    travarRolagem();
  }

  function fecharMenu(devolverFoco) {
    if (!nav || !menuAberto()) return;
    nav.classList.remove('is-open');
    botaoMenu.setAttribute('aria-expanded', 'false');
    botaoMenu.setAttribute('aria-label', 'Abrir menu de navegação');
    if (scrim) {
      scrim.classList.remove('is-open');
      window.setTimeout(function () { scrim.hidden = true; }, reduzirMovimento ? 0 : 260);
    }
    destravarRolagem();
    if (devolverFoco && botaoMenu) botaoMenu.focus();
  }

  if (botaoMenu) {
    botaoMenu.addEventListener('click', function () {
      menuAberto() ? fecharMenu(false) : abrirMenu();
    });
  }
  if (scrim) scrim.addEventListener('click', function () { fecharMenu(false); });

  $$('#menu-principal a').forEach(function (a) {
    a.addEventListener('click', function () { fecharMenu(false); });
  });

  // O painel só existe abaixo de 1024px; ao passar para desktop, some com ele.
  window.matchMedia('(min-width: 1024px)').addEventListener('change', function (e) {
    if (e.matches) fecharMenu(false);
  });

  /* ------------------------------------------------------- scroll spy */

  // Seções sem item próprio no menu herdam o item mais próximo acima delas.
  var mapaSecoes = {
    inicio: 'inicio',
    servicos: 'servicos',
    processo: 'servicos',
    portfolio: 'portfolio',
    prazos: 'portfolio',
    planos: 'planos',
    diferenciais: 'planos',
    garantia: 'planos',
    duvidas: 'contato',
    contato: 'contato'
  };

  var linksMenu = {};
  $$('.nav-link').forEach(function (a) {
    var id = (a.getAttribute('href') || '').replace('#', '');
    if (id) linksMenu[id] = a;
  });

  function marcarAtivo(idMenu) {
    Object.keys(linksMenu).forEach(function (id) {
      if (id === idMenu) linksMenu[id].setAttribute('aria-current', 'true');
      else linksMenu[id].removeAttribute('aria-current');
    });
  }

  if ('IntersectionObserver' in window) {
    var visiveis = new Set();
    var espiao = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) visiveis.add(entrada.target.id);
        else visiveis.delete(entrada.target.id);
      });

      var ordem = Object.keys(mapaSecoes);
      for (var i = 0; i < ordem.length; i++) {
        if (visiveis.has(ordem[i])) { marcarAtivo(mapaSecoes[ordem[i]]); return; }
      }
    }, { rootMargin: '-45% 0px -50% 0px' });

    Object.keys(mapaSecoes).forEach(function (id) {
      var secao = document.getElementById(id);
      if (secao) espiao.observe(secao);
    });
  }

  /* -------------------------------------------------------- lightbox */

  var lightbox = $('#lightbox');
  var lbImg = $('#lightbox-img');
  var lbTitulo = $('#lightbox-title');
  var lbTag = $('#lightbox-tag');
  var lbFechar = $('.lightbox-close');
  var lbScroll = $('.lightbox-scroll');
  var gatilhoAnterior = null;

  function abrirLightbox(card) {
    if (!lightbox) return;

    var titulo = card.getAttribute('data-title') || '';
    var full = card.getAttribute('data-full') || '';

    lbTitulo.textContent = titulo;
    lbTag.textContent = card.getAttribute('data-tag') || '';
    lbImg.setAttribute('alt', 'Página completa do projeto ' + titulo + '.');

    // A imagem grande só é baixada quando o visitante realmente abre o projeto.
    if (lbImg.getAttribute('src') !== full) lbImg.setAttribute('src', full);

    lightbox.hidden = false;
    travarRolagem();
    if (lbScroll) lbScroll.scrollTop = 0;

    window.requestAnimationFrame(function () {
      lightbox.classList.add('is-open');
      if (lbFechar) lbFechar.focus();
    });
  }

  function fecharLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.classList.remove('is-open');
    window.setTimeout(function () {
      lightbox.hidden = true;
      destravarRolagem();
      if (gatilhoAnterior) { gatilhoAnterior.focus(); gatilhoAnterior = null; }
    }, reduzirMovimento ? 0 : 260);
  }

  $$('.pf-open').forEach(function (botao) {
    botao.addEventListener('click', function () {
      var card = botao.closest('.pf-card');
      if (!card) return;
      gatilhoAnterior = botao;
      abrirLightbox(card);
    });
  });

  $$('[data-lightbox-close]').forEach(function (el) {
    el.addEventListener('click', fecharLightbox);
  });

  /* ------------------------------------------------ teclado (Esc/Tab) */

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (lightbox && !lightbox.hidden) { fecharLightbox(); return; }
      if (menuAberto()) fecharMenu(true);
      return;
    }
    if (lightbox && !lightbox.hidden) { prenderFoco($('.lightbox-panel'), e); return; }
    if (menuAberto()) prenderFoco(nav, e);
  });

  /* ==================================================================
     TEXTO EM CLIP-MASK
     ================================================================== */

  var textosOriginais = new WeakMap();

  function caixaPalavra(texto, indice) {
    var fora = document.createElement('span');
    fora.className = 'palavra';
    fora.style.setProperty('--i', indice);
    var dentro = document.createElement('span');
    dentro.className = 'palavra-i';
    dentro.textContent = texto;
    fora.appendChild(dentro);
    return fora;
  }

  /**
   * Divide em palavras preservando os elementos inline existentes — é o que
   * mantém o <span class="txt-red">à altura</span> vermelho dentro do H1.
   */
  function dividirEmPalavras(el) {
    var indice = 0;

    (function percorrer(no) {
      Array.prototype.slice.call(no.childNodes).forEach(function (filho) {
        if (filho.nodeType === 3) {
          var partes = filho.nodeValue.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          partes.forEach(function (parte) {
            if (!parte) return;
            if (/^\s+$/.test(parte)) frag.appendChild(document.createTextNode(' '));
            else frag.appendChild(caixaPalavra(parte, indice++));
          });
          no.replaceChild(frag, filho);
        } else if (filho.nodeType === 1) {
          percorrer(filho);
        }
      });
    })(el);
  }

  /**
   * StackedLines: mede onde o navegador realmente quebrou as linhas e envolve
   * cada linha numa máscara própria. Só vale para texto puro — títulos com
   * elementos inline caem para a divisão por palavras.
   */
  function dividirEmLinhas(el) {
    var texto = textosOriginais.get(el);
    if (texto === undefined) {
      texto = el.textContent.replace(/\s+/g, ' ').trim();
      textosOriginais.set(el, texto);
    }
    if (!texto) return;

    // 1. marcadores temporários, um por palavra, para medir a quebra real
    var medida = document.createDocumentFragment();
    var marcas = [];
    var palavras = texto.split(' ');

    palavras.forEach(function (palavra, i) {
      var s = document.createElement('span');
      s.textContent = palavra;
      s.style.setProperty('display', 'inline-block');
      medida.appendChild(s);
      marcas.push(s);
      if (i < palavras.length - 1) medida.appendChild(document.createTextNode(' '));
    });
    el.replaceChildren(medida);

    // 2. agrupa as palavras por posição vertical
    var linhas = [];
    var topoAtual = null;
    marcas.forEach(function (s) {
      var topo = Math.round(s.offsetTop);
      if (topoAtual === null || Math.abs(topo - topoAtual) > 4) { linhas.push([]); topoAtual = topo; }
      linhas[linhas.length - 1].push(s.textContent);
    });

    // 3. reconstrói com uma máscara por linha
    var resultado = document.createDocumentFragment();
    linhas.forEach(function (grupo, i) {
      var fora = document.createElement('span');
      fora.className = 'linha';
      fora.style.setProperty('--i', i);
      var dentro = document.createElement('span');
      dentro.className = 'linha-i';
      // O espaço final separa uma linha da outra em textContent — sem ele o
      // leitor de tela lê "passarpelo". Não renderiza: espaço no fim colapsa.
      dentro.textContent = grupo.join(' ') + (i < linhas.length - 1 ? ' ' : '');
      fora.appendChild(dentro);
      resultado.appendChild(fora);
    });
    el.replaceChildren(resultado);
  }

  function prepararDivisoes() {
    if (reduzirMovimento) return;

    $$('[data-split]').forEach(function (el) {
      var modo = el.getAttribute('data-split');
      var temInline = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 1; });

      if (modo === 'linhas' && !temInline) dividirEmLinhas(el);
      else dividirEmPalavras(el);
    });
  }

  // A quebra de linha muda com a largura: refaz a divisão depois de redimensionar.
  var larguraAnterior = window.innerWidth;
  var temporizadorResize;

  window.addEventListener('resize', function () {
    if (reduzirMovimento) return;
    if (window.innerWidth === larguraAnterior) return;   // ignora teclado virtual no mobile
    larguraAnterior = window.innerWidth;

    window.clearTimeout(temporizadorResize);
    temporizadorResize = window.setTimeout(function () {
      $$('[data-split="linhas"]').forEach(function (el) {
        if (!textosOriginais.has(el)) return;
        var jaVisivel = el.classList.contains('split-visivel');
        el.classList.remove('split-visivel');
        dividirEmLinhas(el);
        if (jaVisivel) {
          // Já foi vista: volta direto ao estado final, sem repetir a animação.
          void el.offsetWidth;
          el.classList.add('split-visivel');
        }
      });
    }, 180);
  }, { passive: true });

  /* ==================================================================
     ENTRADAS AO ROLAR
     ================================================================== */

  function iniciarReveals() {
    var reveals = $$('.reveal');

    // Escalona os irmãos de um mesmo bloco, para entrarem em cascata.
    var contadores = new Map();
    reveals.forEach(function (el) {
      var pai = el.parentElement;
      var n = contadores.get(pai) || 0;
      contadores.set(pai, n + 1);
      if (n > 0) el.style.setProperty('--i', Math.min(n, 6));
    });

    var divisoes = $$('[data-split]');

    if (!('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('is-in'); });
      divisoes.forEach(function (el) { el.classList.add('split-visivel'); });
      return;
    }

    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (!entrada.isIntersecting) return;
        var el = entrada.target;
        el.classList.add(el.hasAttribute('data-split') ? 'split-visivel' : 'is-in');
        observador.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    reveals.concat(divisoes).forEach(function (el) { observador.observe(el); });
  }

  /* ==================================================================
     ROLAGEM SUAVE — inércia própria, sem biblioteca
     ================================================================== */

  function iniciarRolagemSuave() {
    if (reduzirMovimento) return;
    // Em telas de toque o momentum nativo do sistema é melhor — não mexer.
    if (!window.matchMedia('(pointer: fine)').matches) return;

    var alvo = window.scrollY;
    var atual = alvo;
    var rodando = false;

    function limite() {
      return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }

    /** Deixa o navegador cuidar de containers que rolam por conta própria. */
    function rolaPorDentro(no, delta) {
      while (no && no !== document.body && no !== document.documentElement) {
        if (no.nodeType === 1) {
          var y = getComputedStyle(no).overflowY;
          if ((y === 'auto' || y === 'scroll') && no.scrollHeight > no.clientHeight + 1) {
            if (delta < 0 && no.scrollTop > 0) return true;
            if (delta > 0 && no.scrollTop < no.scrollHeight - no.clientHeight - 1) return true;
          }
        }
        no = no.parentNode;
      }
      return false;
    }

    function passo() {
      var dif = alvo - atual;
      atual += dif * 0.14;
      if (Math.abs(dif) < 0.5) { atual = alvo; rodando = false; }
      window.scrollTo(0, atual);
      if (rodando) window.requestAnimationFrame(passo);
    }

    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || travas > 0) return;                  // zoom, modal ou menu aberto
      if (rolaPorDentro(e.target, e.deltaY)) return;
      e.preventDefault();

      var delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;   // linhas → pixels
      alvo = Math.max(0, Math.min(limite(), alvo + delta));
      if (!rodando) { rodando = true; window.requestAnimationFrame(passo); }
    }, { passive: false });

    // Âncora, teclado ou barra de rolagem: sincroniza para não brigar.
    window.addEventListener('scroll', function () {
      if (!rodando) { alvo = atual = window.scrollY; }
    }, { passive: true });
  }

  /* ==================================================================
     PARALLAX DO HERO
     ================================================================== */

  function iniciarParallax() {
    if (reduzirMovimento) return;
    var visual = $('.hero-visual');
    if (!visual || !window.matchMedia('(min-width: 1024px)').matches) return;

    var pendente = false;

    function atualizar() {
      var y = window.scrollY;
      if (y <= 0) visual.style.removeProperty('transform');
      else if (y < window.innerHeight * 1.3) {
        visual.style.setProperty('transform', 'translate3d(0,' + (y * 0.07).toFixed(1) + 'px,0)');
      }
      pendente = false;
    }

    window.addEventListener('scroll', function () {
      if (pendente) return;
      pendente = true;
      window.requestAnimationFrame(atualizar);
    }, { passive: true });
  }

  /* ==================================================================
     LOADER
     ================================================================== */

  function comecarAnimacoes() {
    document.documentElement.classList.add('pronto');
    prepararDivisoes();
    iniciarReveals();
    iniciarRolagemSuave();
    // O parallax entra depois da animação do Hero, para não disputar o transform.
    window.setTimeout(iniciarParallax, reduzirMovimento ? 0 : 1200);
  }

  function iniciarLoader() {
    var loader = $('#loader');
    var barra = $('#loader-fill');

    if (!loader || !barra || reduzirMovimento) {
      if (loader) loader.classList.add('is-fim');
      comecarAnimacoes();
      return;
    }

    document.body.classList.add('is-carregando');

    var progresso = 0;
    var carregou = false;
    var inicio = Date.now();

    function marcarCarregado() { carregou = true; }

    if (document.readyState === 'complete') marcarCarregado();
    else window.addEventListener('load', marcarCarregado);
    window.setTimeout(marcarCarregado, 2600);   // trava de segurança

    function sair() {
      window.setTimeout(function () {
        loader.classList.add('is-saindo');
        document.body.classList.remove('is-carregando');
        comecarAnimacoes();
        window.setTimeout(function () { loader.classList.add('is-fim'); }, 950);
      }, 200);
    }

    var relogio = window.setInterval(function () {
      var teto = carregou ? 100 : 88;
      progresso = Math.min(teto, progresso + (carregou ? 16 : Math.random() * 7 + 3));
      barra.style.setProperty('width', progresso + '%');

      if (progresso >= 100 && Date.now() - inicio >= 650) {
        window.clearInterval(relogio);
        sair();
      }
    }, 90);
  }

  iniciarLoader();

  /* ==================================================================
     FORMULÁRIO
     ================================================================== */

  var form = $('#form-orcamento');

  if (form) {
    var campoNome = $('#nome');
    var campoTel = $('#telefone');
    var campoTipo = $('#tipo');
    var campoPlano = $('#plano');
    var campoMsg = $('#mensagem');
    var contador = $('#contador');

    var definirErro = function (campo, mensagem) {
      var grupo = campo.closest('.field');
      var alvo = grupo ? $('.field-error', grupo) : null;
      if (grupo) grupo.classList.toggle('has-error', !!mensagem);
      campo.setAttribute('aria-invalid', mensagem ? 'true' : 'false');
      if (alvo) alvo.textContent = mensagem || '';
      return !mensagem;
    };

    var validarNome = function () {
      var v = limpar(campoNome.value, 80);
      if (v.length < 2) return definirErro(campoNome, 'Informe o seu nome.');
      return definirErro(campoNome, '');
    };

    var validarTelefone = function () {
      var digitos = campoTel.value.replace(/\D/g, '');
      if (digitos.length < 10) return definirErro(campoTel, 'Informe o DDD e o número completo.');
      if (digitos.length > 13) return definirErro(campoTel, 'Número muito longo. Confira os dígitos.');
      return definirErro(campoTel, '');
    };

    var validarTipo = function () {
      if (!campoTipo.value) return definirErro(campoTipo, 'Escolha o tipo de projeto.');
      return definirErro(campoTipo, '');
    };

    // Máscara de telefone brasileira, aplicada enquanto o visitante digita.
    campoTel.addEventListener('input', function () {
      var d = campoTel.value.replace(/\D/g, '').slice(0, 11);
      var saida = d;
      if (d.length > 2) saida = '(' + d.slice(0, 2) + ') ' + d.slice(2);
      if (d.length > 6) {
        var corte = d.length > 10 ? 7 : 6;
        saida = '(' + d.slice(0, 2) + ') ' + d.slice(2, corte) + '-' + d.slice(corte);
      }
      campoTel.value = saida;
    });

    if (campoMsg && contador) {
      campoMsg.addEventListener('input', function () {
        contador.textContent = String(campoMsg.value.length);
      });
    }

    // Só valida ao sair do campo depois que o visitante já tentou enviar uma vez.
    var jaEnviou = false;
    [[campoNome, validarNome], [campoTel, validarTelefone], [campoTipo, validarTipo]].forEach(function (par) {
      par[0].addEventListener('blur', function () { if (jaEnviou) par[1](); });
      par[0].addEventListener('change', function () { if (jaEnviou) par[1](); });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      jaEnviou = true;

      var ok = [validarNome(), validarTelefone(), validarTipo()].every(Boolean);
      if (!ok) {
        var primeiroErro = $('.field.has-error input, .field.has-error select', form);
        if (primeiroErro) primeiroErro.focus();
        return;
      }

      var partes = [
        'Olá! Vim pelo site da NEXO WEB e quero solicitar um orçamento.',
        '',
        'Nome: ' + limpar(campoNome.value, 80),
        'WhatsApp: ' + limpar(campoTel.value, 20),
        'Tipo de projeto: ' + limpar(campoTipo.value, 40)
      ];

      if (campoPlano && campoPlano.value) partes.push('Plano de interesse: ' + limpar(campoPlano.value, 40));

      var detalhe = limpar(campoMsg ? campoMsg.value : '', 600);
      if (detalhe) partes.push('', 'Sobre o projeto: ' + detalhe);

      var destino = linkWhatsApp(partes.join('\n'));
      if (destino) window.open(destino, '_blank', 'noopener,noreferrer');
    });
  }
})();
