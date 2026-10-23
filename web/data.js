/*
 * What the home screen shows, kept in localStorage so it opens with numbers:
 *  - the picks: what's trending this week and recent releases, only from the streaming apps on this TV (TMDB, with
 *    the person's own free key from config.properties), three per hour;
 *  - weather, sunrise and sunset (Open-Meteo, every 30 min) and optional crypto prices (Binance, every 5 min).
 * Settings changed on the TV (Prefs) win over config.properties, as on Android. Built without a city (--generic), the
 * TV's time zone gives the city, and its country the currency and the region (zones.js).
 */
var CONFIG = window.CONFIG || {};

var Place = (function () {
  'use strict';
  var EURO = /^(AT|BE|CY|DE|EE|ES|FI|FR|GR|HR|IE|IT|LT|LU|LV|MT|NL|PT|SI|SK)$/;

  /** A time zone's main city: {country, lat, lon, name}, or null. */
  function zone(name) {
    var all = window.ZONES || {}, v = all[name], hops = 0;
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = all[name]; }
    if (!v) return null;
    var p = v.split(',');
    return {country: p[0], lat: p[1], lon: p[2], name: p[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ')};
  }

  var tz = zone(TV.zone()), set = CONFIG.latitude !== '' && CONFIG.latitude !== undefined;
  var country = (CONFIG.tmdbRegion || (tz ? tz.country : '') || 'US').toUpperCase();
  return {
    lat: set ? CONFIG.latitude : tz ? tz.lat : '40.7128',
    lon: set ? CONFIG.longitude : tz ? tz.lon : '-74.0060',
    city: CONFIG.city || (!set && tz ? tz.name : ''),
    country: country,
    currency: (CONFIG.currency || (country === 'BR' ? 'BRL' : EURO.test(country) ? 'EUR' : 'USD')).toUpperCase(),
    /** Fahrenheit for TVs in the US (by their time zone, or their language when it doesn't tell). */
    fahrenheit: tz ? tz.country === 'US' : /-US$/i.test(navigator.language || '')
  };
})();

var Prefs = (function () {
  'use strict';
  var KEY = 'fmtv.prefs';
  var v = {};
  try { v = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pick(name, fallback) { return v[name] === undefined ? fallback : v[name]; }
  return {
    version: 0,
    language: function () { return pick('language', CONFIG.language || 'auto'); },
    temperature: function () { return pick('temperature', CONFIG.temperature || 'auto'); },
    theme: function () { return pick('theme', 'auto'); },
    weather: function () { return pick('weather', true); },
    quotes: function () { return pick('quotes', CONFIG.showCrypto !== false); },
    coin: function (i) { var c = pick('coins', null); return c ? c[i] !== false : true; },
    shelf: function () { return pick('shelf', null); },
    ytChannels: function () { return pick('ytChannels', null); },
    assets: function () { return pick('assets', null); },
    tmdbKey: function () { return pick('tmdbKey', ''); },         // chave colada nos Ajustes (prioridade sobre config.properties)
    youtubeKey: function () { return pick('youtubeKey', ''); },
    tabs: function () { return pick('tabs', null); },            // ordem/visibilidade das abas; null = padrão
    weatherDays: function () { return pick('weatherDays', 4); }, // dias do clima (hoje + N-1)
    currency: function () { return pick('currency', 'auto'); },  // moeda de referência do câmbio
    clock: function () { return pick('clock', 'auto'); },        // formato de hora: auto/24/12
    set: function (name, value) { v[name] = value; save(); this.version++; },
    setCoin: function (i, on) {
      var c = (pick('coins', null) || [true, true, true, true, true, true]).slice();
      c[i] = on;
      this.set('coins', c);
    }
  };
})();

var Data = (function () {
  'use strict';

  function store(key, value) { try { localStorage.setItem('fmtv.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.' + key)); } catch (e) { return null; } }

  /** GET a JSON document; done(error, json). */
  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 10000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error(x.status === 401 ? 'TMDB rejected the key' : 'HTTP ' + x.status)); return; }
      var json;
      try { json = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Weather

  var PLACE = Place.lat + ',' + Place.lon;
  var weather = null, weatherAt = 0, fetchingWeather = false;
  (function () {
    var w = stored('weather2');   // weather2: invalida o cache antigo de 3 dias (agora N dias + sol por dia)
    if (w && w.place === PLACE) { weather = parseWeather(w.body); weatherAt = (w.days >= Prefs.weatherDays()) ? w.at : 0; }   // menos dias no cache do que o pedido → rebusca
  })();

  /** "2026-10-20T18:31" at the location (Open-Meteo's local time) → epoch ms. */
  function localTime(iso, offsetSeconds) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || '');
    if (!m) return 0;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000;
  }

  function parseWeather(o) {
    if (!o || !o.current) return null;
    var off = o.utc_offset_seconds || 0, now = Date.now();
    var w = {
      temp: o.current.temperature_2m, code: o.current.weather_code, isDay: o.current.is_day !== 0,
      max: o.daily.temperature_2m_max[0], min: o.daily.temperature_2m_min[0],
      sunrise: localTime(o.daily.sunrise[0], off), sunset: localTime(o.daily.sunset[0], off), hours: [], days: []
    };
    var dl = o.daily;
    for (var k = 0; dl && dl.time && k < dl.time.length && w.days.length < Prefs.weatherDays(); k++) {
      w.days.push({date: dl.time[k], max: dl.temperature_2m_max[k], min: dl.temperature_2m_min[k],
        code: dl.weather_code ? dl.weather_code[k] : -1,
        sunrise: dl.sunrise ? localTime(dl.sunrise[k], off) : 0, sunset: dl.sunset ? localTime(dl.sunset[k], off) : 0});
    }
    var hr = o.hourly;
    for (var i = 0; hr && i < hr.time.length && w.hours.length < 6; i++) {
      var at = localTime(hr.time[i], off);
      if (at <= now) continue;
      w.hours.push({at: at, temp: hr.temperature_2m[i], code: hr.weather_code[i], day: !hr.is_day || hr.is_day[i] !== 0});
    }
    return w;
  }

  function refreshWeather() {
    var now = Date.now();
    if (fetchingWeather || (now - weatherAt < 30 * 60000 && now >= weatherAt)) return;
    fetchingWeather = true;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + Place.lat + '&longitude=' + Place.lon
        + '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset'
        + '&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=' + Prefs.weatherDays();
    get(url, {}, function (err, body) {
      fetchingWeather = false;
      if (err) return;
      weather = parseWeather(body);
      weatherAt = Date.now();
      store('weather2', {place: PLACE, body: body, at: weatherAt, days: Prefs.weatherDays()});
      changed();
    });
  }

  // MARK: - Prices

  // Cotações da Binance: cripto em USDC + câmbio (o dólar vem de USDTBRL; o euro de EURUSDT × USDTBRL, pois a
  // Binance não lista EURBRL direto). Lista PADRÃO — o que o usuário adiciona/remove na tela "Cotações" tem prioridade.
  // Moeda de referência do câmbio = a moeda local (BRL no Brasil). Cripto fica sempre em USD;
  // moedas estrangeiras são cotadas nessa moeda local. Sem seleção manual.
  function refCurrency() { return Place.currency; }
  // Cripto sempre em USD; as linhas de câmbio mudam conforme a moeda escolhida.
  function defaultQuotes(cur) {
    var crypto = [
      {sym: 'BTC', pair: 'BTCUSDC', unit: 'USD'},
      {sym: 'ETH', pair: 'ETHUSDC', unit: 'USD'},
      {sym: 'SOL', pair: 'SOLUSDC', unit: 'USD'},
      {sym: 'XRP', pair: 'XRPUSDC', unit: 'USD'}
    ];
    if (cur === 'USD') return crypto.concat([
      {sym: 'EUR', pair: 'EURUSDT', unit: 'USD'},
      {sym: 'GBP', pair: 'GBPUSDT', unit: 'USD'}
    ]);
    if (cur === 'EUR') return crypto.concat([
      {sym: 'USD', div: ['EURUSDT'], unit: 'EUR'},                 // USD/EUR = 1 / EURUSDT
      {sym: 'GBP', mult: ['GBPUSDT'], div: ['EURUSDT'], unit: 'EUR'} // GBP/EUR = GBPUSDT / EURUSDT
    ]);
    return crypto.concat([                                          // BRL (padrão)
      {sym: 'USD', pair: 'USDTBRL', unit: 'BRL'},
      {sym: 'EUR', mult: ['EURUSDT', 'USDTBRL'], unit: 'BRL'}
    ]);
  }
  function assetsList() {
    var saved = Prefs.assets();
    return (saved && saved.length) ? saved : defaultQuotes(refCurrency());
  }
  function pairLabel(q) { return q.sym + '/' + q.unit; }   // ex.: BTC/USD, USD/BRL

  // Moedas fiat suportadas pelo provedor de câmbio (Frankfurter / ECB).
  var FIAT = {AUD:1, BGN:1, BRL:1, CAD:1, CHF:1, CNY:1, CZK:1, DKK:1, EUR:1, GBP:1, HKD:1, HUF:1, IDR:1, ILS:1, INR:1, ISK:1, JPY:1, KRW:1, MXN:1, MYR:1, NOK:1, NZD:1, PHP:1, PLN:1, RON:1, SEK:1, SGD:1, THB:1, TRY:1, USD:1, ZAR:1};
  function isFiat(sym) { return !!FIAT[(sym || '').toUpperCase()]; }
  function fiatKey(sym, unit) { return sym.toUpperCase() + '>' + unit.toUpperCase(); }

  var prices = [], changes = [], pricesAt = 0, fetchingPrices = false;
  var tick = {};                               // último ticker da Binance por símbolo: {last, pct}
  var fx = {}, fxAt = 0, fetchingFx = false;   // câmbio fiat (Frankfurter): 'USD>BRL' -> {last, pct}
  function resetPrices() { prices = []; changes = []; for (var i = 0; i < assetsList().length; i++) { prices.push(NaN); changes.push(NaN); } }
  resetPrices();

  /** Símbolos da Binance a buscar (só das cotações não-fiat da lista efetiva). */
  function pairsNeeded() {
    var set = {}, out = [], l = assetsList();
    for (var i = 0; i < l.length; i++) {
      if (l[i].fiat) continue;
      var ps = (l[i].mult || [l[i].pair]).concat(l[i].div || []);   // multiplicadores e divisores (câmbio inverso/cruzado)
      for (var j = 0; j < ps.length; j++) if (ps[j] && !set[ps[j]]) { set[ps[j]] = true; out.push(ps[j]); }
    }
    return out;
  }
  /** Pares de câmbio fiat a buscar no Frankfurter: {sym, unit} (ignora sym == unit). */
  function fiatNeeded() {
    var out = [], l = assetsList();
    for (var i = 0; i < l.length; i++) if (l[i].fiat && l[i].sym.toUpperCase() !== l[i].unit.toUpperCase()) out.push({sym: l[i].sym.toUpperCase(), unit: l[i].unit.toUpperCase()});
    return out;
  }

  /** Índices das cotações (todas, quando o widget está ligado). */
  function activeCoins() {
    var out = [];
    if (!Prefs.quotes()) return out;
    for (var i = 0; i < assetsList().length; i++) out.push(i);
    return out;
  }

  /** Recalcula prices[]/changes[] do que já está em memória (tick da Binance + fx). Instantâneo, sem rede. */
  function computePrices() {
    var l = assetsList();
    if (prices.length !== l.length) resetPrices();
    for (var k = 0; k < l.length; k++) {
      var q = l[k];
      if (q.fiat) {
        if (q.sym.toUpperCase() === q.unit.toUpperCase()) { prices[k] = 1; changes[k] = 0; continue; }
        var r = fx[fiatKey(q.sym, q.unit)];
        if (r) { prices[k] = r.last; changes[k] = r.pct; }
        continue;
      }
      var muls = q.mult || (q.pair ? [q.pair] : []), divs = q.div || [];
      var val = 1, pct = 0, ok = muls.length > 0;
      for (var m = 0; m < muls.length; m++) { var a = tick[muls[m]]; if (!a) { ok = false; break; } val *= a.last; pct += isNaN(a.pct) ? 0 : a.pct; }
      for (var dq = 0; ok && dq < divs.length; dq++) { var b = tick[divs[dq]]; if (!b || !b.last) { ok = false; break; } val /= b.last; pct -= isNaN(b.pct) ? 0 : b.pct; }
      if (ok) { prices[k] = val; changes[k] = pct; }
    }
  }

  /** Mescla o ticker da Binance em memória. */
  function ingestBinance(listData) {
    var found = 0;
    for (var i = 0; listData && i < listData.length; i++) {
      var last = parseFloat(listData[i].lastPrice), open = parseFloat(listData[i].openPrice);
      tick[listData[i].symbol] = {last: last, pct: open > 0 ? (last - open) / open * 100 : NaN};
      found++;
    }
    return found;
  }
  function parsePrices(listData) { var n = ingestBinance(listData); computePrices(); return n; }   // compat.: carga do cache

  function dayBefore(dateStr) {   // 'YYYY-MM-DD' - 1 dia (o Frankfurter resolve pro dia útil anterior)
    var p = (dateStr || '').split('-');
    var d = new Date(Date.UTC(+p[0], p[1] - 1, +p[2]) - 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  // Câmbio fiat via Frankfurter (ECB, grátis, sem chave): 1 SYM em UNIT = 1 / (rate de SYM com base UNIT).
  // A variação compara com o dia útil ANTERIOR à data da cotação (o ECB publica 1x/dia útil).
  function refreshFx(force) {
    if (force) fxAt = 0;
    var pairs = fiatNeeded();
    if (!pairs.length) { fetchingFx = false; return; }
    var now = Date.now();
    if (fetchingFx || (fxAt && now - fxAt < 30 * 60000 && now >= fxAt)) return;
    fetchingFx = true;
    var byUnit = {};
    for (var i = 0; i < pairs.length; i++) (byUnit[pairs[i].unit] = byUnit[pairs[i].unit] || []).push(pairs[i].sym);
    var units = Object.keys(byUnit), pending = units.length;
    function settle() { if (--pending <= 0) { fetchingFx = false; fxAt = Date.now(); store('fx2', {rates: fx, at: fxAt}); computePrices(); changed(); } }
    units.forEach(function (unit) {
      var syms = byUnit[unit].join(',');
      get('https://api.frankfurter.dev/v1/latest?base=' + unit + '&symbols=' + syms, {}, function (e1, today) {
        if (e1 || !today || !today.rates) { settle(); return; }
        function apply(prev) {
          byUnit[unit].forEach(function (sym) {
            var r = today.rates[sym];
            if (!r) return;
            var val = 1 / r, pct = NaN;
            if (prev && prev.rates && prev.rates[sym]) pct = (val / (1 / prev.rates[sym]) - 1) * 100;
            fx[fiatKey(sym, unit)] = {last: val, pct: pct};
          });
          settle();
        }
        get('https://api.frankfurter.dev/v1/' + dayBefore(today.date) + '?base=' + unit + '&symbols=' + syms, {}, function (e2, prev) { apply(e2 ? null : prev); });
      });
    });
  }

  (function () {
    var p = stored('prices2');
    if (p && p.body && ingestBinance(p.body)) pricesAt = p.at || 0;
    var f = stored('fx2');
    if (f && f.rates) { fx = f.rates; fxAt = f.at || 0; }
    computePrices();
  })();

  function refreshPrices(force) {
    if (force) { pricesAt = 0; resetPrices(); computePrices(); }
    if (!activeCoins().length) return;
    refreshFx(force);                           // câmbio fiat (Frankfurter) em paralelo
    var now = Date.now(), need = pairsNeeded();
    if (!need.length || fetchingPrices || (pricesAt && now - pricesAt < 5 * 60000 && now >= pricesAt)) return;
    fetchingPrices = true;
    var symbols = need.map(function (s) { return '%22' + s + '%22'; }).join(',');
    var path = '/api/v3/ticker/24hr?type=MINI&symbols=%5B' + symbols + '%5D';
    // Binance.com recusa os EUA (HTTP 451); a Binance.US responde a mesma chamada.
    var hosts = ['https://api.binance.com', 'https://api.binance.us'];
    (function next(h) {
      get(hosts[h] + path, {}, function (err, body) {
        if (err || !ingestBinance(body)) {
          if (h + 1 < hosts.length) next(h + 1);
          else fetchingPrices = false;
          return;
        }
        fetchingPrices = false;
        pricesAt = Date.now();
        store('prices2', {body: body, at: pricesAt});
        computePrices();
        changed();
      });
    })(0);
  }

  function assetKnown(sym) {
    var l = assetsList();
    for (var i = 0; i < l.length; i++) if (l[i].sym.toUpperCase() === sym.toUpperCase()) return true;
    return false;
  }

  /** Adiciona cripto (Binance, par USDC/USDT) ou moeda fiat (Frankfurter, cotada na moeda de referência). done(ok, rótuloOuErro). */
  function addAsset(input, done) {
    var sym = (input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!sym) { done(false, tr('vazio', 'empty', 'vacío')); return; }
    if (assetKnown(sym)) { done(false, tr('já está na lista', 'already in the list', 'ya está en la lista')); return; }
    if (isFiat(sym)) {
      var unit = refCurrency().toUpperCase();
      if (sym === unit) { done(false, tr('essa já é a moeda de referência', 'that is the reference currency', 'esa es la moneda de referencia')); return; }
      get('https://api.frankfurter.dev/v1/latest?base=' + unit + '&symbols=' + sym, {}, function (err, body) {
        if (!err && body && body.rates && body.rates[sym]) {
          var list = assetsList().slice();
          list.push({sym: sym, unit: unit, fiat: true});
          Prefs.set('assets', list);
          refreshPrices(true); changed();
          done(true, sym + '/' + unit);
        } else {
          done(false, tr('moeda não suportada', 'currency not supported', 'moneda no admitida'));
        }
      });
      return;
    }
    function tryQuote(quote, next) {
      get('https://api.binance.com/api/v3/ticker/price?symbol=' + sym + quote, {}, function (err, body) {
        if (!err && body && body.price) {
          var list = assetsList().slice();
          list.push({sym: sym, pair: sym + quote, unit: 'USD'});
          Prefs.set('assets', list);
          refreshPrices(true); changed();
          done(true, sym);
        } else next();
      });
    }
    tryQuote('USDC', function () { tryQuote('USDT', function () { done(false, tr('não achei (cripto na Binance / moeda no Frankfurter)', 'not found (crypto on Binance / currency on Frankfurter)', 'no encontrado')); }); });
  }

  function removeAsset(sym) {
    Prefs.set('assets', assetsList().filter(function (q) { return q.sym !== sym; }));
    refreshPrices(true); changed();
  }

  // MARK: - YouTube (últimos vídeos dos canais que o Filemon acompanha, via uploads playlists)

  var YT_KEY = (Prefs.youtubeKey() || CONFIG.youtubeKey || '').trim();

  /** Lista do config: "uploads|Nome;;uploads|Nome" → [{uploads, title}] (aceita também só os IDs, formato antigo). */
  function parseChannels(str) {
    var out = [];
    (str || '').split(';;').forEach(function (part) {
      part = part.trim(); if (!part) return;
      var bar = part.indexOf('|'), up = (bar >= 0 ? part.slice(0, bar) : part).trim();
      if (up) out.push({uploads: up, title: bar >= 0 ? part.slice(bar + 1).trim() : up});
    });
    return out;
  }
  var YT_DEFAULT = parseChannels(CONFIG.youtubeChannels);

  /** Canais efetivos: os que o usuário salvou nos Ajustes têm prioridade; senão, os do config. */
  function ytChannels() {
    var saved = Prefs.ytChannels();
    return (saved && saved.length) ? saved : YT_DEFAULT;
  }

  var ytVideos = [], ytAt = 0, fetchingYt = false;
  (function () {
    var y = stored('youtube2');
    if (y && y.v) { ytVideos = y.v; ytAt = y.at; }
  })();

  function refreshYouTube(force) {
    var chans = ytChannels(), now = Date.now();
    if (force) ytAt = 0;
    if (!YT_KEY || !chans.length || fetchingYt || (now - ytAt < 30 * 60000 && now >= ytAt && ytVideos.length)) return;
    fetchingYt = true;
    var all = [], left = chans.length;
    chans.forEach(function (ch) {
      var url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=4&playlistId='
          + encodeURIComponent(ch.uploads) + '&key=' + encodeURIComponent(YT_KEY);
      get(url, {}, function (err, body) {
        if (!err && body && body.items) {
          for (var i = 0; i < body.items.length; i++) {
            var s = body.items[i].snippet, rid = s.resourceId || {};
            if (!rid.videoId || !s.thumbnails) continue;
            var th = s.thumbnails.high || s.thumbnails.medium || s.thumbnails.default || {};
            all.push({title: s.title, videoId: rid.videoId, chId: ch.uploads,
              channel: ch.title || s.videoOwnerChannelTitle || s.channelTitle || '', thumb: th.url || '', at: s.publishedAt || ''});
          }
        }
        if (--left === 0) {
          all.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
          // 1 vídeo por canal (o mais recente de cada), para nenhum canal dominar a lista.
          var seen = {}, dedup = [];
          for (var k = 0; k < all.length; k++) { if (!seen[all[k].chId]) { seen[all[k].chId] = 1; dedup.push(all[k]); } }
          ytVideos = dedup;
          ytAt = Date.now();
          fetchingYt = false;
          store('youtube2', {v: dedup, at: ytAt});
          changed();
        }
      });
    });
  }

  /** Grava o canal (snippet+contentDetails) na lista do usuário. done(ok, nomeOuErro). */
  function saveChannel(item, done) {
    var up = item.contentDetails.relatedPlaylists.uploads, title = item.snippet.title;
    var list = ytChannels().slice();
    for (var i = 0; i < list.length; i++) if (list[i].uploads === up) { done(false, tr('já está na lista', 'already in the list', 'ya está en la lista')); return; }
    list.unshift({uploads: up, title: title});
    Prefs.set('ytChannels', list);
    refreshYouTube(true);
    done(true, title);
  }

  /** Resolve um @handle / link / nome e adiciona o canal à lista. done(ok, nomeOuErro). */
  function addYouTubeChannel(input, done) {
    var h = (input || '').trim().replace(/^.*youtube\.com\//i, '').replace(/^@/, '').replace(/[\/?].*$/, '').trim();
    if (!h) { done(false, tr('vazio', 'empty', 'vacío')); return; }
    if (!YT_KEY) { done(false, tr('sem chave', 'no key', 'sin clave')); return; }
    get('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=@' + encodeURIComponent(h) + '&key=' + encodeURIComponent(YT_KEY), {}, function (err, body) {
      var items = body && body.items;
      if (!err && items && items.length) { saveChannel(items[0], done); return; }
      // fallback: busca por nome
      get('https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=' + encodeURIComponent(h) + '&key=' + encodeURIComponent(YT_KEY), {}, function (e2, b2) {
        var it = b2 && b2.items && b2.items[0];
        if (e2 || !it) { done(false, tr('não encontrado', 'not found', 'no encontrado')); return; }
        get('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=' + encodeURIComponent(it.snippet.channelId) + '&key=' + encodeURIComponent(YT_KEY), {}, function (e3, b3) {
          var ci = b3 && b3.items && b3.items[0];
          if (e3 || !ci) { done(false, tr('não encontrado', 'not found', 'no encontrado')); return; }
          saveChannel(ci, done);
        });
      });
    });
  }

  function removeYouTubeChannel(up) {
    Prefs.set('ytChannels', ytChannels().filter(function (c) { return c.uploads !== up; }));
    refreshYouTube(true);
  }

  // MARK: - Picks (TMDB)

  var KEY = (Prefs.tmdbKey() || CONFIG.tmdbKey || '').trim();
  var REGION = Place.country;
  var API = 'https://api.themoviedb.org/3';

  /** Service name on TMDB (part of it, lowercase) → our key, how to find its app on the TV (id, name), its name. */
  var SERVICES = [
    ['netflix', 'netflix', /^netflix$/, /netflix/i, 'Netflix'],
    ['prime video', 'prime', /^amazon$/, /prime video|amazon/i, 'Prime Video'],
    ['disney', 'disney', /disney/, /disney/i, 'Disney+'],
    ['hulu', 'hulu', /^hulu/, /hulu/i, 'Hulu'],
    ['paramount', 'paramount', /paramount|cbs/, /paramount/i, 'Paramount+'],
    ['peacock', 'peacock', /peacock/, /peacock/i, 'Peacock'],
    ['globoplay', 'globoplay', /globoplay/, /globoplay/i, 'Globoplay'],
    ['max', 'max', /hbo|wbd|\.max/, /^(hbo )?max$|hbo max/i, 'Max'],
    ['apple tv', 'appletv', /appletv|apple\.tv/, /apple tv/i, 'Apple TV'],
    ['hotstar', 'hotstar', /hotstar/, /hotstar/i, 'JioHotstar'],
    ['crunchyroll', 'crunchyroll', /crunchyroll/, /crunchyroll/i, 'Crunchyroll']
  ];

  var installed = [];   // the TV's apps, from TV.apps()

  /** The installed app for a service key, or null. */
  function appFor(key) {
    for (var s = 0; s < SERVICES.length; s++) {
      if (SERVICES[s][1] !== key) continue;
      for (var i = 0; i < installed.length; i++) {
        if (SERVICES[s][2].test(installed[i].id) || SERVICES[s][3].test(installed[i].title)) return installed[i];
      }
    }
    return null;
  }

  function service(providerName) {
    var n = (providerName || '').toLowerCase();
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      if (s[0] === 'max' ? /\bmax\b/.test(n) : n.indexOf(s[0]) >= 0) return s;
    }
    return null;
  }

  function tmdb(path, done) {
    var bearer = KEY.indexOf('eyJ') === 0;   // read access token (v4) or API key (v3)
    var url = API + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(KEY));
    get(url, bearer ? {Authorization: 'Bearer ' + KEY, Accept: 'application/json'} : {Accept: 'application/json'}, done);
  }

  var cache = stored('recs') || {};
  var picks = cache.picks || [], listAt = cache.listAt || 0, period = cache.period, listLang = cache.lang || '', stamp = cache.stamp || '';
  var fetchingRecs = false, failedAt = 0, recsError = '';

  function saveRecs() { store('recs', {picks: picks, listAt: listAt, period: period, lang: listLang, stamp: stamp}); }

  function hourPeriod(d) {
    var h = d.getHours();
    return h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2;
  }

  function sourceStamp() {
    var s = KEY.length + ':' + KEY.slice(-6) + ':' + REGION + (CONFIG.hideAnimation ? ':no-animation' : '');
    for (var i = 0; i < SERVICES.length; i++) s += appFor(SERVICES[i][1]) ? '1' : '0';
    return s;
  }

  function franchise(title) {
    var t = (title || '').toLowerCase(), cut = t.indexOf(':');
    if (cut < 0) cut = t.indexOf(' - ');
    return (cut > 0 ? t.slice(0, cut) : t).replace(/^\s+|\s+$/g, '');
  }

  /** This hour's 3 picks: movies ("movie"), shows ("tv") or both (null). */
  function now(kind, n) {
    n = n || 3;
    var list = [];
    if (!KEY) return list;
    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      if ((kind === null || kind === p.kind) && (!p.detailed || (p.app && appFor(p.app)))) list.push(p);
    }
    if (!list.length) return list;
    var hour = Math.floor(Date.now() / 3600000), out = [], seen = {};
    for (var j = 0; j < list.length && out.length < n; j++) {
      var q = list[(hour * n + j) % list.length], f = franchise(q.title);
      if (!seen[f]) { seen[f] = true; out.push(q); }
    }
    return out;
  }

  function lang() { return I18N.locale(); }

  function day(offset) {
    var d = new Date(Date.now() + offset * 86400000);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  var GENRES = {
    ru: {"Action & Adventure": "Боевик и приключения", "Sci-Fi & Fantasy": "Фантастика и фэнтези", "War & Politics": "Война и политика", "Kids": "Для детей", "News": "Новости", "Soap": "Мыльная опера", "Talk": "Ток-шоу"},
    pt: {'Action & Adventure': 'Ação e Aventura', 'Sci-Fi & Fantasy': 'Ficção Científica e Fantasia', 'War & Politics': 'Guerra e Política',
      'Kids': 'Infantil', 'News': 'Notícias', 'Soap': 'Novela', 'Talk': 'Entrevistas'},
    es: {'Action & Adventure': 'Acción y Aventura', 'Sci-Fi & Fantasy': 'Ciencia ficción y Fantasía', 'War & Politics': 'Guerra y Política',
      'Kids': 'Infantil', 'News': 'Noticias', 'Soap': 'Telenovela', 'Talk': 'Entrevistas'},
    de: {'Action & Adventure': 'Action & Abenteuer', 'War & Politics': 'Krieg & Politik', 'Kids': 'Kinder', 'News': 'Nachrichten',
      'Soap': 'Seifenoper', 'Talk': 'Talkshow'}
  };

  /** The best backdrop: no text over it, the largest, then the best rated. */
  function bestBackdrop(images) {
    var list = images && images.backdrops, best = null, score = -1;
    for (var i = 0; list && i < list.length; i++) {
      var b = list[i];
      if (!b.file_path) continue;
      var s = (b.iso_639_1 === null ? 1e7 : 0) + Math.min(b.width || 0, 3840) * 100 + (b.vote_average || 0);
      if (s > score) { score = s; best = b.file_path; }
    }
    return best;
  }

  /** Genre, runtime or seasons, and the service it's on among the TV's apps. */
  function details(p, done) {
    tmdb('/' + p.kind + '/' + p.id + '?language=' + lang() + '&append_to_response=watch/providers,images&include_image_language=null,'
        + I18N.lang + ',en', function (err, o) {
      if (err) { done(err); return; }
      var best = bestBackdrop(o.images);
      if (best) p.backdrop = best;
      var parts = [];
      if (p.kind === 'tv') parts.push(tr('Série', 'Series', 'Serie'));
      if (o.genres && o.genres.length) {
        var g = o.genres[0].name, table = GENRES[I18N.lang];
        parts.push(table && table[g] ? table[g] : g);
      }
      if (p.kind === 'movie' && o.runtime > 0) {
        var h = Math.floor(o.runtime / 60), m = o.runtime % 60;
        parts.push(I18N.lang === 'ru' ? (h ? h + ' ч ' + m + ' мин' : m + ' мин') : I18N.lang === 'en' ? (h ? h + 'h ' + m + 'm' : m + 'm') : (h ? h + ' h ' + m + ' min' : m + ' min'));
      } else if (p.kind === 'tv' && o.number_of_seasons > 0) {
        var n = o.number_of_seasons;
        parts.push(I18N.lang === 'ru' ? I18N.count(n, 'сезон', 'сезона', 'сезонов') : tr(n === 1 ? '1 temporada' : n + ' temporadas', n === 1 ? '1 season' : n + ' seasons', n === 1 ? '1 temporada' : n + ' temporadas'));
      }
      var wp = o['watch/providers'], here = wp && wp.results && wp.results[REGION], flat = here && here.flatrate;
      p.app = null;
      for (var i = 0; flat && i < flat.length && !p.app; i++) {
        var s = service(flat[i].provider_name);
        if (s && appFor(s[1])) { p.app = s[1]; p.service = s[4]; }
      }
      if (p.service && p.app) parts.push(p.service);
      p.meta = parts.join(' · ');
      title(p, o, function () {
        p.detailed = true;
        done(null);
      });
    });
  }

  /**
   * Without a title in the TV's language TMDB answers with the original one, so a Korean series on a German TV reads
   * "닥터X: 하얀 마피아의 시대". Then the English title, when TMDB has one (one more request, only for those).
   */
  function title(p, o, done) {
    var field = p.kind === 'movie' ? 'title' : 'name', own = o[field] || p.title;
    p.title = own;
    if (I18N.lang === 'en' || !own || own !== o['original_' + field] || o.original_language === I18N.lang
        || o.original_language === 'en') { done(); return; }
    tmdb('/' + p.kind + '/' + p.id + '?language=en-US', function (err, en) {
      if (!err && en && en[field]) p.title = en[field];
      done();
    });
  }

  /** TMDB's Animation genre (movies and shows: cartoons and anime), left out with hide_animation=true. */
  var ANIMATION = 16;

  function animated(o) {
    for (var i = 0; o.genre_ids && i < o.genre_ids.length; i++) if (o.genre_ids[i] === ANIMATION) return true;
    return false;
  }

  function addPick(list, o, kind) {
    if (!o.backdrop_path) return;
    if (CONFIG.hideAnimation && animated(o)) return;
    list.push({id: o.id, kind: kind, title: kind === 'movie' ? o.title : o.name, backdrop: o.backdrop_path, meta: '', app: null, detailed: false});
  }

  function keyOf(p) { return p.kind + ':' + p.id; }

  function alternate(out, seen, a, b, max) {
    for (var i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
      if (i < a.length && !seen[keyOf(a[i])]) { seen[keyOf(a[i])] = true; out.push(a[i]); }
      if (i < b.length && out.length < max && !seen[keyOf(b[i])]) { seen[keyOf(b[i])] = true; out.push(b[i]); }
    }
  }

  /** Runs fn on each item one after the other (the TV's network is shared with what's playing). */
  function each(items, fn, done) {
    var i = 0;
    (function next() {
      if (i >= items.length) { done(); return; }
      fn(items[i++], next);
    })();
  }

  function fetchList(done) {
    tmdb('/watch/providers/movie?language=' + lang() + '&watch_region=' + REGION, function (err, res) {
      if (err) { done(err); return; }
      var ids = [];
      for (var i = 0; res.results && i < res.results.length; i++) {
        var s = service(res.results[i].provider_name);
        if (s && appFor(s[1])) ids.push(res.results[i].provider_id);
      }
      if (!ids.length) { done(new Error("none of the TV's streaming apps are on TMDB")); return; }
      var common = '&language=' + lang() + '&watch_region=' + REGION + '&with_watch_monetization_types=flatrate&include_adult=false'
          + '&sort_by=popularity.desc&with_watch_providers=' + encodeURIComponent(ids.join('|'))
          + (CONFIG.hideAnimation ? '&without_genres=' + ANIMATION : '');
      var hot = {movie: [], tv: []}, fresh = {movie: [], tv: []};
      each(['movie', 'tv'], function (kind, next) {
        tmdb('/trending/' + kind + '/week?language=' + lang(), function (e, r) {
          var candidates = [];
          for (var j = 0; !e && j < r.results.length && j < 16; j++) addPick(candidates, r.results[j], kind);
          // Trending is only kept when it's on one of the TV's apps: the details say where.
          each(candidates, function (p, n) {
            details(p, function (de) { if (!de && p.app) hot[kind].push(p); n(); });
          }, next);
        });
      }, function () {
        tmdb('/discover/movie?vote_count.gte=30&primary_release_date.gte=' + day(-365) + '&primary_release_date.lte=' + day(0) + common, function (e1, r1) {
          for (var j = 0; !e1 && j < r1.results.length; j++) addPick(fresh.movie, r1.results[j], 'movie');
          tmdb('/discover/tv?vote_count.gte=20&air_date.gte=' + day(-90) + '&air_date.lte=' + day(0) + common, function (e2, r2) {
            for (var k = 0; !e2 && k < r2.results.length; k++) addPick(fresh.tv, r2.results[k], 'tv');
            var list = [], seen = {};
            alternate(list, seen, hot.movie, hot.tv, 24);
            alternate(list, seen, fresh.movie, fresh.tv, 24);
            if (!list.length) { done(new Error('TMDB returned no recommendations')); return; }
            picks = list;
            done(null);
          });
        });
      });
    });
  }

  /** Fetches the list when stale (6 h, a new period of the day, language, key or apps), then this hour's details. */
  function refreshRecs() {
    if (!KEY || fetchingRecs || !installed.length) return;
    var t = Date.now(), p = hourPeriod(new Date()), st = sourceStamp();
    if (st === stamp && failedAt && t - failedAt < 10 * 60000 && t >= failedAt) return;
    var stale = st !== stamp || p !== period || t - listAt > 6 * 3600000 || t < listAt || !picks.length || listLang !== I18N.lang;
    var wanted = all(), missing = false;
    for (var i = 0; i < wanted.length; i++) missing = missing || !wanted[i].detailed;
    if (!stale && !missing) return;
    fetchingRecs = true;
    stamp = st;
    function finish(err) {
      fetchingRecs = false;
      if (err) { recsError = err.message; failedAt = Date.now(); } else { recsError = ''; failedAt = 0; }
      saveRecs();
      changed();
    }
    function detailWanted() {
      var todo = all().filter(function (x) { return !x.detailed; });
      each(todo, function (x, next) { details(x, function () { next(); }); }, function () { finish(null); });
    }
    if (stale) {
      fetchList(function (err) {
        if (err) { finish(err); return; }
        listAt = Date.now();
        period = p;
        listLang = I18N.lang;
        detailWanted();
      });
    } else {
      detailWanted();
    }
  }

  /** This hour's picks for the three tabs, without repeats (the screensaver shows them too). */
  function all() {
    var out = [], seen = {}, kinds = [null, 'movie', 'tv'];
    for (var k = 0; k < kinds.length; k++) {
      var list = now(kinds[k], 7);
      for (var i = 0; i < list.length; i++) if (!seen[keyOf(list[i])]) { seen[keyOf(list[i])] = true; out.push(list[i]); }
    }
    return out;
  }

  // MARK: - Formatting

  function fmt(v, digits) {
    try { return v.toLocaleString(I18N.locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits}); } catch (e) { return v.toFixed(digits); }
  }

  var SYMBOLS = {USD: '$', BRL: 'R$ ', EUR: '€', GBP: '£', JPY: '¥'};

  return {
    city: Place.city,
    currency: Place.currency,
    onChange: function (fn) { listeners.push(fn); },
    setApps: function (apps) { installed = apps; },
    appFor: appFor,
    refresh: function () { refreshWeather(); refreshPrices(); refreshRecs(); refreshYouTube(); },
    hasYouTube: function () { return !!YT_KEY && ytChannels().length > 0; },
    youtube: function (n) { return n ? ytVideos.slice(0, n) : ytVideos.slice(); },
    ytList: function () { return ytChannels().slice(); },
    addYouTubeChannel: addYouTubeChannel,
    removeYouTubeChannel: removeYouTubeChannel,
    settingsChanged: function () { pricesAt = 0; refreshPrices(); changed(); },
    // Chave TMDB colada nos Ajustes: aplica, recarrega os filmes/séries.
    setTmdbKey: function (k) { Prefs.set('tmdbKey', (k || '').trim()); KEY = (Prefs.tmdbKey() || CONFIG.tmdbKey || '').trim(); picks = []; listAt = 0; stamp = ''; recsError = ''; refreshRecs(); changed(); },
    // Chave YouTube colada nos Ajustes: aplica, recarrega os vídeos (e faz a aba YouTube aparecer/sumir).
    setYouTubeKey: function (k) { Prefs.set('youtubeKey', (k || '').trim()); YT_KEY = (Prefs.youtubeKey() || CONFIG.youtubeKey || '').trim(); ytVideos = []; ytAt = 0; refreshYouTube(true); changed(); },
    // Dias do clima: aplica na hora (reparseia o cache, se tiver dias suficientes) e rebusca.
    setWeatherDays: function (n) {
      Prefs.set('weatherDays', n);
      var w = stored('weather2');
      if (w && w.place === PLACE && w.body && w.body.daily && w.body.daily.time && w.body.daily.time.length >= n) { weather = parseWeather(w.body); changed(); }
      weatherAt = 0; refreshWeather();
    },
    // Moeda de referência do câmbio: refaz a lista padrão e rebusca os preços.
    setCurrency: function (c) { Prefs.set('currency', c); refreshPrices(true); changed(); },
    get weather() { return weather; },
    get weatherAt() { return weatherAt; },
    prices: prices,
    changes: changes,
    get pricesAt() { return pricesAt; },
    activeCoins: activeCoins,
    hasKey: function () { return !!KEY; },
    recsError: function () { return recsError; },
    picks: now,
    showcase: all,
    image: function (path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w1280') + path : ''; },

    /** Night at the location: from sunset to sunrise (the last forecast; without one, 6:00 and 18:00). */
    isNight: function (at) {
      var theme = Prefs.theme();
      if (theme === 'dark' || theme === 'meianoite' || theme === 'oled' || theme === 'carvao') return true;
      if (theme === 'light' || theme === 'areia' || theme === 'nevoa' || theme === 'salvia') return false;
      var d = new Date(at), mins = d.getHours() * 60 + d.getMinutes();
      function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
      var rise = hm(weather && weather.sunrise, 360), set = hm(weather && weather.sunset, 1080);
      return mins < rise || mins >= set;
    },

    compact: function (v) {
      if (isNaN(v)) return '—';
      if (v >= 10000) return fmt(v / 1000, 1) + 'k';
      if (v >= 1000) return fmt(v / 1000, 2) + 'k';
      if (v >= 100) return fmt(v, 0);
      return fmt(v, 2);
    },
    money: function (i) {
      var q = assetsList()[i], v = prices[i];
      if (!q) return '';
      var SYMS = {BRL: 'R$ ', EUR: '€', GBP: '£', USD: '$', JPY: '¥', CNY: '¥', CHF: 'CHF ', AUD: 'A$', CAD: 'C$'};
      var s = SYMS[q.unit] || (q.unit + ' ');
      if (isNaN(v)) return s + '—';
      var dp = v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6;   // casas decimais conforme o tamanho do preço
      return s + fmt(v, dp);
    },
    change: function (v) { return isNaN(v) ? '' : (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1) + '%'; },
    degrees: function (v) {
      if (v === undefined || v === null || isNaN(v)) return '—';
      var unit = Prefs.temperature();
      var f = unit === 'F' || (unit === 'auto' && Place.fahrenheit);
      return Math.round(f ? v * 9 / 5 + 32 : v) + '°';
    },
    hour: function (at) {
      var d = new Date(at), h = d.getHours();
      if (I18N.lang === 'en') return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
      if (I18N.lang === 'de') return (h < 10 ? '0' : '') + h + ' Uhr';
      return (I18N.lang === 'es' || I18N.lang === 'ru') ? (h < 10 ? '0' : '') + h + ':00' : h + 'h';
    },
    time: function (at) {
      var d = new Date(at), h = d.getHours(), m = d.getMinutes();
      var c = Prefs.clock();   // auto: 12h só em inglês; senão força 12/24
      var ampm = c === '12' || (c === 'auto' && I18N.lang === 'en');
      if (ampm) return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    },
    /** Short weekday name for a "YYYY-MM-DD" date, in the current language. */
    weekday: function (dateStr) {
      var p = (dateStr || '').split('-');
      if (p.length < 3) return '';
      var idx = new Date(+p[0], p[1] - 1, +p[2]).getDay();
      var pt = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      var en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var es = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      return I18N.lang === 'en' ? en[idx] : I18N.lang === 'es' ? es[idx] : pt[idx];
    },
    /** "12 min ago" when the data is old (no internet), or empty. */
    staleness: function (at, every) {
      if (!at) return '';
      var age = Date.now() - at;
      if (age < every * 2) return '';
      var m = Math.floor(age / 60000), h = Math.floor(m / 60);
      return m < 60 ? tr('há ' + m + ' min', m + ' min ago', 'hace ' + m + ' min') : tr('há ' + h + ' h', h + ' h ago', 'hace ' + h + ' h');
    },
    condition: function (code, day) {
      if (code === undefined || code === null || code < 0) return '';
      if (code === 0) return tr(day ? 'Céu limpo' : 'Noite limpa', 'Clear', day ? 'Despejado' : 'Noche despejada');
      if (code === 1) return tr('Poucas nuvens', day ? 'Mostly Sunny' : 'Mostly Clear', 'Mayormente despejado');
      if (code === 2) return tr('Parcialmente nublado', 'Partly Cloudy', 'Parcialmente nublado');
      if (code === 3) return tr('Nublado', 'Cloudy', 'Nublado');
      if (code === 45 || code === 48) return tr('Neblina', 'Fog', 'Niebla');
      if (code >= 51 && code <= 57) return tr('Garoa', 'Drizzle', 'Llovizna');
      if (code === 65 || code === 67 || code === 82) return tr('Chuva forte', 'Heavy Rain', 'Lluvia fuerte');
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tr('Neve', 'Snow', 'Nieve');
      if (code >= 95) return tr('Tempestade', 'Thunderstorms', 'Tormenta');
      return tr('Chuva', 'Rain', 'Lluvia');
    },
    symbol: function (code, day) {
      if (code <= 1) return day ? 'sunny' : 'clear_night';
      if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
      if (code === 3) return 'cloud';
      if (code === 45 || code === 48) return 'foggy';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
      if (code >= 95) return 'thunderstorm';
      return 'rainy';
    },
    coinName: function (i) { var q = assetsList()[i]; return q ? pairLabel(q) : ''; },
    quoteSym: function (i) { var q = assetsList()[i]; return q ? q.sym : ''; },
    assetList: function () { return assetsList().slice(); },
    addAsset: addAsset,
    removeAsset: removeAsset
  };
})();
