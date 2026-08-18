# CLAUDE.md — BUDDING BRANCH

Telegram Mini App olarak çalışan, backend'siz kazım/idle oyunu.
Bu dosya oturumlar arası bağlamı taşır; her kod değişikliğinden sonra güncellenir.

---

## 1. Temel kurallar

- **Arayüz dili Türkçe.** Tüm kullanıcı metinleri, kod yorumları ve commit
  mesajları Türkçe. Commit mesajlarında Türkçe karakter **kullanma** (PowerShell
  kodlama sorunu çıkarıyor — bkz. §9).
- **Bağımlılık yok.** Framework, build adımı, paket yöneticisi yok. Sadece
  `index.html` + `css/style.css` + `js/app.js`. Harici tek kaynak Google Fonts
  ve `telegram-web-app.js`.
- **Ana sayfa tek ekran.** Kaydırma yok. Yeni öğe eklerken bu kural korunmalı.
- **Her değişiklikten sonra ölü kod taraması yapılır** (§8).

---

## 2. Dosya haritası

```
index.html          Tüm arayüz (tek sayfa, sekmeler ile geçiş)
css/style.css       Tema, animasyonlar, responsive düzen
js/app.js           Tek IIFE: kazım motoru, oyun, Telegram köprüsü, kayıt
serve.js            Yerel test sunucusu (node serve.js → :8080)
assets/scene.jpg    Maden sahnesi, 864x700 (kaynaktan y=240..940 kırpıldı)
assets/coin.png     Tree-of-life coin, dairesel alfa maskeli, 320px
assets/coin-sm.png  Aynı coin, 96px (oyun içi düşen BB'ler + küçük kullanımlar)
README.md           Kullanıcıya dönük kurulum/yayın rehberi
```

Kök dizindeki `5b2aec96-*.jpg`, `a5e69f77-*.jpg`, `fd47066e-*.jpg` ve
`budding_branch_1080x1920_9x16.png` **kaynak referanslar** — uygulama bunları
kullanmıyor, `assets/` içindeki işlenmiş kopyaları kullanıyor. Silme.

---

## 3. Ekonomi ve mekanikler

İki ayrı birim var:

| Birim | Simge | Nereden gelir | Nereye harcanır |
|---|---|---|---|
| **BB** | coin | Kazımdan, gerçek zamanlı birikir | (henüz harcama yok, arz sınırsız) |
| **Puan** | ★ | Oyun Alanı'ndaki oyunlardan | Pazar yeri yükseltmeleri (şu an kapalı) |

VIP **bilet** puanla değil **BB** ile alınıyor (`VIP_ITEMS[].price` BB cinsinden).

### Ana sayfadaki üç kart

| Buton | Etki | Kilit kuralı |
|---|---|---|
| **KAZIMI BAŞLAT** | Süreye `+START_TIME_MS` ekler ve kazımı başlatır. **Kazım gücüne dokunmaz** | Kazım sürerken gri + kilitli; süre bitince açılır |
| **ŞANS KUTUSU** | Ödüllü reklam → `BOX_PRIZES` tablosundan ağırlıklı ödül verir | `BOX_COOLDOWN_MS` (3 saat) bekleme, kartta canlı geri sayım |
| **+07:00H ZAMAN EKLE** | Ödüllü reklam → süreye `+ADD_TIME_MS` | Günde `ADD_TIME_DAILY_MAX` kez; ertesi gün sıfırlanır |

**Kazım gücü sabittir.** Kullanıcı `INITIAL_RATE` ile başlar; BAŞLAT bunu
değiştirmez. Güç yalnızca pazar yeri yükseltmeleriyle artar (`currentRate()`
çarpanı). Eski kayıtlarda hız 0 ise `load()` içinde `INITIAL_RATE`'e çekilir.

Kart kilitlenince: içerik gri filtreye girer, görselin üzerine (`top:24%`) kilit
rozeti yaylanarak oturur. Açıklama satırı (`p`) daha yüksek opaklıkta bırakılır
çünkü geri sayımı taşır.

### Ayarlanabilir sabitler — `js/app.js` başı

| Sabit | Anlamı | Şu anki değer |
|---|---|---|
| `INITIAL_RATE` | Başlangıç kazım gücü (BB/saat) | `0.1` |
| `START_TIME_MS` | BAŞLAT'ın eklediği süre | 6 saat |
| `BOX_COOLDOWN_MS` | Şans kutusu bekleme | 3 saat |
| `ADD_TIME_MS` / `ADD_TIME_DAILY_MAX` | +7H süresi ve günlük hak | 7 saat / 4 |
| `AD_SECONDS` | Simüle reklam süresi | 5 |
| `LIVE_DECIMALS` / `LIVE_HEAD` | Sayaç ondalığı / büyük puntodaki | 3 / 2 |
| `LIVE_MS` | Canlı sayaç boyama aralığı | 120 ms |
| `GAME_MS` / `GAME_POINT_PER_ITEM` | Oyun süresi / sembol başına puan | 60 sn / 1 |
| `BOMB_CHANCE` / `BOMB_PENALTY` | Bomba olasılığı / cezası | `0.15` / `10` |
| `SHOP_ENABLED` | Pazar yeri öğeleri açık mı | `false` |

---

## 4. Kazım motoru (`js/app.js`)

Üç ayrı döngü var, karıştırma:

1. **`accrue()`** — birikimi yapan tek yer. Geçen **gerçek süreye** dayalı
   (`Date.now() - S.lastTick`). Hem her karede hem saniyelik döngüde çağrılabilir,
   çift saymaz çünkü tüketilen süre `lastTick` ile ilerler. 1 saatlik birikim tam
   olarak `currentRate()` kadardır. `dt` 12 saatle sınırlı (aşırı sıçrama koruması).
2. **`frame()`** — rAF döngüsü, `LIVE_MS` aralıklı. Sadece `accrue()` + canlı
   sayaç boyaması. rAF kullanılıyor ki sekme arka plana geçince tarayıcı durdursun.
3. **`tick()`** — 1 sn'lik `setInterval`. Durum geçişleri (oturum bitişi, uçan
   +BB) ve tam `render()`.

`offlineCatchUp()` uygulama kapalıyken geçen süreyi (12 saat tavanla) işler ve
dönüşte özet modalı gösterir. `accrue()` ile çakışmaz çünkü ikisi de `lastTick`
tüketir.

### Kayıt

`localStorage` anahtarı **`bb_mining_state_v2`**. Kayıt: 10 sn periyot +
sekme gizlenince + her aksiyondan sonra (250 ms debounce). Durum şeması
değişirse anahtarı `v3`'e al, yoksa eski kayıtlar bozuk duruma yol açar.

> **Sıfırlama tuzağı.** `location.reload()` çağrısı `pagehide` olayını tetikliyor,
> o da `saveNow()` çalıştırıp silinen kaydı geri yazıyordu — sıfırlama sessizce
> boşa gidiyordu. Çözüm: `resetting` bayrağı. `save()` ve `saveNow()` bu bayrak
> açıkken hiçbir şey yazmıyor. Kayda yazan yeni bir yol eklersen aynı bayrağı
> kontrol ettir.

---

## 5. Oyun Alanı

`GAMES` dizisi kutucukları üretir, satır başına 3 tane. Yeni oyun eklemek için:
diziye bir satır + `openGame()` içine bir dal.

**Kripto Yağmuru** (`bbrain`) — 60 sn, 3-2-1 geri sayımla başlar. Düşen sembollere
`pointerdown` ile dokunulur. Zorluk: doğma aralığı 620 ms → 280 ms, düşme hızı
`prog` ile artar.

Düşen nesneler `CRYPTOS` dizisinde tanımlı inline SVG'ler (BTC / ETH / SOL / XRP).
`BOMB_CHANCE` olasılıkla bunun yerine `BOMB_SVG` bombası düşer; bombaya dokunmak
toplananı `BOMB_PENALTY` kadar azaltır (0'ın altına inmez) ve ekranda kırmızı
flaş + `-10` etiketi gösterir. Yeni sembol eklemek için `CRYPTOS`'a bir satır yeter.

> **Önemli:** BB doğma anı `G.nextSpawn` **mutlak zaman damgasına** bağlı,
> kare süresi biriktirmeye değil. Kare düşerse doğma hızı gerçek zamanın
> gerisinde kalmasın diye böyle.

Erken çıkışta (`closeGame`) tur normal biter ve o ana kadar toplananlar verilir.

---

## 6. Telegram entegrasyonu

- `boot()` içinde: `ready()`, `expand()`, tema renkleri, `disableVerticalSwipes()`,
  `enableClosingConfirmation()`.
- **Tam ekran:** `requestFullscreen()` (Bot API 8.0). Menü butonundan açılınca
  Telegram başlık çubuğu gösteriyor, ana ekrandan açılınca göstermiyor; bu çağrı
  ikisini de tam ekrana çekiyor. `fullscreenChanged`/`fullscreenFailed`
  dinleyicileri **istekten önce** bağlanır, yoksa hızlı dönen olay kaçar.
  8.0 öncesi istemcilerde sessizce yok sayılır, `expand()` davranışı sürer.
- **Güvenli alan:** Tam ekranda Telegram kendi kapat/menü butonlarını uygulamanın
  üzerine bindiriyor. `--safe-t` şu üçünün en büyüğü:
  `env(safe-area-inset-top)`, `--tg-safe-area-inset-top + --tg-content-safe-area-inset-top`,
  ve `body.tg-fs` altında **25px taban**. Tam ekranda `--top-gap` 36px → 10px'e
  düşer çünkü güvenli alan zaten aşağı itiyor.
- **Ödüllü reklam:** `watchRewardedAd()` şu an simülasyon. Gerçek SDK'ya geçerken
  **sadece bu fonksiyonun gövdesi** değişir; tamamlandıysa `true`, iptalde `false`
  döndürsün. Çağıranlar ödülü yalnızca `true` gelince veriyor.
- **Derin bağlantı:** `?tab=games`, `#market` veya `start_param=tab_wallet`.

---

## 7. Kilitli / kapalı bölümler

| Bölüm | Durum | Açma yolu |
|---|---|---|
| Pazar yeri yükseltmeleri | Gizli (VIP bilet görünür) | `SHOP_ENABLED = true` |
| Görevler, Cüzdan | "YAKINDA GELİYOR" ekranı | `.soon` bloğunu sil + `is-locked` sınıfını kaldır |
| **Referans ekranı** | Boş `.screen` overlay (`#refView`) | `.soon` bloğunu içerikle değiştir |
| Bilet’in işlevi | Tanımsız — sadece sayaç artıyor | `S.vip.ticket` sayacını kullanan kodu yaz |
| Oyun 2 ve 3 | Kilitli kutucuk | `GAMES` içinde `ready: true` |

**Referans ekranı** üst bardaki `#btnRef` (zilin solunda) ile açılıyor. `.screen`
sınıfı tam sayfa alt ekran kalıbı — geri butonu + başlık + kaydırılabilir gövde.
Yeni tam sayfa ekranlar için bu kalıbı kullan. `shareInvite()` hâlâ duruyor
(görev `t4` ve cüzdandaki davet butonu kullanıyor).

`SHOP` dizisi, `priceOf()` ve öğe çizim kodu duruyor — bayrak `true` olunca
çalışır. `TASKS` dizisi ve `paintTasks()` de aynı şekilde hazır.

**Kaldırılan özellikler** (geri isteniyorsa git geçmişinden alınır):
Canlı Bot (`9063ef7` öncesi), 2X kazım yükseltmesi (`f3b582c` öncesi),
Kalan BB / sınırlı arz (`cac52b9` öncesi), BAŞLAT'ın güç ekleme mekaniği ve
Sosyal butonu (`2e46a04` öncesi).

---

## 8. Değişiklik sonrası ölü kod taraması

**Her kod değişikliğinden sonra proje kökünde çalıştır:**

```bash
node tools/sweep.js
```

Şunları tarar: kullanılmayan JS fonksiyon/sabitleri, ölü `el.*` kısayolları,
HTML/JS’te geçmeyen CSS sınıfları, kullanılmayan CSS değişkenleri ve
`@keyframes`, hiçbir yerde referans edilmeyen HTML `id`’leri.

**Bilinen yanlış pozitifler** — bunlar ölü değil, silme:

| Bulgu | Neden ölü değil |
|---|---|
| `#setHaptic`, `#setSound`, `#setAnim`, `#setNotify` | `setMap` nesnesinde anahtar olarak geçiyor |
| SVG gradyan id’leri (`pkSteel`, `chGold`, `tkBody` …) | `url(#id)` ile kullanılıyor |
| `.shop-*`, `.task-*`, `.wallet-*`, `.led-*`, `.soon*` | Kapalı bölümlerin stilleri |

## 9. Ortam tuzakları (acı deneyimler)

**PowerShell + Türkçe karakter.** `Get-Content -Raw` dosyayı Windows-1254 olarak
okuyor, `Set-Content -Encoding UTF8` ile yazınca çift kodlama oluyor (mojibake).
CSS/HTML/JS'te **toplu `-replace` yapma**. Bunun yerine Edit aracını veya
`node -e` / ayrı bir `.js` betiği kullan. Bir kez bozuldu, onarımı:
`[Text.Encoding]::UTF8.GetString([Text.Encoding]::Default.GetBytes($raw))`.

**Commit mesajları.** Here-string (`@'...'@`) içinde çift tırnak varsa parser
bozuluyor. Mesajı scratchpad'e dosya olarak yaz, `git commit -F <dosya>` ile ver.
Türkçe karakter kullanma.

**Remove-Item.** Aynı blokta `& "C:\Program Files\..."` çağrısıyla birlikte
kullanılınca bir koruma tüm bloğu iptal ediyor. Silmeyi **ayrı blokta** yap.

**Chrome headless — üç önemli sınır:**
1. Viewport genişliği **en az 500px**. `--window-size=390,844` versen de sayfa
   500px'te render edilip 390'a kırpılıyor → sahte "taşma" görüntüsü.
   Dar ekran testi için `.app-frame{max-width:360px}` enjekte et.
2. `--virtual-time-budget` altında **rAF neredeyse donuyor** (9 sn'de ~5 kare).
   Oyun ve canlı sayaç orada çalışmaz. Oyunu test etmek için geçici olarak
   `window.__gf = (t) => gameFrame(t)` aç ve `setInterval` ile sür.
3. Yeni açılan overlay'ler (`.modal`, `.adview`, `.gameview`) ekran görüntüsünde
   **yarı saydam** görünebiliyor — compositor artefaktı, gerçek hata değil.
   Doğrulamak için overlay'i tek başına açıp ayrı görüntü al.

**Yerel sunucu** arada düşüyor. "ulaşılamıyor" görürsen:
`Start-Process node -ArgumentList serve.js -WorkingDirectory <proje> -WindowStyle Hidden`

---

## 10. Yayın

Statik dosyalar → GitHub Pages / Netlify / Vercel.
Repo: **https://github.com/Themucahit25/BUDDING-BRANCH** (public, `main`).

> **Public repo uyarısı:** `js/app.js` herkese açık. Bot token'ı, API anahtarı
> veya gizli uç nokta **asla** buraya girmemeli.

**Backend'e taşırken:** İlerleme şu an cihazda; kullanıcı `localStorage`'ı
düzenleyip bakiyeyi kendi yazabilir. Gerçek ekonomi için `save()`/`load()`
kendi API'ne bağlanmalı ve `Telegram.WebApp.initData` sunucuda bot token'ı ile
HMAC-SHA256 doğrulanmalı.
