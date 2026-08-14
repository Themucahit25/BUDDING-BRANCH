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

  /* ─────────── Sabitler ─────────── */
  const HOUR = 3600 * 1000;
  const BASE_RATE = 12.5;          // BB / saat
  const SESSION_MS = 24 * HOUR;    // tek oturum süresi
  const MAX_TIME_MS = 48 * HOUR;   // biriktirilebilir tavan
  const ADD_TIME_MS = 12 * HOUR;
  const BOOST_MS = 4 * HOUR;       // 2x süresi
  const BOT_MS = 8 * HOUR;
  const BOT_EFFICIENCY = 0.5;
  const SAVE_KEY = 'bb_mining_state_v1';
  const TOTAL_SUPPLY = 13300;

  /* ─────────── Durum ─────────── */
  const S = {
    total: 0,            // kazılan toplam BB
    fromMine: 0,
    fromTask: 0,
    fromRef: 0,
    mining: false,
    timeLeft: 0,         // ms
    boostUntil: 0,       // timestamp
    botUntil: 0,
    botEarned: 0,
    upgrades: { pick: 0, drill: 0, crew: 0, luck: 0 },
    tasks: {},
    ledger: [],
    lastTick: Date.now(),
    settings: { haptic: true, sound: false, anim: true, notify: true }
  };

  /* ─────────── Yükseltmeler ─────────── */
  const SHOP = [
    { id: 'pick',  ico: '⛏️', bg: '#fdf1d4', name: 'Elmas Uçlu Kazma', desc: 'Her seviye kazım hızına +%15 ekler.', base: 250,  step: 1.85, max: 10, mult: 0.15 },
    { id: 'drill', ico: '🛠️', bg: '#e4efff', name: 'Buharlı Matkap',   desc: 'Her seviye kazım hızına +%35 ekler.', base: 1200, step: 2.05, max: 8,  mult: 0.35 },
    { id: 'crew',  ico: '👷', bg: '#e8f6e3', name: 'Madenci Ekibi',    desc: 'Her seviye kazım hızına +%60 ekler.', base: 5000, step: 2.25, max: 6,  mult: 0.60 },
    { id: 'luck',  ico: '🍀', bg: '#f0e6ff', name: 'Şans Tılsımı',     desc: 'Her seviye kazım hızına +%100 ekler.', base: 20000, step: 2.6, max: 4, mult: 1.00 }
  ];

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
    rate: $('rateValue'), timer: $('timerValue'), total: $('totalValue'),
    note: $('sessionNote'), floatLayer: $('floatLayer'),
    scene: document.querySelector('.scene-card'),
    actStart: $('actStart'), actBoost: $('actBoost'), actTime: $('actTime'),
    statReg: $('statRegistered'), statAct: $('statActive'), statSup: $('statSupply'),
    shopGrid: $('shopGrid'), taskList: $('taskList'), ledger: $('ledger'),
    walletBalance: $('walletBalance'), walletUser: $('walletUser'),
    wMine: $('wSrcMine'), wTask: $('wSrcTask'), wRef: $('wSrcRef'),
    botState: $('botState'), botEff: $('botEff'), botTime: $('botTime'),
    botEarned: $('botEarned'), btnBot: $('btnBot'),
    modal: $('modal'), modalIco: $('modalIco'), modalTitle: $('modalTitle'),
    modalBody: $('modalBody'), modalYes: $('modalYes'), modalNo: $('modalNo'),
    toastWrap: $('toastWrap')
  };

  /* ─────────── Biçimlendiriciler ─────────── */
  const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const fmt = (n) => nf2.format(n);
  const fmtInt = (n) => nf0.format(n);

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
  function currentRate() {
    let mult = 1;
    SHOP.forEach((it) => { mult += it.mult * S.upgrades[it.id]; });
    if (Date.now() < S.boostUntil) mult *= 2;
    return BASE_RATE * mult;
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

  function tick() {
    const now = Date.now();
    let dt = now - S.lastTick;
    S.lastTick = now;
    if (dt < 0) dt = 0;
    if (dt > 12 * HOUR) dt = 12 * HOUR;   // aşırı sıçramayı sınırla

    /* aktif kazım */
    if (S.mining && S.timeLeft > 0) {
      const used = Math.min(dt, S.timeLeft);
      const gained = currentRate() * (used / HOUR);
      grant(gained, 'mine');
      S.timeLeft -= used;

      floatAcc += gained;
      if (floatAcc >= 0.05 && Math.random() < 0.06) {
        floatGain('+' + fmt(floatAcc) + ' BB');
        floatAcc = 0;
      }

      if (S.timeLeft <= 0) {
        S.timeLeft = 0;
        S.mining = false;
        logLedger('⛏️', 'Kazım oturumu tamamlandı', 0);
        toast('Kazım süresi doldu. Süre ekleyerek devam edebilirsin.', 'warn', '⏳');
        haptic('warning');
      }
    }

    /* bot */
    if (S.botUntil > now) {
      const g = currentRate() * BOT_EFFICIENCY * (dt / HOUR);
      grant(g, 'mine');
      S.botEarned += g;
    } else if (S.botEarned > 0 && S.botUntil !== 0) {
      logLedger('🤖', 'Bot vardiyası tamamlandı', S.botEarned);
      toast('Bot vardiyası bitti: +' + fmt(S.botEarned) + ' BB', 'ok', '🤖');
      S.botEarned = 0;
      S.botUntil = 0;
    }

    render();
  }

  /* ═══════════════════════════════════════
     RENDER
     ═══════════════════════════════════════ */
  let lastShopSig = '';

  function render() {
    const now = Date.now();
    const boosted = now < S.boostUntil;

    el.rate.textContent = fmt(currentRate());
    el.timer.textContent = clock(S.timeLeft);
    el.total.textContent = fmt(S.total);
    el.walletBalance.textContent = fmt(S.total);
    el.wMine.textContent = fmt(S.fromMine);
    el.wTask.textContent = fmt(S.fromTask);
    el.wRef.textContent = fmt(S.fromRef);

    /* sahne durumu */
    el.scene.classList.toggle('is-mining', S.mining && S.timeLeft > 0);
    el.actStart.classList.toggle('is-on', S.mining && S.timeLeft > 0);
    el.actBoost.classList.toggle('is-on', boosted);

    /* başlat butonu metni */
    const h3 = el.actStart.querySelector('h3');
    const p = el.actStart.querySelector('p');
    if (S.mining && S.timeLeft > 0) {
      h3.textContent = 'KAZIM AKTİF';
      p.innerHTML = 'Durdurmak için<br>dokun';
    } else {
      h3.textContent = 'KAZIMI BAŞLAT';
      p.innerHTML = 'Kazımı başlat<br>ve BB kazan!';
    }

    /* boost butonu */
    const bH3 = el.actBoost.querySelector('h3');
    const bP = el.actBoost.querySelector('p');
    if (boosted) {
      bH3.innerHTML = '2X AKTİF';
      bP.innerHTML = 'Kalan süre<br>' + clock(S.boostUntil - now);
    } else {
      bH3.innerHTML = 'KAZIMI 2X<br>YÜKSELT';
      bP.innerHTML = 'Kazım hızını<br>2 katına çıkar!';
    }

    /* alt not */
    if (S.mining && S.timeLeft > 0) {
      el.note.innerHTML = 'Kazım <b>çalışıyor</b> · saatte <b>' + fmt(currentRate()) + ' BB</b>' +
        (boosted ? ' · <b>2X</b> aktif' : '');
    } else if (S.timeLeft <= 0) {
      el.note.innerHTML = 'Süren bitti. <b>+12:00H ZAMAN EKLE</b> ile yeni süre al.';
    } else {
      el.note.innerHTML = 'Kazım pasif. Başlatmak için <b>KAZIMI BAŞLAT</b>\'a dokun.';
    }

    /* zaman ekle butonu doluluk */
    el.actTime.disabled = S.timeLeft >= MAX_TIME_MS;

    /* bot paneli */
    const botOn = S.botUntil > now;
    el.botState.textContent = botOn ? 'ÇALIŞIYOR' : 'DEVRE DIŞI';
    el.botState.classList.toggle('on', botOn);
    el.botEff.textContent = '%' + Math.round(BOT_EFFICIENCY * 100);
    el.botTime.textContent = clock(Math.max(0, S.botUntil - now));
    el.botEarned.textContent = fmt(S.botEarned) + ' BB';
    el.btnBot.textContent = botOn ? 'BOT ÇALIŞIYOR…' : 'BOTU 8 SAAT ÇALIŞTIR';
    el.btnBot.classList.toggle('off', botOn);

    /* mağaza yalnız değişince yeniden çizilsin */
    const sig = SHOP.map((i) => S.upgrades[i.id]).join(',') + '|' + Math.floor(S.total);
    if (sig !== lastShopSig) { lastShopSig = sig; paintShop(); }
  }

  /* ─────────── Mağaza ─────────── */
  function paintShop() {
    el.shopGrid.innerHTML = '';
    SHOP.forEach((item) => {
      const lvl = S.upgrades[item.id];
      const maxed = lvl >= item.max;
      const price = priceOf(item);
      const afford = S.total >= price;

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
          (maxed ? 'MAKS.' : fmtInt(price)) +
          (maxed ? '' : '<small>BB</small>') +
        '</button>';

      if (!maxed) {
        row.querySelector('.shop-buy').addEventListener('click', () => {
          if (!afford) {
            toast('Yetersiz BB. Gereken: ' + fmtInt(price) + ' BB', 'err', '💰');
            haptic('error');
            return;
          }
          S.total -= price;
          S.fromMine -= price;
          S.upgrades[item.id]++;
          logLedger(item.ico, item.name + ' Sv.' + S.upgrades[item.id], -price);
          toast(item.name + ' seviye ' + S.upgrades[item.id] + ' oldu!', 'ok', '⚡');
          haptic('success');
          lastShopSig = '';
          save(); render(); paintLedger();
        });
      }
      el.shopGrid.appendChild(row);
    });
  }

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
  el.actStart.addEventListener('click', async () => {
    haptic('medium');
    if (S.mining && S.timeLeft > 0) {
      S.mining = false;
      toast('Kazım duraklatıldı.', 'warn', '⏸️');
      save(); render();
      return;
    }
    if (S.timeLeft <= 0) {
      const ok = await ask({
        icon: '⏳', title: 'Kazım süren yok',
        body: 'Kazıma başlamak için önce süre eklemelisin.<br><b>+12:00H ZAMAN EKLE</b> ile 12 saat kazanabilirsin.',
        yes: '12 SAAT EKLE', no: 'KAPAT'
      });
      if (ok) addTime();
      return;
    }
    S.mining = true;
    S.lastTick = Date.now();
    logLedger('⛏️', 'Kazım başlatıldı', 0);
    toast('Kazım başladı! Saatte ' + fmt(currentRate()) + ' BB', 'ok', '⛏️');
    haptic('success');
    save(); render(); paintLedger();
  });

  el.actBoost.addEventListener('click', async () => {
    haptic('medium');
    if (Date.now() < S.boostUntil) {
      toast('2X zaten aktif · ' + clock(S.boostUntil - Date.now()), 'warn', '⚡');
      return;
    }
    const ok = await ask({
      icon: '⚡', title: 'Kazımı 2X Yükselt',
      body: 'Kazım hızın <b>4 saat</b> boyunca <b>2 katına</b> çıkar.<br><br>Reklam izleyerek ücretsiz aktifleştir.',
      yes: 'AKTİFLEŞTİR', no: 'VAZGEÇ'
    });
    if (!ok) return;
    S.boostUntil = Date.now() + BOOST_MS;
    logLedger('⚡', '2X hız yükseltmesi (4s)', 0);
    toast('2X aktif! 4 saat boyunca çift hız.', 'ok', '⚡');
    haptic('success');
    save(); render(); paintLedger();
  });

  function addTime() {
    if (S.timeLeft >= MAX_TIME_MS) {
      toast('Süre tavanına ulaştın (48 saat).', 'warn', '⏳');
      return;
    }
    S.timeLeft = Math.min(MAX_TIME_MS, S.timeLeft + ADD_TIME_MS);
    logLedger('⏰', '+12 saat kazım süresi', 0);
    toast('+12 saat eklendi · Toplam ' + clock(S.timeLeft), 'ok', '⏰');
    haptic('success');
    if (!S.mining) { S.mining = true; S.lastTick = Date.now(); }
    save(); render(); paintLedger();
  }

  el.actTime.addEventListener('click', async () => {
    haptic('medium');
    const ok = await ask({
      icon: '⏰', title: '+12 Saat Zaman Ekle',
      body: 'Kazım süresine <b>12 saat</b> eklenecek.<br>Maksimum birikim <b>48 saat</b>.<br><br>Reklam izleyerek ücretsiz al.',
      yes: 'ZAMAN EKLE', no: 'VAZGEÇ'
    });
    if (ok) addTime();
  });

  el.btnBot.addEventListener('click', async () => {
    haptic('medium');
    if (S.botUntil > Date.now()) {
      toast('Bot şu an çalışıyor · ' + clock(S.botUntil - Date.now()), 'warn', '🤖');
      return;
    }
    const ok = await ask({
      icon: '🤖', title: 'Canlı Botu Çalıştır',
      body: 'Bot <b>8 saat</b> boyunca senin yerine kazar.<br>Verim: normal hızın <b>%50</b>si.<br><br>Uygulamayı kapatsan da çalışır.',
      yes: 'ÇALIŞTIR', no: 'VAZGEÇ'
    });
    if (!ok) return;
    S.botUntil = Date.now() + BOT_MS;
    S.botEarned = 0;
    logLedger('🤖', 'Bot vardiyası başladı (8s)', 0);
    toast('Bot çalışmaya başladı!', 'ok', '🤖');
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
      body: '1. <b>Zaman ekle</b> — kazım için süre kazan.<br>' +
            '2. <b>Kazımı başlat</b> — BB birikmeye başlar.<br>' +
            '3. <b>2X yükselt</b> — 4 saat çift hız.<br>' +
            '4. <b>Pazar yeri</b> — kalıcı hız yükseltmeleri al.<br>' +
            '5. <b>Canlı bot</b> — sen yokken %50 verimle kazar.',
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

  /* ─────────── İpucu balonları ─────────── */
  document.querySelectorAll('.hud-info').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic('light');
      toast(b.dataset.tip, '', 'ℹ️');
    });
  });

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
    if (S.botUntil > S.lastTick) {
      const botMs = Math.min(away, S.botUntil - S.lastTick);
      const g = currentRate() * BOT_EFFICIENCY * (botMs / HOUR);
      earned += g;
      S.botEarned += g;
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
  function boot() {
    if (TG) {
      try {
        TG.ready();
        TG.expand();
        if (TG.setHeaderColor) TG.setHeaderColor('#f7eedd');
        if (TG.setBackgroundColor) TG.setBackgroundColor('#f2e5cd');
        if (TG.disableVerticalSwipes) TG.disableVerticalSwipes();
        if (TG.enableClosingConfirmation) TG.enableClosingConfirmation();
      } catch (e) { /* eski sürüm istemcisi */ }

      const u = TG.initDataUnsafe && TG.initDataUnsafe.user;
      if (u) {
        el.walletUser.textContent = u.username ? '@' + u.username : (u.first_name || 'Madenci');
      }
    }

    const had = load();
    if (!had) {
      S.timeLeft = SESSION_MS;
      S.lastTick = Date.now();
      logLedger('🌱', 'Hoş geldin bonusu', 100);
      S.total = 100; S.fromMine = 100;
    } else {
      offlineCatchUp();
    }

    /* ayar kutucuklarını yansıt */
    Object.keys(setMap).forEach((id) => { $(id).checked = !!S.settings[setMap[id]]; });
    document.body.classList.toggle('no-anim', !S.settings.anim);

    paintShop();
    paintTasks();
    paintLedger();
    render();
    document.querySelector('.pages').classList.add('no-scroll');
    initialTab();

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
