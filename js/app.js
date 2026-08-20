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

  const INITIAL_RATE = 0.1;        // kullanıcının başlangıç kazım gücü (BB/saat)
  const START_TIME_MS = 6 * HOUR;  // KAZIMI BAŞLAT her basışta eklenen süre
  const BOX_COOLDOWN_MS = 3 * HOUR; // şans kutusu bekleme süresi
  const ADD_TIME_MS = 7 * HOUR;    // +7H butonunun eklediği süre
  const ADD_TIME_DAILY_MAX = 4;    // +7H günlük hak
  const AD_SECONDS = 5;            // ödüllü reklam süresi (gerçek SDK bunu belirler)

  const SAVE_KEY = 'bb_mining_state_v2';

  /* ─────────── Durum — her şey 0'dan başlar ─────────── */
  const S = {
    total: 0,            // kazılan toplam BB
    fromMine: 0,
    fromTask: 0,
    fromRef: 0,
    points: 0,           // ★ puan — oyunlardan kazanılır, pazar yerinde harcanır
    rate: INITIAL_RATE,  // BB/saat — sabit kazım gücü, BAŞLAT bunu değiştirmez
    mining: false,
    timeLeft: 0,         // ms
    boxNextAt: 0,        // şans kutusunun tekrar açılabileceği an
    addTimeDay: '',      // +7H günlük sayacın tarihi
    addTimeCount: 0,     // bugün kaç kez +7H alındı
    upgrades: { pick: 0, drill: 0, crew: 0, luck: 0 },
    vip: { ticket: 0 },  // VIP öğe sahiplikleri
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
    { id: 'bbrain', name: 'Kripto Yağmuru', desc: '60 SN', ready: true },
    { id: 'soon1',  name: 'Yakında',    desc: '—',     ready: false },
    { id: 'soon2',  name: 'Yakında',    desc: '—',     ready: false }
  ];

  /* ─────────── Şans kutusu ödülleri ─────────── */
  /* w = yüzde ağırlık; toplam 100 olmalı. kind 'bb' bakiyeye, 'rate' kazım hızına ekler. */
  const BOX_PRIZES = [
    { w: 50, kind: 'bb',   amount: 0.5, ico: '🪙', label: '0,5 BB' },
    { w: 25, kind: 'bb',   amount: 1,   ico: '🪙', label: '1 BB' },
    { w: 10, kind: 'bb',   amount: 2.5, ico: '🪙', label: '2,5 BB' },
    { w: 5,  kind: 'bb',   amount: 7.5, ico: '💰', label: '7,5 BB' },
    { w: 5,  kind: 'rate', amount: 0.1, ico: '⚡', label: '+0,1 BB/sa' },
    { w: 3,  kind: 'rate', amount: 0.2, ico: '⚡', label: '+0,2 BB/sa' },
    { w: 2,  kind: 'rate', amount: 0.5, ico: '🔥', label: '+0,5 BB/sa' }
  ];

  /* ─────────── VIP öğeler — pazar yerinin en üstünde ─────────── */
  const VIP_ITEMS = [
    { id: 'ticket', name: 'BİLET', price: 10,
      desc: 'Çekilişlere ve özel etkinliklere katılım hakkı verir.' }
  ];

  /* ─────────── Oyun ayarları ─────────── */
  const GAME_MS = 60 * 1000;      // oyun süresi
  const GAME_TOTAL_ITEMS = 150;   // bir turda düşen toplam nesne
  const SPAWN_EASE = 1.35;        // 1 = sabit tempo, >1 = sona doğru hızlanır
  const GAME_POINT_PER_ITEM = 1;  // toplanan her sembolün puan değeri
  const BOMB_CHANCE = 0.15;       // bomba olma olasılığı
  const BOMB_PENALTY = 10;        // bombaya dokununca toplanandan düşen miktar
  const ICE_CHANCE = 0.08;        // buz olma olasılığı
  const FREEZE_MS = 3000;         // buza dokununca ekranın donma süresi

  /* Düşen kripto sembolleri — hepsi 64x64 viewBox */
  const CRYPTOS = [
    { id: 'btc', svg:
      '<circle cx="32" cy="32" r="30" fill="#f7931a"/>' +
      '<circle cx="32" cy="32" r="30" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>' +
      '<path d="M27 13 v38 M37 13 v38" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M22 20 h13 a7 7 0 0 1 0 14 h-13 z" fill="#fff"/>' +
      '<path d="M22 32 h15 a7.5 7.5 0 0 1 0 15 h-15 z" fill="#fff"/>' +
      '<path d="M26 24 h9 a3 3 0 0 1 0 6 h-9 z" fill="#f7931a"/>' +
      '<path d="M26 36 h11 a3.5 3.5 0 0 1 0 7 h-11 z" fill="#f7931a"/>' },
    { id: 'eth', svg:
      '<circle cx="32" cy="32" r="30" fill="#627eea"/>' +
      '<path d="M32 9 L32 26 L45.5 32.2 Z" fill="#fff" opacity=".6"/>' +
      '<path d="M32 9 L18.5 32.2 L32 26 Z" fill="#fff"/>' +
      '<path d="M32 42.6 L32 55 L45.5 34.8 Z" fill="#fff" opacity=".6"/>' +
      '<path d="M32 55 L32 42.6 L18.5 34.8 Z" fill="#fff"/>' +
      '<path d="M32 39.9 L45.5 32.2 L32 26 Z" fill="#fff" opacity=".3"/>' +
      '<path d="M18.5 32.2 L32 39.9 L32 26 Z" fill="#fff" opacity=".45"/>' },
    { id: 'sol', svg:
      '<defs><linearGradient id="solG" x1="0" y1="1" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="#9945ff"/><stop offset="100%" stop-color="#14f195"/>' +
      '</linearGradient></defs>' +
      '<circle cx="32" cy="32" r="30" fill="#10101c"/>' +
      '<g fill="url(#solG)">' +
      '<path d="M23 19 H49 L41 27 H15 Z"/>' +
      '<path d="M15 29 H41 L49 37 H23 Z"/>' +
      '<path d="M23 39 H49 L41 47 H15 Z"/>' +
      '</g>' },
    { id: 'xrp', svg:
      '<circle cx="32" cy="32" r="30" fill="#23292f"/>' +
      '<path d="M17 20 L32 34.5 L47 20" fill="none" stroke="#fff" stroke-width="5" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M17 44 L32 29.5 L47 44" fill="none" stroke="#fff" stroke-width="5" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' }
  ];

  /* Bomba — dokunulursa toplanan sayısı BOMB_PENALTY kadar düşer */
  const BOMB_SVG =
    '<circle cx="30" cy="38" r="21" fill="#16161b"/>' +
    '<circle cx="30" cy="38" r="21" fill="none" stroke="#3a3a45" stroke-width="2"/>' +
    '<ellipse cx="23" cy="31" rx="7" ry="5" fill="#4d4d5a" opacity=".75" transform="rotate(-30 23 31)"/>' +
    '<rect x="34" y="12" width="11" height="9" rx="2.5" fill="#3a3a45" transform="rotate(22 39 16)"/>' +
    '<path d="M44 14 q9-7 15 0" fill="none" stroke="#c98b3a" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="59" cy="14" r="5" fill="#ffcc4d"/>' +
    '<circle cx="59" cy="14" r="2.4" fill="#fff"/>';

  /* Buz — dokununca ekrandaki her şey donar. Donan nesneler de bu sembole döner. */
  const ICE_SVG =
    '<circle cx="32" cy="32" r="30" fill="#cdeeff"/>' +
    '<circle cx="32" cy="32" r="30" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>' +
    '<g stroke="#1f7fc4" stroke-width="4.5" stroke-linecap="round" fill="none">' +
      '<path d="M32 11 V53"/>' +
      '<path d="M13.8 21.5 L50.2 42.5"/>' +
      '<path d="M50.2 21.5 L13.8 42.5"/>' +
    '</g>' +
    '<g stroke="#1f7fc4" stroke-width="3.4" stroke-linecap="round" fill="none">' +
      '<path d="M32 19 l-5.5-5 M32 19 l5.5-5"/>' +
      '<path d="M32 45 l-5.5 5 M32 45 l5.5 5"/>' +
      '<path d="M20.5 25 l-7.3-.7 M20.5 25 l.7-7.3"/>' +
      '<path d="M43.5 39 l7.3 .7 M43.5 39 l-.7 7.3"/>' +
      '<path d="M43.5 25 l7.3-.7 M43.5 25 l-.7-7.3"/>' +
      '<path d="M20.5 39 l-7.3 .7 M20.5 39 l.7 7.3"/>' +
    '</g>';

  const svgWrap = (inner) => '<svg viewBox="0 0 64 64">' + inner + '</svg>';

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
    statReg: $('statRegistered'), statAct: $('statActive'),
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
  const LIVE_DECIMALS = 3;   // sayaçta gösterilen toplam ondalık
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

  /* ─────────── Şans kutusu yardımcıları ─────────── */
  /* Ağırlıklı çekiliş: her ödülün w değeri kadar payı var. */
  function pickPrize() {
    const total = BOX_PRIZES.reduce((a, x) => a + x.w, 0);
    let r = Math.random() * total;
    for (const x of BOX_PRIZES) { r -= x.w; if (r < 0) return x; }
    return BOX_PRIZES[BOX_PRIZES.length - 1];
  }

  function prizeOddsHtml() {
    return '<div class="odds">' + BOX_PRIZES.map((x) =>
      '<div class="odds-row">' +
        '<span class="odds-ico">' + x.ico + '</span>' +
        '<span class="odds-label">' + x.label + '</span>' +
        '<b class="odds-pct">%' + x.w + '</b>' +
      '</div>').join('') + '</div>';
  }

  function showPrize(x) {
    $('prizeIco').textContent = x.ico;
    $('prizeLabel').textContent = x.label;
    $('prizeNote').textContent = x.kind === 'bb'
      ? 'Bakiyene eklendi'
      : 'Kazım hızın kalıcı olarak arttı';
    $('prizeView').classList.add('open');
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

    /* ── +7H: günde ADD_TIME_DAILY_MAX hak ── */
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
    const sig = SHOP.map((i) => S.upgrades[i.id]).join(',') + '|' + S.points +
                '|' + VIP_ITEMS.map((i) => S.vip[i.id] || 0).join(',') +
                '|' + Math.floor(S.total);
    if (sig !== lastShopSig) { lastShopSig = sig; paintShop(); }
  }

  /* ─────────── Mağaza ───────────
     Öğeler geçici olarak kapalı. Geri açmak için SHOP_ENABLED = true yeter;
     aşağıdaki çizim kodu ve SHOP dizisi olduğu gibi duruyor. */
  const SHOP_ENABLED = false;

  /* VIP bilet görseli — mavi gövde, altın kenar, yıldız + VIP */
  const TICKET_SVG =
    '<svg viewBox="0 0 100 100">' +
      '<defs>' +
        '<linearGradient id="tkBody" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="#5ab4ff"/><stop offset="50%" stop-color="#1e7ce0"/>' +
          '<stop offset="100%" stop-color="#0d47a1"/>' +
        '</linearGradient>' +
        '<linearGradient id="tkGold" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#ffe895"/><stop offset="55%" stop-color="#f2b32c"/>' +
          '<stop offset="100%" stop-color="#bd7a0c"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="M12 22 H88 A4 4 0 0 1 92 26 V42 A8 8 0 0 0 92 58 V74 A4 4 0 0 1 88 78 H12 ' +
              'A4 4 0 0 1 8 74 V58 A8 8 0 0 1 8 42 V26 A4 4 0 0 1 12 22 Z" ' +
              'fill="url(#tkBody)" stroke="url(#tkGold)" stroke-width="3"/>' +
      '<path d="m32 35 3.8 7.7 8.5 1.2-6.2 6 1.5 8.4-7.6-4-7.6 4 1.5-8.4-6.2-6 8.5-1.2Z" fill="url(#tkGold)"/>' +
      '<text x="67" y="59" text-anchor="middle" font-family="Baloo 2, sans-serif" ' +
            'font-size="25" font-weight="800" fill="#fff">VIP</text>' +
    '</svg>';

  function paintShop() {
    el.shopGrid.innerHTML = '';

    /* ── VIP öğeler (her zaman görünür) ── */
    VIP_ITEMS.forEach((item) => {
      const owned = S.vip[item.id] || 0;
      const row = document.createElement('div');
      row.className = 'shop-item vip';
      row.innerHTML =
        '<div class="shop-ico vip-ico">' + TICKET_SVG + '</div>' +
        '<div class="shop-body">' +
          '<span class="vip-badge">VIP</span>' +
          '<h4>' + item.name + '</h4>' +
          '<p>' + item.desc + '</p>' +
          '<span class="shop-lvl vip-lvl">SAHİP OLDUĞUN: ' + fmtInt(owned) + '</span>' +
        '</div>' +
        '<button class="shop-buy vip-buy">' +
          '<span class="buy-price">' + fmt(item.price) + '</span><small>BB</small>' +
        '</button>';

      row.querySelector('.shop-buy').addEventListener('click', () => {
        if (S.total < item.price) {
          toast('Yetersiz BB. Gereken: ' + fmt(item.price) + ' BB', 'err', '🪙');
          haptic('error');
          return;
        }
        S.total -= item.price;
        S.fromMine -= item.price;
        S.vip[item.id] = (S.vip[item.id] || 0) + 1;
        logLedger('🎟️', item.name + ' satın alındı', -item.price);
        toast(item.name + ' senin oldu!', 'ok', '🎟️');
        haptic('success');
        lastShopSig = '';
        save(); render(); paintLedger();
      });
      el.shopGrid.appendChild(row);
    });

    /* ── Yükseltmeler (SHOP_ENABLED ile açılır) ── */
    if (!SHOP_ENABLED) return;
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
        ? '<span class="drop">' + svgWrap(CRYPTOS[0].svg) + '</span>' +
          '<span class="drop">' + svgWrap(CRYPTOS[1].svg) + '</span>' +
          '<span class="drop">' + svgWrap(CRYPTOS[3].svg) + '</span>'
        : '<span class="game-lock"><svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm3 8H9V7a3 3 0 0 1 6 0Z"/></svg></span>';

      tile.innerHTML =
        '<span class="game-art">' + art + '</span>' +
        '<span class="game-name">' + g.name + '</span>' +
        '<span class="game-desc">' + (g.ready ? g.desc : 'YAKINDA') + '</span>';

      if (g.ready) tile.addEventListener('click', () => { haptic('medium'); openGame(g.id); });
      el.gameGrid.appendChild(tile);
    });
  }

  /* ─── Kripto Yağmuru ─── */
  const G = {
    on: false, raf: 0, items: [], last: 0,
    endsAt: 0, collected: 0, w: 0, h: 0,
    spawned: 0,        // bu turda üretilen nesne sayısı
    frozenUntil: 0,    // donmanın biteceği an
    freezeStart: 0,    // süren donmanın başlangıcı (0 = donmuyor)
    frozenMs: 0        // turda toplam donarak geçen süre
  };

  function openGame(id) {
    if (id !== 'bbrain') return;
    $('gName').textContent = 'KRİPTO YAĞMURU';
    $('gameView').classList.add('open');
    $('gEnd').classList.remove('open');
    startRound();
  }

  function clearItems() {
    G.items.forEach((c) => c.el.remove());
    G.items = [];
  }

  function startRound() {
    const area = $('gArea');
    clearItems();
    G.collected = 0;
    G.spawned = 0;
    G.frozenUntil = 0;
    G.freezeStart = 0;
    G.frozenMs = 0;
    area.classList.remove('frozen');
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
      G.last = performance.now();
      G.w = area.clientWidth;
      G.h = area.clientHeight;
      haptic('success');
      G.raf = requestAnimationFrame(gameFrame);
    }, 700);
  }

  function spawnItem() {
    const area = $('gArea');
    const size = 54;
    const r = Math.random();
    const kind = r < BOMB_CHANCE ? 'bomb'
               : r < BOMB_CHANCE + ICE_CHANCE ? 'ice'
               : 'crypto';
    const c = {
      x: 6 + Math.random() * Math.max(1, G.w - size - 12),
      y: -size,
      vy: 150 + Math.random() * 130,           // px/sn
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 120,
      size: size,
      kind: kind,
      el: document.createElement('span')
    };
    c.el.className = 'fall' + (kind === 'bomb' ? ' is-bomb' : kind === 'ice' ? ' is-ice' : '');
    c.el.innerHTML = svgWrap(
      kind === 'bomb' ? BOMB_SVG :
      kind === 'ice'  ? ICE_SVG  :
      CRYPTOS[(Math.random() * CRYPTOS.length) | 0].svg);
    c.el.addEventListener('pointerdown', (e) => { e.preventDefault(); tapItem(c); });
    area.appendChild(c.el);
    G.items.push(c);
  }

  /* Buza dokunulunca: ekrandaki her şey donma sembolüne döner ve durur.
     Donan bombalar zararsızlaşır — görünüşleri aynı olduğu için ayırt
     edilemezdi, o yüzden hepsi normal buz gibi toplanabilir. */
  function freezeAll() {
    const now = Date.now();
    G.freezeStart = now;
    G.frozenUntil = now + FREEZE_MS;
    $('gArea').classList.add('frozen');
    G.items.forEach((it) => {
      it.kind = 'ice';
      it.el.className = 'fall is-ice frozen';
      it.el.innerHTML = svgWrap(ICE_SVG);
    });
  }

  function tapItem(c) {
    if (c.dead) return;
    c.dead = true;

    if (c.kind === 'bomb') {
      G.collected = Math.max(0, G.collected - BOMB_PENALTY);
      haptic('error');
      $('gArea').classList.add('boom');
      setTimeout(() => $('gArea').classList.remove('boom'), 320);
    } else {
      G.collected++;
      haptic(c.kind === 'ice' ? 'success' : 'light');
      if (c.kind === 'ice' && !c.frozenCopy) freezeAll();
    }
    $('gScore').textContent = fmtInt(G.collected);

    /* patlama + uçan +1 */
    c.el.style.setProperty('--px', c.x + 'px');
    c.el.style.setProperty('--py', c.y + 'px');
    c.el.classList.add('pop');
    const el2 = c.el;
    setTimeout(() => el2.remove(), 320);

    const plus = document.createElement('span');
    plus.className = 'gv-plus' + (c.kind === 'bomb' ? ' minus' : '');
    plus.textContent = c.kind === 'bomb' ? '-' + BOMB_PENALTY : '+' + GAME_POINT_PER_ITEM;
    plus.style.left = c.x + 'px';
    plus.style.top = c.y + 'px';
    $('gArea').appendChild(plus);
    setTimeout(() => plus.remove(), 820);

    G.items = G.items.filter((x) => x !== c);
  }

  function gameFrame(ts) {
    if (!G.on) return;
    const dt = Math.min(0.05, (ts - G.last) / 1000);
    G.last = ts;

    const area = $('gArea');
    G.w = area.clientWidth;
    G.h = area.clientHeight;

    const now = Date.now();
    const remain = G.endsAt - now;
    if (remain <= 0) { endRound(); return; }

    /* süre donmada da işlemeye devam eder */
    $('gTime').textContent = Math.ceil(remain / 1000);
    $('gBar').style.width = (remain / GAME_MS * 100) + '%';

    /* donma bittiyse çöz */
    const frozen = now < G.frozenUntil;
    if (!frozen && G.freezeStart) {
      G.frozenMs += G.frozenUntil - G.freezeStart;
      G.freezeStart = 0;
      area.classList.remove('frozen');
      G.items.forEach((it) => it.el.classList.remove('frozen'));
    }

    if (!frozen) {
      /* Üretim programı: turda tam GAME_TOTAL_ITEMS nesne düşer.
         Donarak geçen süre sayılmaz, yoksa çözülünce toplu doğma olur.
         Mutlak zamana dayalı olduğu için kare düşmesinden etkilenmez. */
      const activeMs = (GAME_MS - remain) - G.frozenMs;
      const sprog = Math.max(0, Math.min(1, activeMs / GAME_MS));
      const due = Math.round(GAME_TOTAL_ITEMS * Math.pow(sprog, SPAWN_EASE));
      while (G.spawned < due && G.spawned < GAME_TOTAL_ITEMS) { spawnItem(); G.spawned++; }

      /* hareket */
      const prog = 1 - remain / GAME_MS;
      for (let i = G.items.length - 1; i >= 0; i--) {
        const c = G.items[i];
        c.y += c.vy * dt * (1 + prog * 0.35);
        c.rot += c.vr * dt;
        if (c.y > G.h + c.size) {           // kaçırıldı
          c.el.remove();
          G.items.splice(i, 1);
          continue;
        }
        c.el.style.transform = 'translate3d(' + c.x + 'px,' + c.y + 'px,0) rotate(' + c.rot + 'deg)';
      }
    }

    G.raf = requestAnimationFrame(gameFrame);
  }

  function endRound() {
    G.on = false;
    cancelAnimationFrame(G.raf);
    clearItems();
    $('gArea').classList.remove('frozen');
    $('gTime').textContent = '0';
    $('gBar').style.width = '0%';

    const earned = G.collected * GAME_POINT_PER_ITEM;
    S.points += earned;

    $('gEndCollected').textContent = fmtInt(G.collected);
    $('gEndPoints').textContent = '+' + fmtInt(earned);
    $('gEndTotal').textContent = fmtInt(S.points) + ' ★';
    $('gEnd').classList.add('open');
    haptic('success');

    if (earned > 0) logLedger('🎮', 'Kripto Yağmuru · ' + fmtInt(earned) + ' ★', 0);
    lastShopSig = '';
    save(); render(); paintLedger();
    bumpPoints();
  }

  function closeGame() {
    if (G.on) { endRound(); return; }   // erken çıkışta da toplananlar verilir
    G.on = false;
    cancelAnimationFrame(G.raf);
    clearItems();
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
  /* ── KAZIMI BAŞLAT: süreye +START_TIME_MS ekler ve kazımı başlatır.
       Kazım gücüne DOKUNMAZ — güç sabittir, yalnızca yükseltmelerle artar. ── */
  el.actStart.addEventListener('click', () => {
    if (S.mining && S.timeLeft > 0) return;   // kilitli
    haptic('medium');

    S.timeLeft += START_TIME_MS;
    S.mining = true;
    S.lastTick = Date.now();

    logLedger('⛏️', 'Kazım başlatıldı', 0);
    toast('Kazım başladı! Saatte ' + fmt(currentRate()) + ' BB', 'ok', '⛏️');
    haptic('success');
    save(); render(); paintLedger();
  });

  /* ── ŞANS KUTUSU: ödüllü reklam, 3 saatte bir, ağırlıklı ödül ── */
  el.actBox.addEventListener('click', async () => {
    if (Date.now() < S.boxNextAt) return;   // kilitli
    haptic('medium');

    const ok = await ask({
      icon: '🎁', title: 'Şans Kutusu',
      body: 'Kısa bir reklam izle, ödülünü kap.<br>Her <b>3 saatte bir</b> açılabilir.' +
            prizeOddsHtml(),
      yes: 'REKLAMI İZLE', no: 'VAZGEÇ'
    });
    if (!ok) return;

    const watched = await watchRewardedAd('Şans kutun açılıyor…');
    if (!watched) {
      toast('Reklam tamamlanmadı, kutu açılmadı.', 'warn', '⚠️');
      return;
    }

    const prize = pickPrize();
    S.boxNextAt = Date.now() + BOX_COOLDOWN_MS;

    if (prize.kind === 'bb') grant(prize.amount, 'mine');
    else S.rate += prize.amount;

    logLedger('🎁', 'Şans kutusu · ' + prize.label, prize.kind === 'bb' ? prize.amount : 0);
    haptic('success');
    save(); render(); paintLedger();
    showPrize(prize);
  });

  $('prizeOk').addEventListener('click', () => {
    haptic('light');
    $('prizeView').classList.remove('open');
  });

  /* ── +7:00H ZAMAN EKLE: ödüllü reklam, günde ADD_TIME_DAILY_MAX kez ── */
  el.actTime.addEventListener('click', async () => {
    if (addTimeLeftToday() <= 0) return;   // kilitli
    haptic('medium');

    const ok = await ask({
      icon: '⏰', title: '+7 Saat Zaman Ekle',
      body: 'Kısa bir reklam izle, kazım süresine <b>7 saat</b> eklensin.' +
            '<br><br>Kalan süre: <b>' + clock(S.timeLeft) + '</b>' +
            '<br>Bugün kalan hak: <b>' + addTimeLeftToday() + ' / ' + ADD_TIME_DAILY_MAX + '</b>',
      yes: 'REKLAMI İZLE', no: 'VAZGEÇ'
    });
    if (!ok) return;

    const watched = await watchRewardedAd('7 saat ekleniyor…');
    if (!watched) {
      toast('Reklam tamamlanmadı, ödül verilmedi.', 'warn', '⚠️');
      return;
    }

    rolloverDaily();
    S.addTimeCount++;
    S.timeLeft += ADD_TIME_MS;
    logLedger('⏰', '+7 saat kazım süresi', 0);
    toast('+7 saat eklendi · Toplam ' + clock(S.timeLeft), 'ok', '⏰');
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

  /* ── Referans ekranı (şimdilik boş) ── */
  $('btnRef').addEventListener('click', () => {
    haptic('light');
    $('refView').classList.add('open');
  });
  $('refBack').addEventListener('click', () => {
    haptic('light');
    $('refView').classList.remove('open');
  });
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
      body: '1. <b>Kazımı Başlat</b> — süreye 6 saat ekler ve kazımı başlatır. ' +
            'Kazım gücün sabittir, bu buton onu değiştirmez. Süre bitene kadar kilitli kalır.<br><br>' +
            '2. <b>Şans Kutusu</b> — reklam izle, kutunu aç. Her 3 saatte bir açılabilir.<br><br>' +
            '3. <b>+07:00H Zaman Ekle</b> — reklam izle, süreye 7 saat eklensin. ' +
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

    /* Yazan her şeyi durdur — yoksa reload öncesi tetiklenen pagehide
       eski durumu geri yazar ve sıfırlama boşa gider. */
    resetting = true;
    clearTimeout(saveTimer);
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem('bb_mining_state_v1');   // eski sürüm kalıntısı
    } catch (e) { /* yut */ }

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
  /* Sıfırlama sırasında true olur. Olmazsa reload'un tetiklediği
     pagehide/visibilitychange, silinen kaydı hemen geri yazıyor. */
  let resetting = false;

  function save() {
    if (resetting) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (resetting) return;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* kota dolu */ }
    }, 250);
  }
  function saveNow() {
    if (resetting) return;
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
        vip: Object.assign({ ticket: 0 }, d.vip || {}),
        settings: Object.assign({ haptic: true, sound: false, anim: true, notify: true }, d.settings || {}),
        tasks: d.tasks || {},
        ledger: Array.isArray(d.ledger) ? d.ledger : []
      });
      /* eski kayıtlarda hız 0'dan başlıyordu; taban gücün altına düşmesin */
      if (!(S.rate > 0)) S.rate = INITIAL_RATE;
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
  let regBase = 13300, actBase = 13000;
  function socialTick() {
    regBase += Math.random() < 0.35 ? 1 : 0;
    actBase += Math.round((Math.random() - 0.45) * 3);
    if (actBase > regBase) actBase = regBase;
    if (actBase < regBase - 900) actBase = regBase - 900;
    el.statReg.textContent = fmtInt(regBase);
    el.statAct.textContent = fmtInt(actBase);
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
