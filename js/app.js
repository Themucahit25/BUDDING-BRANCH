/* ═══════════════════════════════════════════════════════
   BUDDING BRANCH — Mining Mini App
   Telegram WebApp entegrasyonu + kazım motoru
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─────────── Telegram bridge ─────────── */
  const TG = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  function haptic(style) {
    if (!S.settings.haptic) return;
    try {
      if (!TG || !TG.HapticFeedback) return;
      if (style === 'success' || style === 'error' || style === 'warning') {
        TG.HapticFeedback.notificationOccurred(style);
      } else {
        TG.HapticFeedback.impactOccurred(style || 'light');
      }
    } catch (e) { /* sessizce yut */ }
  }

  /* ─────────── Sabitler (denge burada ayarlanır) ─────────── */
  const HOUR = 3600 * 1000;

  const RATE_STEP = 0.01;          // KAZIMI BAŞLAT her basışta hıza eklenen BB/saat
  const START_TIME_MS = 12 * HOUR; // KAZIMI BAŞLAT her basışta eklenen süre
  const BOX_COOLDOWN_MS = 3 * HOUR; // şans kutusu bekleme süresi
  const ADD_TIME_MS = 12 * HOUR;   // +12H butonunun eklediği süre
  const ADD_TIME_DAILY_MAX = 4;    // +12H günlük hak
  const AD_SECONDS = 5;            // ödüllü reklam süresi (gerçek SDK bunu belirler)

  const SAVE_KEY = 'bb_mining_state_v2';
  const TOTAL_SUPPLY = 13300;

  /* ─────────── Durum — her şey 0'dan başlar ─────────── */
  const S = {
    total: 0,            // kazılan toplam BB
    fromMine: 0,
    fromTask: 0,
    fromRef: 0,
    points: 0,           // ★ puan — oyunlardan kazanılır, pazar yerinde harcanır
    rate: 0,             // BB/saat — 0'dan başlar, her BAŞLAT ile artar
    mining: false,
    timeLeft: 0,         // ms
    boxNextAt: 0,        // şans kutusunun tekrar açılabileceği an
    addTimeDay: '',      // +12H günlük sayacın tarihi
    addTimeCount: 0,     // bugün kaç kez +12H alındı
    upgrades: { pick: 0, drill: 0, crew: 0, luck: 0 },
    tasks: {},
    ledger: [],
    lastTick: Date.now(),
    settings: { haptic: true, sound: false, anim: true, notify: true }
  };

  /* ─────────── Günlük sayaç sıfırlama ─────────── */
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function rolloverDaily() {
    const t = todayKey();
    if (S.addTimeDay !== t) { S.addTimeDay = t; S.addTimeCount = 0; }
  }
  function addTimeLeftToday() {
    rolloverDaily();
    return Math.max(0, ADD_TIME_DAILY_MAX - S.addTimeCount);
  }

  /* ─────────── Yükseltmeler — fiyatlar ★ puan cinsinden ─────────── */
  const SHOP = [
    { id: 'pick',  ico: '⛏️', bg: '#fdf1d4', name: 'Elmas Uçlu Kazma', desc: 'Her seviye kazım hızına +%15 ekler.', base: 40,   step: 1.7,  max: 10, mult: 0.15 },
    { id: 'drill', ico: '🛠️', bg: '#e4efff', name: 'Buharlı Matkap',   desc: 'Her seviye kazım hızına +%35 ekler.', base: 200,  step: 1.85, max: 8,  mult: 0.35 },
    { id: 'crew',  ico: '👷', bg: '#e8f6e3', name: 'Madenci Ekibi',    desc: 'Her seviye kazım hızına +%60 ekler.', base: 800,  step: 2.0,  max: 6,  mult: 0.60 },
    { id: 'luck',  ico: '🍀', bg: '#f0e6ff', name: 'Şans Tılsımı',     desc: 'Her seviye kazım hızına +%100 ekler.', base: 3000, step: 2.3,  max: 4,  mult: 1.00 }
  ];

  /* ─────────── Oyunlar — yeni oyun eklemek için buraya bir satır ─────────── */
  const GAMES = [
    { id: 'bbrain', name: 'BB Yağmuru', desc: '60 SN', ready: true },
    { id: 'soon1',  name: 'Yakında',    desc: '—',     ready: false },
    { id: 'soon2',  name: 'Yakında',    desc: '—',     ready: false }
  ];

  /* Oyun ayarları */
  const GAME_MS = 60 * 1000;   // oyun süresi
  const GAME_POINT_PER_BB = 1; // toplanan her BB'nin puan değeri

  const TASKS = [
    { id: 't1', ico: '📢', name: 'Telegram kanalına katıl',   reward: 500,  url: 'https://t.me/telegram' },
    { id: 't2', ico: '💬', name: 'Sohbet grubuna katıl',      reward: 350,  url: 'https://t.me/telegram' },
    { id: 't3', ico: '𝕏', name: "X hesabımızı takip et",      reward: 400,  url: 'https://x.com' },
    { id: 't4', ico: '👥', name: '3 arkadaşını davet et',     reward: 1500, invite: true },
    { id: 't5', ico: '🔥', name: '7 gün üst üste kazım yap',  reward: 2500 },
    { id: 't6', ico: '⭐', name: 'İlk yükseltmeni satın al',  reward: 300 }
  ];

  /* ─────────── DOM kısayolları ─────────── */
  const $ = (id) => document.getElementById(id);
  const el = {
    rate: $('rateValue'), timer: $('timerValue'),
    totalMain: $('totalMain'), totalTail: $('totalTail'),
    floatLayer: $('floatLayer'),
    scene: document.querySelector('.scene-card'),
    actStart: $('actStart'), actBox: $('actBox'), actTime: $('actTime'),
    statReg: $('statRegistered'), statAct: $('statActive'), statSup: $('statSupply'),
    shopGrid: $('shopGrid'), taskList: $('taskList'), ledger: $('ledger'),
    walletBalance: $('walletBalance'), walletUser: $('walletUser'),
    wMine: $('wSrcMine'), wTask: $('wSrcTask'), wRef: $('wSrcRef'),
    pointsMarket: $('pointsMarket'), pointsGames: $('pointsGames'),
    gameGrid: $('gameGrid'),
    modal: $('modal'), modalIco: $('modalIco'), modalTitle: $('modalTitle'),
    modalBody: $('modalBody'), modalYes: $('modalYes'), modalNo: $('modalNo'),
    toastWrap: $('toastWrap')
  };

  /* ─────────── Biçimlendiriciler ─────────── */
  const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const fmt = (n) => nf2.format(n);
  const fmtInt = (n) => nf0.format(n);

  /* Canlı sayaç için tutarı ikiye böler: "12.345,67" + "891"
     LIVE_HEAD kadarı büyük puntoda, kalanı küçük ve soluk akan hanelerde. */
  const LIVE_DECIMALS = 5;   // sayaçta gösterilen toplam ondalık
  const LIVE_HEAD = 2;       // bunun kaçı büyük puntoda
  const LIVE_POW = Math.pow(10, LIVE_DECIMALS);

  function splitAmount(n) {
    if (!isFinite(n) || n < 0) n = 0;
    const frac = String(Math.floor(n * LIVE_POW) % LIVE_POW).padStart(LIVE_DECIMALS, '0');
    return {
      main: nf0.format(Math.floor(n)) + ',' + frac.slice(0, LIVE_HEAD),
      tail: frac.slice(LIVE_HEAD)
    };
  }

  /* Küçük tutarlar için: 1'in altındaysa LIVE_DECIMALS ondalık, üstündeyse 2 */
  function fmtSmall(n) {
    return n >= 1 ? nf2.format(n) : n.toFixed(LIVE_DECIMALS).replace('.', ',');
  }

  function clock(ms) {
    if (ms < 0) ms = 0;
    const t = Math.floor(ms / 1000);
    const h = String(Math.floor(t / 3600)).padStart(2, '0');
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return h + ':' + m + ':' + s;
  }

  function priceOf(item) {
    return Math.round(item.base * Math.pow(item.step, S.upgrades[item.id]));
  }

  /* ─────────── Hız hesabı ─────────── */
  /* S.rate temel hız; pazar yeri açıldığında yükseltmeler bunu çarpar. */
  function currentRate() {
    let mult = 1;
    SHOP.forEach((it) => { mult += it.mult * S.upgrades[it.id]; });
    return S.rate * mult;
  }

  /* ─────────── Bildirimler ─────────── */
  function toast(msg, kind, icon) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = '<i>' + (icon || '✦') + '</i><span>' + msg + '</span>';
    el.toastWrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  let modalResolve = null;
  function ask(opts) {
    return new Promise((resolve) => {
      el.modalIco.textContent = opts.icon || '✦';
      el.modalTitle.textContent = opts.title || '';
      el.modalBody.innerHTML = opts.body || '';
      el.modalYes.textContent = opts.yes || 'ONAYLA';
      el.modalNo.textContent = opts.no || 'VAZGEÇ';
      el.modalNo.style.display = opts.single ? 'none' : '';
      el.modalYes.parentElement.classList.toggle('single', !!opts.single);
      el.modal.classList.add('open');
      modalResolve = resolve;
    });
  }
  function closeModal(v) {
    el.modal.classList.remove('open');
    if (modalResolve) { modalResolve(v); modalResolve = null; }
  }
  el.modalYes.addEventListener('click', () => { haptic('medium'); closeModal(true); });
  el.modalNo.addEventListener('click', () => { haptic('light'); closeModal(false); });
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(false); });

  /* ═══════════════════════════════════════
     ÖDÜLLÜ REKLAM
     ───────────────────────────────────────
     Şu an simülasyon: AD_SECONDS saniye geri sayar, sonra ödülü verir.
     GERÇEK SDK'YA BAĞLARKEN: aşağıdaki gövdeyi sağlayıcının çağrısıyla
     değiştir; izleme tamamlandıysa true, iptal/hata ise false döndür.
     Örn. Adsgram:  return AdController.show().then(() => true, () => false);
     ═══════════════════════════════════════ */
  let adTimer = null;
  function watchRewardedAd(title) {
    return new Promise((resolve) => {
      const view = $('adView');
      const cnt = $('adCount');
      let left = AD_SECONDS;

      $('adTitle').textContent = title || 'Ödülünü kazanıyorsun…';
      cnt.textContent = left;
      view.classList.add('open');

      function finish(ok) {
        clearInterval(adTimer); adTimer = null;
        view.classList.remove('open');
        $('adSkip').onclick = null;
        resolve(ok);
      }
      $('adSkip').onclick = () => { haptic('light'); finish(false); };

      adTimer = setInterval(() => {
        left--;
        cnt.textContent = left > 0 ? left : '✓';
        if (left <= 0) { haptic('success'); setTimeout(() => finish(true), 450); }
      }, 1000);
    });
  }

  function floatGain(text) {
    if (!S.settings.anim) return;
    const f = document.createElement('div');
    f.className = 'fp';
    f.textContent = text;
    f.style.left = (32 + Math.random() * 28) + '%';
    f.style.top = (52 + Math.random() * 16) + '%';
    el.floatLayer.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  }

  /* ─────────── Defter ─────────── */
  function logLedger(icon, title, amount) {
    S.ledger.unshift({
      icon: icon, title: title, amount: amount,
      at: new Date().toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    });
    if (S.ledger.length > 25) S.ledger.length = 25;
  }

  function grant(amount, source, icon, title) {
    S.total += amount;
    if (source === 'task') S.fromTask += amount;
    else if (source === 'ref') S.fromRef += amount;
    else S.fromMine += amount;
    if (title) logLedger(icon, title, amount);
  }

  /* ═══════════════════════════════════════
     KAZIM MOTORU
     ═══════════════════════════════════════ */
  let floatAcc = 0;
  let sessionEnded = false;

  /* Geçen gerçek süreye göre birikim. Hem her ekran karesinde hem saniyelik
     döngüde çağrılabilir; çift saymaz çünkü tüketilen süre S.lastTick ile
     birlikte ilerler. 1 saatlik toplam birikim tam olarak currentRate() kadardır. */
  function accrue() {
    const now = Date.now();
    let dt = now - S.lastTick;
    if (dt <= 0) { S.lastTick = now; return; }
    if (dt > 12 * HOUR) dt = 12 * HOUR;   // aşırı sıçramayı sınırla
    S.lastTick = now;

    if (S.mining && S.timeLeft > 0) {
      const used = Math.min(dt, S.timeLeft);
      const gained = currentRate() * (used / HOUR);
      grant(gained, 'mine');
      floatAcc += gained;
      S.timeLeft -= used;

      if (S.timeLeft <= 0) {
        S.timeLeft = 0;
        S.mining = false;
        sessionEnded = true;
      }
    }

  }

  /* Canlı sayaç — her karede yalnızca iki metin düğümü güncellenir */
  function paintTotal() {
    const a = splitAmount(S.total);
    if (el.totalMain.textContent !== a.main) el.totalMain.textContent = a.main;
    if (el.totalTail.textContent !== a.tail) el.totalTail.textContent = a.tail;
  }

  /* Canlı sayaç döngüsü.
     5 ondalıkta görünür değişim saniyede birkaç kez olduğu için her kareyi
     boyamak gereksiz; LIVE_MS'de bir çalışıyor. rAF kullanılıyor ki sekme
     arka plandayken tarayıcı döngüyü kendiliğinden durdursun. */
  const LIVE_MS = 120;
  let lastPaint = 0;

  function frame(ts) {
    if (ts - lastPaint >= LIVE_MS) {
      lastPaint = ts;
      accrue();
      paintTotal();
    }
    requestAnimationFrame(frame);
  }

  /* Saniyelik döngü: durum geçişleri + tam render */
  function tick() {
    accrue();

    if (sessionEnded) {
      sessionEnded = false;
      logLedger('⛏️', 'Kazım oturumu tamamlandı', 0);
      toast('Kazım süresi doldu. Tekrar başlatabilirsin.', 'warn', '⏳');
      haptic('warning');
      paintLedger();
    }

    if (floatAcc > 0 && S.mining && Math.random() < 0.3) {
      floatGain('+' + fmtSmall(floatAcc) + ' BB');
      floatAcc = 0;
    }

    render();
  }

  /* ═══════════════════════════════════════
     RENDER
     ═══════════════════════════════════════ */
  let lastShopSig = '';

  function setOff(btn, off) { btn.classList.toggle('off', !!off); }

  function render() {
    const now = Date.now();

    el.rate.textContent = fmt(currentRate());
    el.timer.textContent = clock(S.timeLeft);
    paintTotal();
    el.walletBalance.textContent = fmt(S.total);
    el.wMine.textContent = fmt(S.fromMine);
    el.wTask.textContent = fmt(S.fromTask);
    el.wRef.textContent = fmt(S.fromRef);

    /* ── kazım durumu ── */
    const miningOn = S.mining && S.timeLeft > 0;
    el.scene.classList.toggle('is-mining', miningOn);
    el.actStart.classList.toggle('is-on', miningOn);

    /* ── BAŞLAT: kazım sürerken gri + kilitli ── */
    setOff(el.actStart, miningOn);
    const h3 = el.actStart.querySelector('h3');
    const p = el.actStart.querySelector('p');
    if (miningOn) {
      h3.textContent = 'KAZIM AKTİF';
      p.innerHTML = 'Süre bitene<br>kadar çalışır';
    } else {
      h3.textContent = 'KAZIMI BAŞLAT';
      p.innerHTML = 'Kazımı başlat<br>ve BB kazan!';
    }

    /* ── ŞANS KUTUSU: 3 saatte bir açılır, sonra geri sayımla kilitli ── */
    const boxWait = S.boxNextAt - now;
    setOff(el.actBox, boxWait > 0);
    const bP = el.actBox.querySelector('p');
    bP.innerHTML = boxWait > 0
      ? 'Yeni kutu<br><b class="mono">' + clock(boxWait) + '</b>'
      : 'Reklam izle<br>ücretsiz aç!';

    /* ── +12H: günde ADD_TIME_DAILY_MAX hak ── */
    const timeLeftToday = addTimeLeftToday();
    setOff(el.actTime, timeLeftToday <= 0);
    const tP = el.actTime.querySelector('p');
    tP.innerHTML = timeLeftToday > 0
      ? 'Bugün kalan hak<br><b>' + timeLeftToday + ' / ' + ADD_TIME_DAILY_MAX + '</b>'
      : 'Günlük hakkın<br>doldu, yarın gel';


    /* puan rozetleri */
    el.pointsMarket.textContent = fmtInt(S.points);
    el.pointsGames.textContent = fmtInt(S.points);

    /* mağaza yalnız değişince yeniden çizilsin */
    const sig = SHOP.map((i) => S.upgrades[i.id]).join(',') + '|' + S.points;
    if (sig !== lastShopSig) { lastShopSig = sig; paintShop(); }
  }

  /* ─────────── Mağaza ───────────
     Öğeler geçici olarak kapalı. Geri açmak için SHOP_ENABLED = true yeter;
     aşağıdaki çizim kodu ve SHOP dizisi olduğu gibi duruyor. */
  const SHOP_ENABLED = false;

  function paintShop() {
    if (!SHOP_ENABLED) {
      el.shopGrid.innerHTML =
        '<div class="empty">' +
          '<div class="empty-ico">🛒</div>' +
          '<h4>Öğeler yakında</h4>' +
          '<p>Pazar yeri şu an boş. Puanlarını biriktir,<br>yeni öğeler eklendiğinde harcayabilirsin.</p>' +
        '</div>';
      return;
    }
    el.shopGrid.innerHTML = '';
    SHOP.forEach((item) => {
      const lvl = S.upgrades[item.id];
      const maxed = lvl >= item.max;
      const price = priceOf(item);

      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML =
        '<div class="shop-ico" style="background:' + item.bg + '">' + item.ico + '</div>' +
        '<div class="shop-body">' +
          '<h4>' + item.name + '</h4>' +
          '<p>' + item.desc + '</p>' +
          '<span class="shop-lvl">SEVİYE ' + lvl + ' / ' + item.max + '</span>' +
        '</div>' +
        '<button class="shop-buy' + (maxed ? ' maxed' : '') + '"' + (maxed ? ' disabled' : '') + '>' +
          (maxed ? 'MAKS.' : '<span class="buy-price">★ ' + fmtInt(price) + '</span><small>PUAN</small>') +
        '</button>';

      if (!maxed) {
        row.querySelector('.shop-buy').addEventListener('click', () => {
          if (S.points < price) {
            toast('Yetersiz puan. Gereken: ' + fmtInt(price) + ' ★', 'err', '⭐');
            haptic('error');
            return;
          }
          S.points -= price;
          S.upgrades[item.id]++;
          logLedger(item.ico, item.name + ' Sv.' + S.upgrades[item.id] + ' · ' + fmtInt(price) + ' ★', 0);
          toast(item.name + ' seviye ' + S.upgrades[item.id] + ' oldu!', 'ok', '⚡');
          haptic('success');
          lastShopSig = '';
          save(); render(); paintLedger();
        });
      }
      el.shopGrid.appendChild(row);
    });
  }

  /* ═══════════════════════════════════════
     OYUN ALANI
     ═══════════════════════════════════════ */
  function paintGames() {
    el.gameGrid.innerHTML = '';
    GAMES.forEach((g) => {
      const tile = document.createElement('button');
      tile.className = 'game-tile ' + (g.ready ? 'ready' : 'locked');

      const art = g.ready
        ? '<img class="drop" src="assets/coin-sm.png" alt="">' +
          '<img class="drop" src="assets/coin-sm.png" alt="">' +
          '<img class="drop" src="assets/coin-sm.png" alt="">'
        : '<span class="game-lock"><svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm3 8H9V7a3 3 0 0 1 6 0Z"/></svg></span>';

      tile.innerHTML =
        '<span class="game-art">' + art + '</span>' +
        '<span class="game-name">' + g.name + '</span>' +
        '<span class="game-desc">' + (g.ready ? g.desc : 'YAKINDA') + '</span>';

      if (g.ready) tile.addEventListener('click', () => { haptic('medium'); openGame(g.id); });
      el.gameGrid.appendChild(tile);
    });
  }

  /* ─── BB Yağmuru ─── */
  const G = {
    on: false, raf: 0, coins: [], last: 0,
    endsAt: 0, nextSpawn: 0, collected: 0, w: 0, h: 0
  };

  function openGame(id) {
    if (id !== 'bbrain') return;
    $('gName').textContent = 'BB YAĞMURU';
    $('gameView').classList.add('open');
    $('gEnd').classList.remove('open');
    startRound();
  }

  function clearCoins() {
    G.coins.forEach((c) => c.el.remove());
    G.coins = [];
  }

  function startRound() {
    const area = $('gArea');
    clearCoins();
    G.collected = 0;
    $('gScore').textContent = '0';
    $('gTime').textContent = Math.round(GAME_MS / 1000);
    $('gBar').style.width = '100%';
    $('gEnd').classList.remove('open');

    /* 3-2-1 geri sayım, sonra tur başlar */
    const ready = $('gReady');
    const cd = $('gCountdown');
    ready.classList.remove('hide');
    let n = 3;
    cd.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n > 0) { cd.textContent = n; haptic('light'); return; }
      clearInterval(iv);
      ready.classList.add('hide');
      G.on = true;
      G.endsAt = Date.now() + GAME_MS;
      G.nextSpawn = Date.now();
      G.last = performance.now();
      G.w = area.clientWidth;
      G.h = area.clientHeight;
      haptic('success');
      G.raf = requestAnimationFrame(gameFrame);
    }, 700);
  }

  function spawnCoin() {
    const area = $('gArea');
    const size = 54;
    const c = {
      x: 6 + Math.random() * Math.max(1, G.w - size - 12),
      y: -size,
      vy: 150 + Math.random() * 130,           // px/sn
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 120,
      size: size,
      el: document.createElement('span')
    };
    c.el.className = 'bb';
    c.el.innerHTML = '<img src="assets/coin-sm.png" alt="">';
    c.el.addEventListener('pointerdown', (e) => { e.preventDefault(); collectCoin(c); });
    area.appendChild(c.el);
    G.coins.push(c);
  }

  function collectCoin(c) {
    if (c.dead) return;
    c.dead = true;
    G.collected++;
    $('gScore').textContent = fmtInt(G.collected);
    haptic('light');

    /* patlama + uçan +1 */
    c.el.style.setProperty('--px', c.x + 'px');
    c.el.style.setProperty('--py', c.y + 'px');
    c.el.classList.add('pop');
    const el2 = c.el;
    setTimeout(() => el2.remove(), 320);

    const plus = document.createElement('span');
    plus.className = 'gv-plus';
    plus.textContent = '+' + GAME_POINT_PER_BB;
    plus.style.left = c.x + 'px';
    plus.style.top = c.y + 'px';
    $('gArea').appendChild(plus);
    setTimeout(() => plus.remove(), 820);

    G.coins = G.coins.filter((x) => x !== c);
  }

  function gameFrame(ts) {
    if (!G.on) return;
    const dt = Math.min(0.05, (ts - G.last) / 1000);
    G.last = ts;

    const area = $('gArea');
    G.w = area.clientWidth;
    G.h = area.clientHeight;

    const remain = G.endsAt - Date.now();
    if (remain <= 0) { endRound(); return; }

    $('gTime').textContent = Math.ceil(remain / 1000);
    $('gBar').style.width = (remain / GAME_MS * 100) + '%';

    /* zorluk: süre ilerledikçe daha sık düşer.
       Doğma anı mutlak zamana bağlı — kare düşse de hız gerçek zamanla uyumlu kalır. */
    const prog = 1 - remain / GAME_MS;
    const spawnEvery = 620 - prog * 340;      // 620ms → 280ms
    const now = Date.now();
    if (now >= G.nextSpawn) {
      spawnCoin();
      G.nextSpawn = now + spawnEvery;
    }

    /* hareket */
    for (let i = G.coins.length - 1; i >= 0; i--) {
      const c = G.coins[i];
      c.y += c.vy * dt * (1 + prog * 0.35);
      c.rot += c.vr * dt;
      if (c.y > G.h + c.size) {           // kaçırıldı
        c.el.remove();
        G.coins.splice(i, 1);
        continue;
      }
      c.el.style.transform = 'translate3d(' + c.x + 'px,' + c.y + 'px,0) rotate(' + c.rot + 'deg)';
    }

    G.raf = requestAnimationFrame(gameFrame);
  }

  function endRound() {
    G.on = false;
    cancelAnimationFrame(G.raf);
    clearCoins();
    $('gTime').textContent = '0';
    $('gBar').style.width = '0%';

    const earned = G.collected * GAME_POINT_PER_BB;
    S.points += earned;

    $('gEndCollected').textContent = fmtInt(G.collected);
    $('gEndPoints').textContent = '+' + fmtInt(earned);
    $('gEndTotal').textContent = fmtInt(S.points) + ' ★';
    $('gEnd').classList.add('open');
    haptic('success');

    if (earned > 0) logLedger('🎮', 'BB Yağmuru · ' + fmtInt(earned) + ' ★', 0);
    lastShopSig = '';
    save(); render(); paintLedger();
    bumpPoints();
  }

  function closeGame() {
    if (G.on) { endRound(); return; }   // erken çıkışta da toplananlar verilir
    G.on = false;
    cancelAnimationFrame(G.raf);
    clearCoins();
    $('gameView').classList.remove('open');
    $('gEnd').classList.remove('open');
  }

  function bumpPoints() {
    document.querySelectorAll('.pts-pill').forEach((p) => {
      p.classList.remove('bump');
      void p.offsetWidth;
      p.classList.add('bump');
    });
  }

  $('gClose').addEventListener('click', () => { haptic('light'); closeGame(); });
  $('gExit').addEventListener('click', () => {
    haptic('light');
    $('gameView').classList.remove('open');
    $('gEnd').classList.remove('open');
  });
  $('gAgain').addEventListener('click', () => { haptic('medium'); startRound(); });

  /* ─────────── Görevler ─────────── */
  function paintTasks() {
    el.taskList.innerHTML = '';
    TASKS.forEach((t) => {
      const done = !!S.tasks[t.id];
      const row = document.createElement('div');
      row.className = 'task' + (done ? ' done' : '');
      row.innerHTML =
        '<div class="task-ico">' + t.ico + '</div>' +
        '<div class="task-body"><h4>' + t.name + '</h4><span>+' + fmtInt(t.reward) + ' BB</span></div>' +
        '<button class="task-btn">' + (done ? 'ALINDI' : 'GİT') + '</button>';

      if (!done) {
        row.querySelector('.task-btn').addEventListener('click', () => {
          if (t.url && TG && TG.openLink) TG.openLink(t.url);
          else if (t.invite) shareInvite();
          S.tasks[t.id] = true;
          grant(t.reward, 'task', t.ico, t.name);
          toast('Görev tamamlandı: +' + fmtInt(t.reward) + ' BB', 'ok', '🎁');
          haptic('success');
          save(); paintTasks(); paintLedger(); render();
        });
      }
      el.taskList.appendChild(row);
    });
  }

  /* ─────────── Defter görünümü ─────────── */
  function paintLedger() {
    el.ledger.innerHTML = '';
    if (!S.ledger.length) {
      el.ledger.innerHTML = '<div class="led-row"><div class="led-ico">📄</div>' +
        '<div class="led-txt"><b>Henüz işlem yok</b><span>Kazım yaptıkça burada görünecek</span></div></div>';
      return;
    }
    S.ledger.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'led-row';
      const neg = l.amount < 0;
      row.innerHTML =
        '<div class="led-ico">' + l.icon + '</div>' +
        '<div class="led-txt"><b>' + l.title + '</b><span>' + l.at + '</span></div>' +
        '<div class="led-amt' + (neg ? ' neg' : '') + '">' +
          (l.amount === 0 ? '—' : (neg ? '' : '+') + fmt(l.amount)) + '</div>';
      el.ledger.appendChild(row);
    });
  }

  /* ═══════════════════════════════════════
     AKSİYONLAR
     ═══════════════════════════════════════ */
  /* ── KAZIMI BAŞLAT: hıza +RATE_STEP, süreye +12sa, kazım aktif ── */
  el.actStart.addEventListener('click', () => {
    if (S.mining && S.timeLeft > 0) return;   // kilitli
    haptic('medium');

    S.rate += RATE_STEP;
    S.timeLeft += START_TIME_MS;
    S.mining = true;
    S.lastTick = Date.now();

    logLedger('⛏️', 'Kazım başlatıldı · +' + fmt(RATE_STEP) + ' BB/sa', 0);
    toast('Kazım başladı! Saatte ' + fmt(currentRate()) + ' BB', 'ok', '⛏️');
    haptic('success');
    save(); render(); paintLedger();
  });

  /* ── ŞANS KUTUSU: ödüllü reklam, 3 saatte bir ──
     NOT: ödüller henüz eklenmedi; şu an yalnızca açılış + bekleme süresi işliyor. */
  el.actBox.addEventListener('click', async () => {
    if (Date.now() < S.boxNextAt) return;   // kilitli
    haptic('medium');

    const ok = await ask({
      icon: '🎁', title: 'Şans Kutusu',
      body: 'Kısa bir reklam izle, şans kutunu aç.' +
            '<br><br>Her <b>3 saatte bir</b> açılabilir.',
      yes: 'REKLAMI İZLE', no: 'VAZGEÇ'
    });
    if (!ok) return;

    const watched = await watchRewardedAd('Şans kutun açılıyor…');
    if (!watched) {
      toast('Reklam tamamlanmadı, kutu açılmadı.', 'warn', '⚠️');
      return;
    }

    S.boxNextAt = Date.now() + BOX_COOLDOWN_MS;
    logLedger('🎁', 'Şans kutusu açıldı', 0);
    toast('Şans kutusu açıldı! Ödüller yakında eklenecek.', 'ok', '🎁');
    haptic('success');
    save(); render(); paintLedger();
  });

  /* ── +12:00H ZAMAN EKLE: ödüllü reklam, günde ADD_TIME_DAILY_MAX kez ── */
  el.actTime.addEventListener('click', async () => {
    if (addTimeLeftToday() <= 0) return;   // kilitli
    haptic('medium');

    const ok = await ask({
      icon: '⏰', title: '+12 Saat Zaman Ekle',
      body: 'Kısa bir reklam izle, kazım süresine <b>12 saat</b> eklensin.' +
            '<br><br>Kalan süre: <b>' + clock(S.timeLeft) + '</b>' +
            '<br>Bugün kalan hak: <b>' + addTimeLeftToday() + ' / ' + ADD_TIME_DAILY_MAX + '</b>',
      yes: 'REKLAMI İZLE', no: 'VAZGEÇ'
    });
    if (!ok) return;

    const watched = await watchRewardedAd('12 saat ekleniyor…');
    if (!watched) {
      toast('Reklam tamamlanmadı, ödül verilmedi.', 'warn', '⚠️');
      return;
    }

    rolloverDaily();
    S.addTimeCount++;
    S.timeLeft += ADD_TIME_MS;
    logLedger('⏰', '+12 saat kazım süresi', 0);
    toast('+12 saat eklendi · Toplam ' + clock(S.timeLeft), 'ok', '⏰');
    haptic('success');
    save(); render(); paintLedger();
  });

  /* ─────────── Sosyal / davet ─────────── */
  function shareInvite() {
    const me = (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) ? TG.initDataUnsafe.user.id : 'bb';
    const link = 'https://t.me/BuddingBranchBot?start=ref_' + me;
    const text = 'BUDDING BRANCH ile BB kaz! Benim davetimle başla, ikimiz de bonus alalım.';
    const url = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text);
    if (TG && TG.openTelegramLink) TG.openTelegramLink(url);
    else window.open(url, '_blank');
  }

  $('btnSocial').addEventListener('click', () => { haptic('light'); shareInvite(); });
  $('btnInvite').addEventListener('click', () => {
    haptic('light');
    grant(250, 'ref', '👥', 'Davet bonusu');
    toast('Davet linkin paylaşıldı · +250 BB bonus', 'ok', '👥');
    shareInvite(); save(); render(); paintLedger();
  });

  $('btnBell').addEventListener('click', () => {
    haptic('light');
    document.querySelector('.badge-dot').style.display = 'none';
    ask({
      icon: '🔔', title: 'Bildirimler',
      body: '<b>Yeni sezon başladı!</b><br>Kazım hızları %10 arttı.<br><br>' +
            '<b>Pazar yeri güncellendi</b><br>Şans Tılsımı artık satın alınabilir.',
      yes: 'TAMAM', single: true
    });
  });

  $('btnWithdraw').addEventListener('click', async () => {
    haptic('medium');
    if (S.total < 10000) {
      toast('Minimum çekim tutarı 10.000 BB', 'err', '🔒');
      haptic('error');
      return;
    }
    const ok = await ask({
      icon: '💸', title: 'Çekim Talebi',
      body: 'Bakiyen: <b>' + fmt(S.total) + ' BB</b><br>Çekim talebin işleme alınacak ve 24 saat içinde cüzdanına aktarılacak.',
      yes: 'TALEP OLUŞTUR', no: 'VAZGEÇ'
    });
    if (!ok) return;
    toast('Çekim talebin oluşturuldu.', 'ok', '💸');
    logLedger('💸', 'Çekim talebi', 0);
    save(); paintLedger();
  });

  $('btnHowto').addEventListener('click', () => {
    haptic('light');
    ask({
      icon: '📘', title: 'Nasıl Oynanır?',
      body: '1. <b>Kazımı Başlat</b> — hızına +' + fmt(RATE_STEP) + ' BB/sa ve süreye 12 saat ekler, ' +
            'kazım çalışmaya başlar. Süre bitene kadar buton kilitli kalır.<br><br>' +
            '2. <b>Şans Kutusu</b> — reklam izle, kutunu aç. Her 3 saatte bir açılabilir.<br><br>' +
            '3. <b>+12:00H Zaman Ekle</b> — reklam izle, süreye 12 saat eklensin. ' +
            'Günde en fazla ' + ADD_TIME_DAILY_MAX + ' kez.',
      yes: 'ANLADIM', single: true
    });
  });

  $('btnSupport').addEventListener('click', () => {
    haptic('light');
    if (TG && TG.openTelegramLink) TG.openTelegramLink('https://t.me/telegram');
    else toast('Destek: @BuddingBranchSupport', 'ok', '💬');
  });

  $('btnReset').addEventListener('click', async () => {
    haptic('warning');
    const ok = await ask({
      icon: '⚠️', title: 'İlerlemeyi Sıfırla',
      body: 'Tüm BB bakiyen, yükseltmelerin ve görev ilerlemen <b>kalıcı olarak</b> silinecek.<br><br>Bu işlem geri alınamaz.',
      yes: 'SIFIRLA', no: 'VAZGEÇ'
    });
    if (!ok) return;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });

  /* ─────────── Ayarlar ─────────── */
  const setMap = { setHaptic: 'haptic', setSound: 'sound', setAnim: 'anim', setNotify: 'notify' };
  Object.keys(setMap).forEach((id) => {
    const input = $(id);
    input.addEventListener('change', () => {
      S.settings[setMap[id]] = input.checked;
      document.body.classList.toggle('no-anim', !S.settings.anim);
      haptic('light');
      save();
    });
  });

  /* ─────────── Sekmeler ─────────── */
  function goTab(target) {
    const tab = document.querySelector('.tab[data-go="' + target + '"]');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('is-active', p.dataset.page === target));
    const pages = document.querySelector('.pages');
    /* ana sayfa tek ekrana sığar — kaydırmayı kapat */
    pages.classList.toggle('no-scroll', target === 'home');
    pages.scrollTop = 0;
    if (target === 'wallet') paintLedger();
    if (target === 'tasks') paintTasks();
    if (target === 'market') { lastShopSig = ''; render(); }
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => { haptic('light'); goTab(tab.dataset.go); });
  });

  /* derin bağlantı: ?tab=market · #wallet · Telegram start_param */
  function initialTab() {
    const q = new URLSearchParams(location.search).get('tab');
    const hash = location.hash.replace('#', '');
    const sp = (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) || '';
    const want = q || hash || (sp.indexOf('tab_') === 0 ? sp.slice(4) : '');
    if (want) goTab(want);
  }

  /* ─────────── Kayıt / yükleme ─────────── */
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* kota dolu */ }
    }, 250);
  }
  function saveNow() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* yut */ }
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      const d = JSON.parse(raw);
      Object.assign(S, d, {
        upgrades: Object.assign({ pick: 0, drill: 0, crew: 0, luck: 0 }, d.upgrades || {}),
        settings: Object.assign({ haptic: true, sound: false, anim: true, notify: true }, d.settings || {}),
        tasks: d.tasks || {},
        ledger: Array.isArray(d.ledger) ? d.ledger : []
      });
      return true;
    } catch (e) { return false; }
  }

  /* ─────────── Çevrimdışı kazanç ─────────── */
  function offlineCatchUp() {
    const now = Date.now();
    const away = now - S.lastTick;
    if (away < 60 * 1000) return;

    let earned = 0;
    if (S.mining && S.timeLeft > 0) {
      const used = Math.min(away, S.timeLeft, 12 * HOUR);
      earned += currentRate() * (used / HOUR);
      S.timeLeft -= used;
      if (S.timeLeft <= 0) { S.timeLeft = 0; S.mining = false; }
    }
    S.lastTick = now;
    if (earned > 0.01) {
      S.total += earned;
      S.fromMine += earned;
      logLedger('🌙', 'Çevrimdışı kazanç', earned);
      setTimeout(() => {
        ask({
          icon: '🌙', title: 'Yokken de kazdık!',
          body: 'Sen yokken <b>' + fmt(earned) + ' BB</b> biriktirdik.<br>Bakiyene eklendi.',
          yes: 'HARİKA', single: true
        });
      }, 600);
    }
  }

  /* ─────────── Canlı sayaç (sosyal kanıt) ─────────── */
  let regBase = 13300, actBase = 13000, supplyLeft = TOTAL_SUPPLY;
  function socialTick() {
    regBase += Math.random() < 0.35 ? 1 : 0;
    actBase += Math.round((Math.random() - 0.45) * 3);
    if (actBase > regBase) actBase = regBase;
    if (actBase < regBase - 900) actBase = regBase - 900;
    supplyLeft = Math.max(1, supplyLeft - (Math.random() < 0.4 ? 1 : 0));
    el.statReg.textContent = fmtInt(regBase);
    el.statAct.textContent = fmtInt(actBase);
    el.statSup.textContent = fmtInt(supplyLeft);
  }

  /* ═══════════════════════════════════════
     BAŞLATMA
     ═══════════════════════════════════════ */
  /* ─────────── Tam ekran ───────────
     Mini App menü butonundan açılınca Telegram üstte bir başlık çubuğu
     gösteriyor, ana ekrandan açılınca göstermiyor. requestFullscreen()
     (Bot API 8.0) ikisini de tam ekrana çekiyor. Eski istemcilerde
     çağrı yok sayılıyor ve expand() ile eski davranış sürüyor. */
  function applyFullscreen() {
    if (!TG) return;
    try {
      const canFs = TG.isVersionAtLeast && TG.isVersionAtLeast('8.0') && typeof TG.requestFullscreen === 'function';
      if (canFs && !TG.isFullscreen) TG.requestFullscreen();
      document.body.classList.toggle('tg-fs', !!TG.isFullscreen);
    } catch (e) { /* istemci desteklemiyor */ }
  }

  function boot() {
    if (TG) {
      try {
        TG.ready();
        TG.expand();
        if (TG.setHeaderColor) TG.setHeaderColor('#f7eedd');
        if (TG.setBackgroundColor) TG.setBackgroundColor('#f2e5cd');
        if (TG.disableVerticalSwipes) TG.disableVerticalSwipes();
        if (TG.enableClosingConfirmation) TG.enableClosingConfirmation();

        /* dinleyiciler istekten ÖNCE bağlanmalı, yoksa hızlı dönen olay kaçar */
        if (TG.onEvent) {
          TG.onEvent('fullscreenChanged', () => {
            document.body.classList.toggle('tg-fs', !!TG.isFullscreen);
          });
          /* başarısız olursa en azından genişletilmiş kalsın */
          TG.onEvent('fullscreenFailed', () => {
            document.body.classList.remove('tg-fs');
            try { TG.expand(); } catch (e) { /* yut */ }
          });
        }
        applyFullscreen();
      } catch (e) { /* eski sürüm istemcisi */ }

      const u = TG.initDataUnsafe && TG.initDataUnsafe.user;
      if (u) {
        el.walletUser.textContent = u.username ? '@' + u.username : (u.first_name || 'Madenci');
      }
    }

    const had = load();
    if (!had) {
      /* ilk giriş: hız, süre ve toplam sıfır */
      S.lastTick = Date.now();
    } else {
      offlineCatchUp();
    }
    rolloverDaily();

    /* ayar kutucuklarını yansıt */
    Object.keys(setMap).forEach((id) => { $(id).checked = !!S.settings[setMap[id]]; });
    document.body.classList.toggle('no-anim', !S.settings.anim);

    paintShop();
    paintGames();
    paintTasks();
    paintLedger();
    render();
    document.querySelector('.pages').classList.add('no-scroll');
    initialTab();

    requestAnimationFrame(frame);   // canlı sayaç
    setInterval(tick, 1000);
    setInterval(socialTick, 4000);
    setInterval(saveNow, 10000);
    socialTick();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveNow();
      else { offlineCatchUp(); render(); }
    });
    window.addEventListener('pagehide', saveNow);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
