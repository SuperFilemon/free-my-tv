/*
 * The home screen for web-app TVs (LG webOS, Samsung Tizen), with the Android app's design and behavior (HomeView):
 *  - top: the "For You" title and the tabs (Explore, Movies, Shows); icon-only glass buttons at the right (Live TV,
 *    HDMI Inputs, Settings) and the crypto quotes at the end of the tab row;
 *  - three picks for this hour in the selected tab; the background is the first one's photo, blurred and almost white;
 *  - the glass shelf with the apps; ↓ opens the drawer (inputs, shortcuts, weather, prices); ↑ or Back closes it;
 *  - a night look from sunset to sunrise; a screensaver after a few idle minutes.
 * The remote's arrows, OK and Back move the focus; a pointer (LG's Magic Remote) focuses what it points at.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function sym(name, parent, size) {
    var s = el('span', 'sym', parent);
    s.style.webkitMaskImage = 'url(symbols/' + name + '.png)';
    s.style.maskImage = 'url(symbols/' + name + '.png)';
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    return s;
  }

  function coin(i, parent) {
    el('span', 'tick', parent, Data.quoteSym(i));
  }

  function hasClass(e, c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function setClass(e, c, on) {
    if (!e) return;
    if (on && !hasClass(e, c)) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    else if (!on && hasClass(e, c)) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  var stage = $('stage'), body = document.body;

  /** The 1920 × 1080 stage fills the window (on the TV it already is 1920 × 1080). */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.webkitTransform = stage.style.transform = s === 1 ? '' : 'scale(' + s + ')';
  }

  // MARK: - Apps on the shelf

  /** Shelf apps in this order when installed, like the Android app: key, LG app id, name on the TV, brand gradient. */
  // Ordem pedida pelo Filêmon: YouTube, Globoplay, Prime, YouTube Music (se houver), Apple TV, Netflix, Mídia local.
  // Os demais apps ficam disponíveis em "Todos os Apps". Um app só entra no shelf quando está instalado na TV.
  // Os 6 do Filemon, nesta ordem: YouTube, Globoplay, Prime, Apple TV, Netflix, Mídia Local (sem HBO Max nem Spotify).
  var SHELF = [
    ['youtube', /youtube\.leanback|^youtube$/, /^youtube$/i, ['#FF0000', '#C00000']],
    ['globoplay', /globoplay/, /globoplay/i, ['#FF8A1F', '#FF2D5A']],
    ['prime', /^amazon$/, /prime video|amazon/i, ['#1FB6FF', '#0A68D4']],
    ['appletv', /appletv|apple\.tv/, /apple tv/i, ['#3A3A3D', '#111113']],
    ['netflix', /^netflix$/, /netflix/i, ['#E50914', '#B0060F']],
    ['localmedia', /mediadiscovery|com\.webos\.app\.media/, /mídia local|local media|media player/i, ['#5B6B8C', '#2E3A52']]
  ];
  var MAX_SHELF = 6;

  function shelfKey(app) {
    for (var i = 0; i < SHELF.length; i++) if (SHELF[i][1].test(app.id) || SHELF[i][2].test(app.title)) return SHELF[i];
    return null;
  }

  function darken(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#161618';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * f) + ',' + Math.round(g * f) + ',' + Math.round(b * f) + ')';
  }

  /** A name that fits the tile on one line (the font shrinks for long names). */
  function wordFit(title, width, max) {
    return Math.max(18, Math.min(max, Math.floor(width * 0.8 / (Math.max(4, title.length) * 0.56))));
  }

  /** An app's face: its own icon on its brand color (or its name, when the icon can't be read). */
  // Shelf: só o retângulo na cor predominante da marca + o nome do serviço (sem ícones), a pedido do Filemon.
  function face(app, box, wordSize) {
    var k = shelfKey(app);
    var top = k ? k[3][0] : app.color ? darken(app.color, 0.92) : '#2A2A2E';
    var bottom = k ? k[3][1] : app.color ? darken(app.color, 0.62) : '#161618';
    box.style.background = '-webkit-linear-gradient(top, ' + top + ', ' + bottom + ')';
    box.style.background = 'linear-gradient(' + top + ', ' + bottom + ')';
    var word = el('div', 'word', box, app.title);
    if (wordSize) word.style.fontSize = wordSize + 'px';
  }

  var apps = [], shelf = [], others = [], inputs = [];

  function pickShelf() {
    var chosen = Prefs.shelf(), out = [];
    if (chosen) {
      for (var i = 0; i < chosen.length && out.length < MAX_SHELF; i++) {
        for (var j = 0; j < apps.length; j++) if (apps[j].id === chosen[i]) out.push(apps[j]);
      }
    } else {
      for (var s = 0; s < SHELF.length && out.length < MAX_SHELF; s++) {
        for (var a = 0; a < apps.length; a++) {
          if ((SHELF[s][1].test(apps[a].id) || SHELF[s][2].test(apps[a].title)) && out.indexOf(apps[a]) < 0) { out.push(apps[a]); break; }
        }
      }
      if (!out.length) out = apps.slice(0, MAX_SHELF);
    }
    shelf = out;
    others = apps.filter(function (x) { return shelf.indexOf(x) < 0; });
  }

  // MARK: - Focus

  var Z = {TOP: 'top', CARDS: 'cards', SHELF: 'shelf', DRAWER: 'drawer', APPS: 'apps', SETTINGS: 'settings', EDIT: 'edit', YTEDIT: 'ytedit', ASSETEDIT: 'assetedit'};
  var st = {zone: Z.SHELF, top: 0, tab: 0, card: 0, shelf: 0, drawer: 0, grid: 0, row: 0, edit: 0, ytrow: 0, assetrow: 0};
  var cards = [], renderedKind = '', editingYt = false;

  function sheetOpen() { return st.zone === Z.APPS || st.zone === Z.SETTINGS || st.zone === Z.EDIT || st.zone === Z.YTEDIT || st.zone === Z.ASSETEDIT; }

  function updateFocus() {
    var i, list;
    list = $('tabs').children;
    for (i = 0; i < list.length; i++) {
      setClass(list[i], 'on', i === st.tab);
      setClass(list[i], 'focus', st.zone === Z.TOP && st.top === i);
    }
    list = $('buttons').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.TOP && st.top === NTABS + i);
    setClass($('quotes'), 'hide', st.zone === Z.TOP && st.top >= NTABS);
    list = $('cards').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.CARDS && st.card === i);
    var firstCard = Math.max(0, Math.min(Math.max(0, list.length - CARD_VISIBLE), st.card - 1));
    $('cards').style.webkitTransform = $('cards').style.transform = 'translateX(' + (-firstCard * (CARD_W + CARD_GAP)) + 'px)';
    list = $('tiles').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.SHELF && st.shelf === i);
    list = document.querySelectorAll('#drawer .key');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.DRAWER && st.drawer === i);
    list = document.querySelectorAll('#apps .cell');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.APPS && st.grid === i);
    var rows = Math.max(1, Math.ceil(others.length / 5)), r = Math.floor(st.grid / 5), first = Math.max(0, Math.min(rows - 3, r - 1));
    $('apps').lastChild.style.webkitTransform = $('apps').lastChild.style.transform = 'translateY(' + (-first * 239) + 'px)';
    focusRows($('settings'), st.row, st.zone === Z.SETTINGS);
    focusRows($('shelfedit'), st.edit, st.zone === Z.EDIT);
    focusRows($('ytedit'), st.ytrow, st.zone === Z.YTEDIT);
    focusRows($('assetedit'), st.assetrow, st.zone === Z.ASSETEDIT);
    setClass(body, 'drawer-open', st.zone === Z.DRAWER);
  }

  function focusRows(sheet, index, on) {
    var rows = sheet.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) setClass(rows[i], 'focus', on && i === index);
    var holder = sheet.querySelector('.rows');
    if (!holder) return;
    var visible = 7, first = Math.max(0, Math.min(rows.length - visible, index - 3));
    holder.style.webkitTransform = holder.style.transform = 'translateY(' + (-first * 78) + 'px)';
  }

  function nearest(nodes, x) {
    var best = 0, bestD = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect(), d = Math.abs((r.left + r.right) / 2 - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function centerX(node) {
    if (!node) return 960;
    var r = node.getBoundingClientRect();
    return (r.left + r.right) / 2;
  }

  // MARK: - Top: title, tabs, buttons, quotes

  var TAB_KIND = ['youtube', 'tv', 'movie'];   // ordem remontada em renderTop (YouTube, Séries, Filmes)
  var NTABS = 3;   // número de abas visíveis; atualizado em renderTop (a aba YouTube só entra se configurada)

  /** Cabeçalho central: linha 1 = temperatura (ícone + graus) + horário; linha 2 = data. */
  function updateTitle() {
    var d = new Date(), t = $('title'), w = Data.weather;
    t.innerHTML = '';
    var l1 = el('div', 'l1', t);
    if (w) {
      sym(Data.symbol(w.code, w.isDay), l1);
      el('span', 'tt', l1, Data.degrees(w.temp));
    }
    el('span', 'hr', l1, Data.time(d.getTime()));
    var date;
    try { date = d.toLocaleDateString(I18N.locale(), {weekday: 'long', day: 'numeric', month: 'long'}); }
    catch (e) { date = d.toDateString(); }
    el('span', 'tsub', t, date);
  }

  function renderTop() {
    updateTitle();
    var tabs = $('tabs');
    tabs.innerHTML = '';
    // Ordem pedida pelo Filemon: YouTube, Séries, Filmes (sem "Explorar").
    TAB_KIND = []; var names = [];
    if (Data.hasYouTube()) { TAB_KIND.push('youtube'); names.push('YouTube'); }
    TAB_KIND.push('tv'); names.push(tr('Séries', 'Shows', 'Series'));
    TAB_KIND.push('movie'); names.push(tr('Filmes', 'Movies', 'Películas'));
    NTABS = names.length;
    for (var i = 0; i < names.length; i++) {
      var t = el('button', 'tab', tabs, names[i]);
      hover(t, Z.TOP, i);
    }
    var buttons = $('buttons');
    buttons.innerHTML = '';
    var defs = [['live_tv', tr('TV aberta', 'Live TV', 'TV en vivo')], ['hdmi', tr('Entradas HDMI', 'HDMI Inputs', 'Entradas HDMI')],
      ['settings', tr('Ajustes', 'Settings', 'Ajustes')]];
    for (var b = 0; b < 3; b++) {
      var r = el('button', 'round' + (b === 2 ? ' last' : ''), buttons);
      r.style.left = (1582 + 90 * b) + 'px';
      sym(defs[b][0], r);
      el('div', 'tip', r, defs[b][1]);
      hover(r, Z.TOP, NTABS + b);
    }
  }

  // Barra de ativos acima do shelf: "BTC/USD $81.458 +1,2%". Cabe → centralizada; não cabe → rola em loop infinito.
  var tickerStyle = null;
  function renderQuotes() {
    var t = $('ticker'), track = t.firstChild, coins = Prefs.quotes() ? Data.activeCoins() : [];
    track.innerHTML = '';
    track.style.webkitAnimation = track.style.animation = 'none';
    if (!coins.length) { t.style.display = 'none'; return; }
    t.style.display = '';
    function build(into) {
      for (var j = 0; j < coins.length; j++) {
        var i = coins[j], item = el('span', 'tk', into);
        el('span', 'tkpair', item, Data.coinName(i));            // BTC/USD
        el('span', 'tkprice', item, Data.money(i));              // $81.458
        var ch = Data.changes[i];
        if (!isNaN(ch)) el('span', 'tkchg ' + (ch >= 0 ? 'up' : 'down'), item, Data.change(ch));
      }
    }
    build(track);
    var avail = 1760;   // largura útil entre as margens
    if (track.scrollWidth <= avail) {
      setClass(t, 'scroll', false);   // cabe: fica centralizada e parada
    } else {
      setClass(t, 'scroll', true);    // não cabe: duplica e anima em loop contínuo
      build(track);
      var full = track.scrollWidth / 2, dur = Math.max(12, Math.round(full / 70));   // ~70 px/s
      if (!tickerStyle) { tickerStyle = document.createElement('style'); document.head.appendChild(tickerStyle); }
      tickerStyle.textContent = '@-webkit-keyframes tkscroll{from{-webkit-transform:translateX(0)}to{-webkit-transform:translateX(-' + full + 'px)}}'
        + '@keyframes tkscroll{from{transform:translateX(0)}to{transform:translateX(-' + full + 'px)}}';
      track.style.webkitAnimation = track.style.animation = 'tkscroll ' + dur + 's linear infinite';
    }
  }

  // MARK: - Picks and background

  // Carrossel de cards 16:9 (filmes, séries e vídeos do YouTube), navegável pela setinha ← →.
  var CARD_W = 580, CARD_GAP = 40, CARD_X0 = 50, CARD_VISIBLE = 3;

  function renderCards() {
    var kind = TAB_KIND[st.tab], yt = kind === 'youtube';
    var list = yt ? Data.youtube(20) : Data.picks(kind, 7);
    var holder = $('cards');
    setClass(body, 'no-picks', !list.length);
    var same = renderedKind === kind && list.length === cards.length;
    for (var i = 0; same && i < list.length; i++) same = (list[i].id || list[i].videoId) === (cards[i].id || cards[i].videoId) && list[i].title === cards[i].title;
    if (same && holder.children.length === list.length) return;
    renderedKind = kind;
    cards = list;
    holder.innerHTML = '';
    for (var c = 0; c < list.length; c++) {
      var p = list[c], card = el('div', 'card vid', holder);
      card.style.left = (CARD_X0 + c * (CARD_W + CARD_GAP)) + 'px';
      card.style.width = CARD_W + 'px';
      var img = el('div', 'img', card);
      img.style.backgroundImage = 'url(' + (yt ? p.thumb : Data.image(p.backdrop, 'w780')) + ')';
      el('div', 'name', card, p.title);
      var sub = yt ? p.channel : p.meta;
      if (sub) el('div', 'meta', card, sub);
      hover(card, Z.CARDS, c);
    }
    st.card = Math.min(st.card, Math.max(0, list.length - 1));
    if (!list.length && st.zone === Z.CARDS) st.zone = Z.SHELF;
    backdrop(yt ? (list.length ? list[0].thumb : '') : (list.length ? Data.image(list[0].backdrop, 'w300') : ''));
    updateFocus();
  }

  var bgUrl = null, bgFront = 'bgA';

  /** The first pick's photo as the background: drawn tiny and stretched, it's already as soft as a heavy blur. */
  function backdrop(url) {
    if (url === bgUrl) return;
    bgUrl = url;
    var next = bgFront === 'bgA' ? 'bgB' : 'bgA';
    if (!url) {
      setClass($('bgA'), 'on', false);
      setClass($('bgB'), 'on', false);
      return;
    }
    var img = new Image();
    img.onload = function () {
      if (bgUrl !== url) return;
      var canvas = $(next), ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setClass(canvas, 'on', true);
      setClass($(bgFront), 'on', false);
      bgFront = next;
    };
    img.src = url;
  }

  function renderClock() {
    var d = new Date(), c = $('clock');
    c.firstChild.textContent = Data.time(d.getTime());
    try {
      c.lastChild.textContent = d.toLocaleDateString(I18N.locale(), {weekday: 'long', day: 'numeric', month: 'long'});
    } catch (e) {
      c.lastChild.textContent = d.toDateString();
    }
  }

  // MARK: - Shelf

  function renderShelf() {
    var n = shelf.length, pad = 40;
    // A prateleira ocupa exatamente a largura das caixas do drawer (80 → 1840).
    var platterLeft = 80, platterW = 1760;
    var innerLeft = platterLeft + pad, innerW = platterW - 2 * pad;   // área útil dos tiles, com uma margem interna
    // 16:9 tiles, as on Android: never taller than 126, and the glass keeps its bottom edge.
    var tw = Math.min(126 * 16 / 9, innerW / Math.max(1, n)), th = tw * 9 / 16;
    // o espaçamento entre os botões se distribui para preencher toda a largura
    var gap = n > 1 ? (innerW - n * tw) / (n - 1) : 0;
    var platter = $('platter');
    platter.style.display = n ? '' : 'none';
    platter.style.left = platterLeft + 'px';
    platter.style.width = platterW + 'px';
    platter.style.top = (814 + 126 - th) + 'px';
    platter.style.height = (th + 2 * pad) + 'px';
    var tiles = $('tiles');
    tiles.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var t = el('div', 'tile', tiles);
      t.style.left = (innerLeft + i * (tw + gap)) + 'px';
      t.style.top = (854 + 126 - th) + 'px';
      t.style.width = tw + 'px';
      t.style.height = th + 'px';
      face(shelf[i], t, wordFit(shelf[i].title, tw, 30));
      hover(t, Z.SHELF, i);
    }
    st.shelf = Math.min(st.shelf, Math.max(0, n - 1));
  }

  // MARK: - Drawer

  var drawerItems = [], drawerInputs = 0;

  function renderDrawer() {
    var d = $('drawer');
    d.innerHTML = '';
    drawerItems = [];
    for (var i = 0; i < inputs.length; i++) {
      var x = inputs[i];
      drawerItems.push({label: x.label || tr('TV aberta', 'Live TV', 'TV en vivo'), symbol: x.symbol, off: !x.connected, run: launcher(x.id, x.label)});
    }
    drawerInputs = drawerItems.length;
    drawerItems.push({label: tr('Todos os Apps', 'All Apps', 'Todas las apps'), symbol: 'apps', run: openApps});
    drawerItems.push({label: tr('Ajustes do Início', 'Home Settings', 'Ajustes de inicio'), symbol: 'settings', run: openSettings});
    drawerItems.push({label: tr('Ajustes da TV', 'TV Settings', 'Ajustes del TV'), symbol: 'tv_settings', run: tvSettings});
    var n = drawerItems.length, gap = 18, groupGap = 56, groups = drawerInputs > 0 && drawerInputs < n ? 2 : 1;
    var tw = Math.min(230, (1760 - Math.max(0, n - groups) * gap - (groups - 1) * groupGap) / Math.max(1, n));
    var xPos = 80;
    for (var k = 0; k < n; k++) {
      if (k === drawerInputs && k > 0) {
        xPos += groupGap - gap;
        el('div', 'row-title', d, tr('Atalhos', 'Shortcuts', 'Accesos directos')).style.left = (xPos + 4) + 'px';
      }
      if (k === 0 && drawerInputs) el('div', 'row-title', d, tr('Entradas', 'Inputs', 'Entradas')).style.left = '84px';
      var item = drawerItems[k], key = el('div', 'key glass' + (item.off ? ' off' : ''), d);
      key.style.left = xPos + 'px';
      key.style.width = tw + 'px';
      sym(item.symbol, key);
      el('div', 'label', key, item.label);
      hover(key, Z.DRAWER, k);
      xPos += tw + gap;
    }
    renderPanels();
    updateFocus();
  }

  function renderPanels() {
    var d = $('drawer');
    var old = d.querySelectorAll('.panel');
    for (var o = 0; o < old.length; o++) d.removeChild(old[o]);
    // A caixa de cotações saiu do drawer (as cotações agora ficam na barra acima do shelf). Só o clima aqui.
    if (Prefs.weather()) {
      var w = el('div', 'panel glass', d);
      w.id = 'weather';
      w.style.left = '80px';
      w.style.width = (1840 - 80) + 'px';
      renderWeather(w);
    }
  }

  function renderWeather(card) {
    el('div', 'head', card, Data.city || tr('Clima', 'Weather', 'Clima'));
    var w = Data.weather;
    if (!w) {
      el('div', 'cond', card, tr('Sem dados do clima agora.', 'No weather data right now.', 'No hay datos del clima ahora.')).style.top = '96px';
      return;
    }
    var now = el('div', 'now', card);
    sym(Data.symbol(w.code, w.isDay), now);
    el('span', 'temp', now, Data.degrees(w.temp));
    el('div', 'cond', card, Data.condition(w.code, w.isDay));
    el('div', 'range', card, I18N.lang === 'ru' ? 'Макс. ' + Data.degrees(w.max) + '   Мин. ' + Data.degrees(w.min) : tr('Máx. ' + Data.degrees(w.max) + '   Mín. ' + Data.degrees(w.min), 'H:' + Data.degrees(w.max) + '   L:' + Data.degrees(w.min),
        'Máx. ' + Data.degrees(w.max) + '   Mín. ' + Data.degrees(w.min)));
    el('div', 'split', card);
    var days = el('div', 'hours', card), ndays = Math.min(w.days.length, 4), width = parseFloat(card.style.width) - 30 - 422, dw = width / ndays;
    for (var i = 0; i < ndays; i++) {
      var h = el('div', 'hour', days), x = w.days[i];
      h.style.left = (dw * i) + 'px';
      h.style.width = dw + 'px';
      el('div', 't', h, i === 0 ? tr('Hoje', 'Today', 'Hoy') : i === 1 ? tr('Amanhã', 'Tomorrow', 'Mañana') : Data.weekday(x.date));
      sym(Data.symbol(x.code, true), h);
      var dd = el('div', 'd', h, Data.degrees(x.max));
      el('span', 'lo', dd, ' ' + Data.degrees(x.min));
      // nascer e pôr do sol de cada dia, uma linha embaixo da outra
      if (x.sunrise) { var sr = el('div', 'sun', h); sym('sunrise', sr); sr.appendChild(document.createTextNode(Data.time(x.sunrise))); }
      if (x.sunset) { var ss = el('div', 'sun', h); sym('sunset', ss); ss.appendChild(document.createTextNode(Data.time(x.sunset))); }
    }
  }

  function renderPrices(card, coins) {
    el('div', 'head', card, tr('Cotações', 'Crypto', 'Cripto'));
    var stale = Data.staleness(Data.pricesAt, 5 * 60000);
    el('div', 'side', card, stale || tr('variação em 24 h', '24h change', 'variación en 24 h'));
    for (var j = 0; j < coins.length; j++) {
      var i = coins[j], row = el('div', 'coin', card);
      row.style.top = (80 + 36 * j) + 'px';
      coin(i, row);
      el('span', 'n', row, Data.coinName(i));
      el('span', 'p', row, Data.money(i));
      var ch = Data.changes[i];
      if (!isNaN(ch)) el('span', 'c ' + (ch >= 0 ? 'up' : 'down'), row, Data.change(ch));
    }
  }

  function openDrawer() {
    if (!drawerItems.length) return;
    var tiles = $('tiles').children;
    st.zone = Z.DRAWER;
    st.drawer = Math.min(drawerItems.length - 1, nearest(document.querySelectorAll('#drawer .key'), centerX(tiles[st.shelf])));
    updateFocus();
  }

  function closeDrawer() {
    var keys = document.querySelectorAll('#drawer .key');
    st.zone = Z.SHELF;
    if (shelf.length) st.shelf = nearest($('tiles').children, centerX(keys[st.drawer]));
    updateFocus();
  }

  // MARK: - All Apps

  function renderApps() {
    var sheet = $('apps');
    sheet.firstChild.textContent = tr('Todos os Apps', 'All Apps', 'Todas las apps');
    var grid = sheet.lastChild;
    grid.innerHTML = '';
    for (var i = 0; i < others.length; i++) {
      var r = Math.floor(i / 5), c = i % 5, cell = el('div', 'cell', grid);
      cell.style.left = (130 + c * 340) + 'px';
      cell.style.top = (196 + r * 239) + 'px';
      face(others[i], el('div', 'face', cell), wordFit(others[i].title, 300, 34));
      el('div', 'label', cell, others[i].title);
      hover(cell, Z.APPS, i);
    }
  }

  function openApps() {
    renderApps();
    st.zone = Z.APPS;
    st.grid = 0;
    setClass($('apps'), 'open', true);
    updateFocus();
  }

  function closeSheets() {
    setClass($('apps'), 'open', false);
    setClass($('settings'), 'open', false);
    setClass($('shelfedit'), 'open', false);
    setClass($('ytedit'), 'open', false);
    setClass($('assetedit'), 'open', false);
    st.zone = Z.SHELF;
    updateFocus();
  }

  // MARK: - Home Settings

  function settingRows() {
    var lang = Prefs.language(), unit = Prefs.temperature(), theme = Prefs.theme();
    var auto = tr('Automático', 'Automatic', 'Automático'), on = tr('Ligado', 'On', 'Activado'), off = tr('Desligado', 'Off', 'Desactivado');
    var rows = [
      {label: tr('Idioma', 'Language', 'Idioma'), value: lang === 'ru' ? 'Русский' : lang === 'de' ? 'Deutsch' : lang === 'pt' ? 'Português' : lang === 'en' ? 'English' : lang === 'es' ? 'Español' : auto,
        step: function (d) { cycle('language', ['auto', 'de', 'en', 'es', 'pt', 'ru'], lang, d); I18N.set(Prefs.language()); renderAll(); }},
      {label: tr('Temperatura', 'Temperature', 'Temperatura'), value: unit === 'C' ? '°C' : unit === 'F' ? '°F' : auto,
        step: function (d) { cycle('temperature', ['auto', 'C', 'F'], unit, d); renderPanels(); }},
      {label: tr('Tema', 'Theme', 'Tema'), value: theme === 'areia' ? tr('Areia', 'Sand', 'Arena') : theme === 'nevoa' ? tr('Névoa', 'Mist', 'Niebla') : theme === 'salvia' ? tr('Sálvia', 'Sage', 'Salvia') : theme === 'meianoite' ? tr('Meia-noite', 'Midnight', 'Medianoche') : theme === 'oled' ? 'OLED' : theme === 'carvao' ? tr('Carvão', 'Charcoal', 'Carbón') : auto,
        step: function (d) { cycle('theme', ['auto', 'areia', 'nevoa', 'salvia', 'meianoite', 'oled', 'carvao'], theme, d); checkNight(); }},
      {label: tr('Widget do clima', 'Weather widget', 'Widget del clima'), toggle: Prefs.weather(),
        step: function () { Prefs.set('weather', !Prefs.weather()); renderPanels(); }},
      {label: tr('Widget de cotações', 'Quotes widget', 'Widget de cotizaciones'), toggle: Prefs.quotes(),
        step: function () { Prefs.set('quotes', !Prefs.quotes()); Data.settingsChanged(); }}
    ];
    rows.push({label: tr('Cotações', 'Quotes', 'Cotizaciones'), value: '›', step: function (d) { if (d >= 0) openAssetEdit(); }});
    rows.push({label: tr('Prateleira', 'Shelf', 'Estante'), value: '›', step: function (d) { if (d >= 0) openShelfEdit(); }});
    if (Data.hasYouTube()) rows.push({label: tr('Canais do YouTube', 'YouTube channels', 'Canales de YouTube'), value: '›', step: function (d) { if (d >= 0) openYtEdit(); }});
    rows.push({label: tr('Ajustes da TV', 'TV Settings', 'Ajustes del TV'), value: '›', step: function (d) { if (d >= 0) tvSettings(); }});
    return rows;
  }

  function cycle(name, values, current, d) {
    var i = values.indexOf(current);
    Prefs.set(name, values[(i + (d || 1) + values.length) % values.length]);
  }

  var rowsNow = [];

  function renderSettings() {
    var box = $('settings').firstChild;
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('settings', title);
    title.appendChild(document.createTextNode(tr('Ajustes do Início', 'Home Settings', 'Ajustes de inicio')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    rowsNow = settingRows();
    list.style.height = Math.min(rowsNow.length, 7) * 78 + 'px';
    for (var i = 0; i < rowsNow.length; i++) {
      var r = rowsNow[i], row = el('div', 'row' + (r.dim ? ' dim' : ''), holder, r.label);
      if (r.toggle !== undefined) setClass(el('div', 'toggle', row), 'on', r.toggle);
      else {
        var v = el('span', 'value', row);
        if (r.value === '›') v.textContent = '›';
        else { el('span', 'chev', v, '‹'); v.appendChild(document.createTextNode(r.value)); el('span', 'chev', v, '›'); }
      }
      hover(row, Z.SETTINGS, i);
    }
    el('div', 'hint', box, tr('OK ou as setas mudam o valor.', 'OK or the arrows change the value.', 'OK o las flechas cambian el valor.'));
    updateFocus();
  }

  function openSettings() {
    st.zone = Z.SETTINGS;
    st.row = 0;
    renderSettings();
    setClass($('settings'), 'open', true);
    updateFocus();
  }

  // MARK: - Shelf editor: which apps, in what order

  function ordinal(n) {
    if (I18N.lang === 'ru') return n + '-е';
    if (I18N.lang === 'de') return n + '.';
    if (I18N.lang !== 'en') return n + 'º';
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function editList() {
    var ids = shelf.map(function (a) { return a.id; });
    return {ids: ids, rows: apps.slice().sort(function (a, b) {
      var ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1;
    })};
  }

  function renderShelfEdit() {
    var box = $('shelfedit').firstChild, e = editList();
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('apps', title);
    title.appendChild(document.createTextNode(tr('Prateleira', 'Shelf', 'Estante')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(e.rows.length, 7) * 78 + 'px';
    for (var i = 0; i < e.rows.length; i++) {
      var a = e.rows[i], at = e.ids.indexOf(a.id), row = el('div', 'row', holder, a.title);
      el('span', 'value', row, at >= 0 ? tr('Na prateleira · ', 'On · ', 'En el estante · ') + ordinal(at + 1) : tr('Fora', 'Off', 'Fuera'));
      hover(row, Z.EDIT, i);
    }
    el('div', 'hint', box, tr('OK põe ou tira · ← → mudam a ordem', 'OK adds or removes · ← → change the order', 'OK pone o quita · ← → cambian el orden'));
    updateFocus();
  }

  function openShelfEdit() {
    setClass($('settings'), 'open', false);
    st.zone = Z.EDIT;
    st.edit = 0;
    renderShelfEdit();
    setClass($('shelfedit'), 'open', true);
    updateFocus();
  }

  function editShelf(dx) {
    var e = editList(), app = e.rows[st.edit];
    if (!app) return;
    var ids = e.ids.slice(), at = ids.indexOf(app.id);
    if (dx === 0) {
      if (at >= 0) ids.splice(at, 1);
      else if (ids.length < MAX_SHELF) ids.push(app.id);
      else { toast(tr('A prateleira cabe até ' + MAX_SHELF + ' apps.', 'The shelf holds up to ' + MAX_SHELF + ' apps.', 'El estante tiene hasta ' + MAX_SHELF + ' apps.')); return; }
    } else {
      if (at < 0) return;
      var to = Math.max(0, Math.min(ids.length - 1, at + dx));
      ids.splice(at, 1);
      ids.splice(to, 0, app.id);
    }
    Prefs.set('shelf', ids);
    pickShelf();
    renderShelf();
    var again = editList();
    for (var i = 0; i < again.rows.length; i++) if (again.rows[i].id === app.id) st.edit = i;
    renderShelfEdit();
  }

  // MARK: - Editores de lista: canais do YouTube e cotações (adicionar por texto, remover com confirmação)

  var pendingRemove = null;   // id do item aguardando o 2º OK para remover (evita apagar sem querer)

  // Campo de texto compartilhado (ao focar, abre o teclado da TV).
  var textInput = $('ytinput'), inputDone = null;
  function openTextInput(placeholder, onDone) {
    editingYt = true;
    inputDone = onDone;
    textInput.value = '';
    textInput.setAttribute('placeholder', placeholder);
    textInput.style.display = 'block';
    try { textInput.focus(); } catch (e) {}
  }
  function closeTextInput() {
    editingYt = false;
    textInput.style.display = 'none';
    try { textInput.blur(); } catch (e) {}
  }
  textInput.onchange = function () {
    var v = textInput.value.trim(), cb = inputDone;
    closeTextInput();
    updateFocus();
    if (v && cb) cb(v);
  };
  textInput.onkeydown = function (e) {
    if (e.keyCode === 13) { textInput.blur(); }                                  // Enter/OK confirma
    else if (e.keyCode === 27 || e.keyCode === 461) { closeTextInput(); updateFocus(); }  // Esc / Back cancela
    e.stopPropagation();
  };

  /** Uma linha de lista com confirmação de remoção (id único controla o pendingRemove). */
  function listRow(holder, zone, index, label, id) {
    var row = el('div', 'row', holder, label);
    el('span', 'value' + (pendingRemove === id ? ' danger' : ''), row,
      pendingRemove === id ? tr('Remover mesmo? OK', 'Remove? OK', '¿Quitar? OK') : tr('OK remove', 'OK removes', 'OK quita'));
    hover(row, zone, index);
  }

  // --- Canais do YouTube ---
  function ytRows() { return Data.ytList(); }
  function ytRowCount() { return ytRows().length + 1; }

  function renderYtEdit() {
    var box = $('ytedit').firstChild, list = ytRows();
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('settings', title);
    title.appendChild(document.createTextNode(tr('Canais do YouTube', 'YouTube channels', 'Canales de YouTube')));
    var listEl = el('div', 'list', box), holder = el('div', 'rows', listEl);
    listEl.style.height = Math.min(ytRowCount(), 7) * 78 + 'px';
    for (var i = 0; i < list.length; i++) listRow(holder, Z.YTEDIT, i, list[i].title, 'yt:' + list[i].uploads);
    var add = el('div', 'row', holder, tr('＋ Adicionar canal', '＋ Add channel', '＋ Añadir canal'));
    hover(add, Z.YTEDIT, list.length);
    el('div', 'hint', box, tr('Digite o @ (ou link). 1º OK pede confirmação, 2º OK remove.', 'Type the @ (or link). First OK asks, second OK removes.', 'Escribe el @ (o enlace). 1º OK pregunta, 2º OK quita.'));
    updateFocus();
  }
  function openYtEdit() {
    setClass($('settings'), 'open', false);
    pendingRemove = null; st.zone = Z.YTEDIT; st.ytrow = 0;
    renderYtEdit();
    setClass($('ytedit'), 'open', true);
    updateFocus();
  }
  function ytAction() {
    var list = ytRows();
    if (st.ytrow >= list.length) {
      pendingRemove = null;
      openTextInput(tr('@canal ou link do YouTube', '@channel or YouTube link', '@canal o enlace'), function (v) {
        toast(tr('Procurando o canal…', 'Looking up the channel…', 'Buscando el canal…'));
        Data.addYouTubeChannel(v, function (ok, msg) { toast((ok ? tr('Adicionado: ', 'Added: ', 'Añadido: ') : tr('Não deu: ', "Didn't work: ", 'No se pudo: ')) + msg); if (st.zone === Z.YTEDIT) renderYtEdit(); });
      });
      return;
    }
    var ch = list[st.ytrow]; if (!ch) return;
    var id = 'yt:' + ch.uploads;
    if (pendingRemove === id) { pendingRemove = null; Data.removeYouTubeChannel(ch.uploads); st.ytrow = Math.min(st.ytrow, ytRowCount() - 1); renderYtEdit(); toast(tr('Canal removido', 'Channel removed', 'Canal quitado')); }
    else { pendingRemove = id; renderYtEdit(); }
  }

  // --- Cotações (ativos financeiros) ---
  function assetRows() { return Data.assetList(); }
  function assetRowCount() { return assetRows().length + 1; }

  function renderAssetEdit() {
    var box = $('assetedit').firstChild, list = assetRows();
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('settings', title);
    title.appendChild(document.createTextNode(tr('Cotações', 'Quotes', 'Cotizaciones')));
    var listEl = el('div', 'list', box), holder = el('div', 'rows', listEl);
    listEl.style.height = Math.min(assetRowCount(), 7) * 78 + 'px';
    for (var i = 0; i < list.length; i++) listRow(holder, Z.ASSETEDIT, i, list[i].sym + '/' + list[i].unit, 'as:' + list[i].sym);
    var add = el('div', 'row', holder, tr('＋ Adicionar ativo', '＋ Add asset', '＋ Añadir activo'));
    hover(add, Z.ASSETEDIT, list.length);
    el('div', 'hint', box, tr('Digite o símbolo (ex.: BTC, ADA, DOGE). 1º OK pede confirmação, 2º OK remove.', 'Type the symbol (e.g. BTC, ADA). First OK asks, second OK removes.', 'Escribe el símbolo. 1º OK pregunta, 2º OK quita.'));
    updateFocus();
  }
  function openAssetEdit() {
    setClass($('settings'), 'open', false);
    pendingRemove = null; st.zone = Z.ASSETEDIT; st.assetrow = 0;
    renderAssetEdit();
    setClass($('assetedit'), 'open', true);
    updateFocus();
  }
  function assetAction() {
    var list = assetRows();
    if (st.assetrow >= list.length) {
      pendingRemove = null;
      openTextInput(tr('Símbolo (ex.: BTC, ADA, DOGE)', 'Symbol (e.g. BTC, ADA)', 'Símbolo (ej.: BTC)'), function (v) {
        toast(tr('Procurando o ativo…', 'Looking up the asset…', 'Buscando el activo…'));
        Data.addAsset(v, function (ok, msg) { toast((ok ? tr('Adicionado: ', 'Added: ', 'Añadido: ') : tr('Não deu: ', "Didn't work: ", 'No se pudo: ')) + msg); if (st.zone === Z.ASSETEDIT) renderAssetEdit(); });
      });
      return;
    }
    var a = list[st.assetrow]; if (!a) return;
    var id = 'as:' + a.sym;
    if (pendingRemove === id) { pendingRemove = null; Data.removeAsset(a.sym); st.assetrow = Math.min(st.assetrow, assetRowCount() - 1); renderAssetEdit(); toast(tr('Cotação removida', 'Quote removed', 'Cotización quitada')); }
    else { pendingRemove = id; renderAssetEdit(); }
  }

  // MARK: - Opening things

  function launcher(id, name) {
    return function () {
      TV.launch(id, null, function (ok) {
        if (!ok) toast(tr('Não deu para abrir ', "Couldn't open ", 'No se pudo abrir ') + (name || id));
      });
    };
  }

  /** Abre um vídeo no app YouTube da TV (webOS: youtube.leanback.v4 com contentTarget "v=ID"). */
  function launchVideo(videoId) {
    TV.launch('youtube.leanback.v4', {contentTarget: 'v=' + videoId}, function (ok) {
      if (!ok) toast(tr('Não deu para abrir o YouTube', "Couldn't open YouTube", 'No se pudo abrir YouTube'));
    });
  }

  function tvSettings() {
    TV.settings(function (ok) {
      if (!ok) toast(tr('Não deu para abrir os Ajustes da TV', "Couldn't open TV Settings", 'No se pudieron abrir los Ajustes del TV'));
    });
  }

  function liveTV() {
    for (var i = 0; i < inputs.length; i++) if (inputs[i].key === 'live') return inputs[i];
    return null;
  }

  function activate() {
    switch (st.zone) {
      case Z.TOP:
        if (st.top < NTABS) return;
        if (st.top === NTABS) { var live = liveTV(); if (live) launcher(live.id, tr('TV aberta', 'Live TV', 'TV en vivo'))(); }
        else if (st.top === NTABS + 1) { st.zone = Z.SHELF; openDrawer(); st.drawer = 1 < drawerInputs ? 1 : 0; updateFocus(); }
        else openSettings();
        return;
      case Z.CARDS:
        var p = cards[st.card];
        if (p && p.videoId) { launchVideo(p.videoId); return; }
        var app = p && Data.appFor(p.app);
        if (app) launcher(app.id, app.title)();
        return;
      case Z.SHELF:
        if (shelf[st.shelf]) launcher(shelf[st.shelf].id, shelf[st.shelf].title)();
        return;
      case Z.DRAWER:
        if (drawerItems[st.drawer]) drawerItems[st.drawer].run();
        return;
      case Z.APPS:
        if (others[st.grid]) launcher(others[st.grid].id, others[st.grid].title)();
        return;
      case Z.SETTINGS:
        if (rowsNow[st.row]) { rowsNow[st.row].step(1); if (st.zone === Z.SETTINGS) renderSettings(); }
        return;
      case Z.EDIT:
        editShelf(0);
        return;
      case Z.YTEDIT:
        ytAction();
        return;
      case Z.ASSETEDIT:
        assetAction();
        return;
    }
  }

  function selectTab(i) {
    if (i === st.tab) return;
    st.tab = i;
    renderCards();
  }

  function move(dx, dy) {
    var tiles = $('tiles').children, cardNodes = $('cards').children;
    switch (st.zone) {
      case Z.SHELF:
        if (dx) st.shelf = Math.max(0, Math.min(shelf.length - 1, st.shelf + dx));
        else if (dy > 0) { openDrawer(); return; }
        else if (dy < 0) {
          if (cards.length) { st.zone = Z.CARDS; st.card = nearest(cardNodes, centerX(tiles[st.shelf])); }
          else { st.zone = Z.TOP; st.top = st.tab; }
        }
        break;
      case Z.CARDS:
        if (dx) st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));
        else if (dy < 0) { st.zone = Z.TOP; st.top = st.tab; }
        else if (shelf.length) { st.zone = Z.SHELF; st.shelf = nearest(tiles, centerX(cardNodes[st.card])); }
        break;
      case Z.TOP:
        if (dx) {
          st.top = Math.max(0, Math.min(NTABS + 2, st.top + dx));
          if (st.top < NTABS) selectTab(st.top);   // as on Apple TV: focusing a tab selects it
        } else if (dy > 0) {
          if (cards.length) { st.zone = Z.CARDS; st.card = Math.min(cards.length - 1, st.top < NTABS ? 0 : cards.length - 1); }
          else st.zone = Z.SHELF;
        }
        break;
      case Z.DRAWER:
        if (dx) st.drawer = Math.max(0, Math.min(drawerItems.length - 1, st.drawer + dx));
        else if (dy < 0) { closeDrawer(); return; }
        break;
      case Z.APPS:
        var g = st.grid + dx + dy * 5;
        if (g >= 0 && g < others.length && (dx === 0 || Math.floor(g / 5) === Math.floor(st.grid / 5))) st.grid = g;
        break;
      case Z.SETTINGS:
        if (dy) st.row = Math.max(0, Math.min(rowsNow.length - 1, st.row + dy));
        else if (dx && rowsNow[st.row]) {
          var r = rowsNow[st.row];
          if (r.value !== '›') { r.step(dx); renderSettings(); }
        }
        break;
      case Z.EDIT:
        if (dy) st.edit = Math.max(0, Math.min(apps.length - 1, st.edit + dy));
        else if (dx) editShelf(dx);
        break;
      case Z.YTEDIT:
        if (dy) { pendingRemove = null; st.ytrow = Math.max(0, Math.min(ytRowCount() - 1, st.ytrow + dy)); }
        break;
      case Z.ASSETEDIT:
        if (dy) { pendingRemove = null; st.assetrow = Math.max(0, Math.min(assetRowCount() - 1, st.assetrow + dy)); }
        break;
    }
    updateFocus();
  }

  function back() {
    if (editingYt) { closeTextInput(); updateFocus(); return; }
    if (st.zone === Z.YTEDIT) { pendingRemove = null; setClass($('ytedit'), 'open', false); openSettings(); updateFocus(); return; }
    if (st.zone === Z.ASSETEDIT) { pendingRemove = null; setClass($('assetedit'), 'open', false); openSettings(); updateFocus(); return; }
    if (st.zone === Z.EDIT) { setClass($('shelfedit'), 'open', false); openSettings(); st.row = rowsNow.length - 2; updateFocus(); return; }
    if (sheetOpen()) { closeSheets(); return; }
    if (st.zone === Z.DRAWER) { closeDrawer(); return; }
    if (st.zone !== Z.SHELF && shelf.length) { st.zone = Z.SHELF; updateFocus(); return; }
    TV.back();
  }

  /** The pointer focuses what it's over (the Magic Remote, or a mouse when previewing). */
  function hover(node, zone, index) {
    node.onmouseover = function () {
      if (saverOn || (sheetOpen() !== (zone === Z.APPS || zone === Z.SETTINGS || zone === Z.EDIT || zone === Z.YTEDIT || zone === Z.ASSETEDIT))) return;
      if (zone === Z.DRAWER && st.zone !== Z.DRAWER) return;
      if (zone !== Z.DRAWER && st.zone === Z.DRAWER && zone !== Z.SHELF) return;
      if (zone === Z.SHELF && st.zone === Z.DRAWER) closeDrawer();
      st.zone = zone;
      if (zone === Z.TOP) { st.top = index; if (index < NTABS) selectTab(index); }
      else if (zone === Z.CARDS) st.card = index;
      else if (zone === Z.SHELF) st.shelf = index;
      else if (zone === Z.DRAWER) st.drawer = index;
      else if (zone === Z.APPS) st.grid = index;
      else if (zone === Z.SETTINGS) st.row = index;
      else if (zone === Z.EDIT) st.edit = index;
      else if (zone === Z.YTEDIT) st.ytrow = index;
      else if (zone === Z.ASSETEDIT) st.assetrow = index;
      updateFocus();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  // MARK: - Toast

  var toastTimer = 0;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    setClass(t, 'on', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { setClass(t, 'on', false); }, 6000);
  }

  // MARK: - Night, clock, screensaver

  function checkNight() {
    var t = Prefs.theme(), dark = {meianoite: 1, oled: 1, carvao: 1}, light = {areia: 1, nevoa: 1, salvia: 1};
    var night = Data.isNight(Date.now());
    body.setAttribute('data-theme', (dark[t] || light[t]) ? t : (night ? 'meianoite' : 'areia'));
    setClass(body, 'night', night);
  }

  var saverOn = false, idleAt = Date.now(), saverIndex = 0, saverTimer = 0, SAVER_AFTER = 5 * 60000;

  function showSaver() {
    var photos = Data.showcase().filter(function (p) { return p.backdrop && Data.appFor(p.app); });
    saverOn = true;
    var s = $('saver');
    s.innerHTML = '';
    var a = el('div', 'photo', s), b = el('div', 'photo', s);
    el('div', 'shade', s);
    var clock = el('div', 'clock', s);
    el('div', 'time', clock);
    el('div', 'date', clock);
    el('div', 'title', clock);
    var front = a;
    function next() {
      if (!saverOn) return;
      var p = photos.length ? photos[saverIndex++ % photos.length] : null;
      var back = front === a ? b : a;
      if (p) {
        back.style.backgroundImage = 'url(' + Data.image(p.backdrop, 'original') + ')';
        back.style.webkitTransform = back.style.transform = 'scale(1.0)';
        clock.lastChild.textContent = p.title;
        setTimeout(function () {
          setClass(back, 'on', true);
          setClass(front, 'on', false);
          back.style.webkitTransform = back.style.transform = 'scale(1.08) translateX(-1.5%)';
          front = back;
        }, 60);
      }
      tickSaverClock(clock);
      saverTimer = setTimeout(next, 12000);
    }
    setClass(s, 'on', true);
    next();
  }

  function tickSaverClock(clock) {
    var d = new Date();
    clock.firstChild.textContent = Data.time(d.getTime()).replace(/ (AM|PM)$/, '');
    try {
      clock.children[1].textContent = d.toLocaleDateString(I18N.locale(), {weekday: 'long', day: 'numeric', month: 'long'});
    } catch (e) {
      clock.children[1].textContent = d.toDateString();
    }
  }

  function hideSaver() {
    saverOn = false;
    clearTimeout(saverTimer);
    setClass($('saver'), 'on', false);
  }

  function poke() {
    idleAt = Date.now();
    if (saverOn) { hideSaver(); return true; }
    return false;
  }

  // MARK: - Keys

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (editingYt) return;   // enquanto digita o canal, o teclado virtual e o input cuidam das teclas
    if (poke()) { e.preventDefault(); return; }   // the first press only wakes the screen
    if (k === TV.keys.left) move(-1, 0);
    else if (k === TV.keys.right) move(1, 0);
    else if (k === TV.keys.up) move(0, -1);
    else if (k === TV.keys.down) move(0, 1);
    else if (k === TV.keys.ok) activate();
    else if (k === TV.keys.back || k === 27 || k === 8) back();
    else return;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function () { poke(); });

  // MARK: - Start

  function renderAll() {
    renderTop();
    renderQuotes();
    cards = [];
    renderCards();
    renderShelf();
    renderDrawer();
    renderClock();
    checkNight();
    if (st.zone === Z.SETTINGS) renderSettings();
    updateFocus();
  }

  function loadApps(done) {
    TV.apps(function (list) {
      apps = list;
      // Mídia local (HD/pendrive externo): atalho para o navegador de mídia da LG, sempre presente no shelf.
      if (!apps.some(function (a) { return /mediadiscovery|com\.webos\.app\.media/.test(a.id); })) {
        apps.push({id: 'com.webos.app.mediadiscovery', title: tr('Mídia local', 'Local Media', 'Medios locales'), icon: '', color: '#3E6FD6'});
      }
      Data.setApps(apps);
      pickShelf();
      TV.inputs(function (list2) {
        inputs = list2;
        if (done) done();
      });
    });
  }

  /** Back to the home screen (the app was opened again): the shelf, everything closed, the first tab. */
  function reset() {
    hideSaver();
    closeSheets();
    st.zone = Z.SHELF;
    st.shelf = 0;
    if (st.tab !== 0) { st.tab = 0; renderCards(); }
    updateFocus();
  }

  Data.onChange(function () {
    renderQuotes();
    updateTitle();
    renderCards();
    renderPanels();
    checkNight();
  });

  function reopened() {
    // LG: with handlesRelaunch the app has to come to the front itself, or opening it again while it runs shows nothing.
    if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate();
    reset();
    loadApps(function () { renderShelf(); renderDrawer(); Data.refresh(); });
  }

  window.addEventListener('resize', fit);
  document.addEventListener('webOSRelaunch', reopened);   // LG: opened again while running
  window.addEventListener('appcontrol', reopened);        // Samsung: the same
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hideSaver(); return; }
    idleAt = Date.now();
    loadApps(function () { renderShelf(); renderDrawer(); updateFocus(); Data.refresh(); });
  });

  I18N.set(Prefs.language());
  fit();
  renderTop();
  loadApps(function () {
    renderAll();
    Data.refresh();
  });
  setInterval(function () {
    renderClock();
    updateTitle();
    checkNight();
    Data.refresh();
    if (!saverOn && !sheetOpen() && Date.now() - idleAt > SAVER_AFTER) showSaver();
    if (saverOn) tickSaverClock($('saver').querySelector('.clock'));
  }, 30000);

  // For the browser preview and tests.
  window.FreeMyTV = {state: st, move: move, activate: activate, back: back, showSaver: showSaver, hideSaver: hideSaver, toast: toast};
})();
