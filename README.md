# BUDDING BRANCH — Mining Mini App

Telegram Mini App olarak çalışan, tamamen bağımsız (backend'siz) bir kazım/idle oyunu arayüzü.
Tema ve palet `budding_branch_1080x1920_9x16.png` mockup'ından örneklendi.

## Dosyalar

```
index.html          Arayüz
css/style.css       Tema, animasyonlar, responsive düzen
js/app.js           Kazım motoru, Telegram köprüsü, kayıt sistemi
serve.js            Yerel test sunucusu (node serve.js)
assets/scene.jpg    Maden sahnesi çizimi (864x1920, alt kısmı kreme fade)
assets/coin.png     Tree-of-life coin, dairesel kırpılmış + şeffaf (320px)
assets/coin-sm.png  Aynı coin, küçük kullanımlar için (96px)
```

Coin PNG'leri kaynak `fd47066e-*.jpg` dosyasından script ile üretildi: kare kırpma
(merkez 624,606 / yarıçap 578) + dairesel alfa maskesi. Siyah zemin böylece tamamen kalkıyor.

## Palet (mockup'tan örneklendi)

| Token | Değer | Kullanım |
|---|---|---|
| `--cream` | `#faf0e3` | sayfa zemini |
| `--card` | `#fffbf3` | kartlar |
| `--forest` | `#0b381e` | toplam kazılan barı, cüzdan kartı |
| `--rim` | `#c9a24a` | altın kenarlıklar |
| `--green` | `#339701` | marka yeşili, aktif sekme |
| `--gold` / `--orange` | `#ec9a04` / `#ec6004` | altın kartlar, başlat butonu |
| `--blue` | `#006fec` | 2X kartı |

## Özellikler

**Ana Sayfa**
- **Tek ekran**: kaydırma yok. Sahne `flex:1` ile kalan dikey boşluğu doldurur,
  diğer her şey sabit yüksekliktedir. `assets/scene.jpg` bu iş için kaynaktan
  864x700 olarak kırpıldı (y 240..940) ve `object-position:center top` ile üste
  sabitlendi — ekran kısaldıkça alttan kırpılır, madenci ve maden girişi hep görünür.
- Tam genişlik maden sahnesi + üzerine bindirilmiş CSS ışık katmanları:
  yavaş ken-burns kaydırma, güneş ışını süpürmesi, fenerde titreyen alev parıltısı,
  maden girişinden sızan sıcak ışık, kristal ve altın parıltısı, yükselen toz zerrecikleri
  (her katman resimdeki gerçek nesnenin koordinatına oturtuldu)
- Kazım hızı / kalan süre HUD kartları
- Altın kenarlı "Toplam Kazılan BB" **canlı sayacı**: 5 ondalık, ilk 2'si büyük
  puntoda, son 3'ü küçük ve soluk akan hanelerde. Birikim geçen gerçek süreye
  dayalı (`accrue()`), yani 1 saatte tam olarak kazım hızı kadar. Boyama
  `LIVE_MS` aralıklı rAF döngüsünde — sekme arka plana geçince kendiliğinden durur.
- Uçan `+BB` efektleri
- 3 aksiyon kartı — kilit durumları animasyonlu (gri filtre + ortaya oturan kilit rozeti)
- Kazım aktifken sahne hızlanır: tüm parıltılar 2-3x hızlanır, sahneye sıcak bir iç ışıma gelir,
  başlat kartı yeşil nabız halkası alır

## Puan ekonomisi (★)

BB'den ayrı ikinci bir birim. Oyunlardan kazanılır, pazar yerinde harcanır:

```
Oyun oyna  →  ★ puan  →  Pazar yeri yükseltmesi  →  daha yüksek kazım hızı  →  daha çok BB
```

**Oyun Alanı** — satır başına 3 kutucuk. Yeni oyun eklemek için `js/app.js`
içindeki `GAMES` dizisine bir satır ve `openGame()` içine bir dal yeter.

- **BB Yağmuru** (hazır) — 60 saniye. Yukarıdan düşen BB sembollerine dokunup topla.
  Toplanan her BB = `GAME_POINT_PER_BB` puan. Süre ilerledikçe düşme sıklığı ve hızı artar.
  Erken çıkışta o ana kadar toplananlar yine hesaba geçer.
- Diğer iki kutucuk `ready:false` ile kilitli görünüyor.

**Pazar Yeri** — şu an **boş**. Öğeler geçici olarak kapalı: `js/app.js` içindeki
`SHOP_ENABLED` bayrağı `false`. `true` yapınca 4 kalıcı yükseltme geri geliyor
(kazma 40, matkap 200, ekip 800, tılsım 3.000 ★, her seviyede üstel artış);
çizim kodu ve `SHOP` dizisi olduğu gibi duruyor.

### Şu an kilitli bölümler

Görevler ve Cüzdan sekmeleri **"YAKINDA GELİYOR"** ekranı gösteriyor; arayüzleri hazır,
`is-locked` ile gizli. Açmak için o bölümün `.soon` bloğunu sil ve `is-locked` sınıfını
kaldır — JS tarafı zaten çalışıyor.
**Ayarlar** — titreşim, ses, animasyon, bildirim anahtarları + sıfırlama

## Kazım döngüsü

Kullanıcı **sıfırdan** başlar: hız 0, süre 0, toplam 0.

| Buton | Etki | Kilit kuralı |
|---|---|---|
| **KAZIMI BAŞLAT** | Hıza `+RATE_STEP` (0,01 BB/sa) ve süreye **+12 saat** ekler, kazımı başlatır | Kazım sürerken gri + kilitli; süre bitince tekrar açılır |
| **ŞANS KUTUSU** | Ödüllü reklam → kutuyu açar | **3 saatte bir** açılabilir; açıldıktan sonra gri + kilitli, kart üzerinde geri sayım |
| **+12:00H ZAMAN EKLE** | Ödüllü reklam → süreye **+12 saat** ekler | Günde en fazla **4 kez**; hak dolunca kilitlenir, ertesi gün sıfırlanır |

Kart kilitlendiğinde içerik gri filtreye girer ve görselin üzerine kilit rozeti yaylanarak
oturur; başlık ve geri sayım okunur kalır.

> **Şans kutusunun ödülleri henüz yok.** Şu an yalnızca açılış ve 3 saatlik bekleme
> süresi işliyor. Ödül eklerken `actBox` dinleyicisinde `S.boxNextAt` atamasının
> yanına ödül kodunu yazman yeterli.

### Ödüllü reklamı gerçek SDK'ya bağlama

`js/app.js` içindeki `watchRewardedAd()` şu an simülasyon: `AD_SECONDS` saniye
geri sayar ve ödülü verir. Gerçek sağlayıcıya geçerken sadece bu fonksiyonun
gövdesini değiştir — izleme tamamlandıysa `true`, iptal/hata durumunda `false` döndür.
Çağıran taraf ödülü yalnızca `true` gelirse veriyor, başka değişiklik gerekmiyor.

```js
// Örn. Adsgram
return AdController.show().then(() => true, () => false);
```

**Motor**
- 1 sn'lik tick ile gerçek zamanlı birikim
- Çevrimdışı kazanç: uygulamayı kapatınca da (12 saat tavanla) kazanç işlenir ve dönüşte özet gösterilir
- `localStorage` ile otomatik kayıt (10 sn periyot + sekme gizlenince anında)
- Telegram HapticFeedback, `expand()`, tema rengi, davet paylaşımı entegre
- Derin bağlantı: `?tab=wallet`, `#market` veya Telegram `start_param=tab_tasks` ile
  doğrudan ilgili sekme açılır

## Tam ekran

Mini App menü butonundan açılınca Telegram üstte bir başlık çubuğu gösteriyor,
ana ekrandan açılınca göstermiyor. `requestFullscreen()` (Bot API 8.0) ikisini de
tam ekrana çekiyor — `boot()` içinde çağrılıyor.

Tam ekranda Telegram kendi kapat/menü butonlarını uygulamanın **üzerine** bindiriyor.
İçeriğin altlarında kalmaması için üst boşluk şu değişkenlerden hesaplanıyor:

```
--safe-t = max( env(safe-area-inset-top),
                --tg-safe-area-inset-top + --tg-content-safe-area-inset-top )
```

`body.tg-fs` sınıfı tam ekranken ekleniyor ve 30px'lik bir taban boşluk garantiliyor
(içerik güvenli alanını bildirmeyen istemciler için).

**Desteklemeyen istemcide** çağrı yok sayılıyor, `expand()` ile eski davranış sürüyor —
yani Telegram 8.0 öncesi sürümlerde başlık çubuğu görünmeye devam eder. Bu istemci
tarafı bir sınır, koddan aşılamıyor.

## Yerel test

```powershell
cd c:\Users\Karaduman1\Desktop\x
python -m http.server 8080
```
Sonra tarayıcıda `http://localhost:8080` — mobil görünüm için DevTools cihaz modunu aç.

## Telegram'a bağlama

1. Dosyaları HTTPS bir yere yükle (GitHub Pages, Netlify, Vercel, Cloudflare Pages — hepsi statik, ücretsiz).
2. Telegram'da [@BotFather](https://t.me/BotFather) → `/newbot` ile bot oluştur.
3. `/newapp` (veya `/mybots` → Bot Settings → Menu Button → Configure) → Mini App URL'ini gir.
4. Botu aç, menü butonuna bas — uygulama tam ekran açılır.

> Not: `telegram-web-app.js` yalnız Telegram içinde anlamlı; tarayıcıda açıldığında kod
> güvenli şekilde köprüsüz moda düşer, oyun yine tam çalışır.

## Ayarlanabilir dengeler (`js/app.js` üst kısım)

| Sabit | Anlamı | Varsayılan |
|---|---|---|
| `RATE_STEP` | BAŞLAT'ın hıza eklediği BB/saat | `0.01` |
| `START_TIME_MS` | BAŞLAT'ın eklediği süre | 12 saat |
| `BOX_COOLDOWN_MS` | Şans kutusu bekleme süresi | 3 saat |
| `SHOP_ENABLED` | Pazar yeri öğeleri açık mı | `false` |
| `ADD_TIME_MS` | +12H butonunun eklediği süre | 12 saat |
| `ADD_TIME_DAILY_MAX` | +12H günlük hak | `4` |
| `AD_SECONDS` | Simüle reklam süresi | `5` |
| `LIVE_DECIMALS` / `LIVE_HEAD` | Sayaçtaki ondalık / büyük puntoda gösterilen | `5` / `2` |
| `LIVE_MS` | Canlı sayacın boyanma aralığı (ms) | `120` |
| `GAME_MS` | Oyun süresi | 60 sn |
| `GAME_POINT_PER_BB` | Toplanan her BB'nin puan değeri | `1` |
| `BOT_MS` / `BOT_EFFICIENCY` | Bot vardiyası ve verimi | 8 saat / %50 |

> `RATE_STEP` bilinçli olarak çok düşük (12 saatlik ilk oturum ~0,12 BB verir).
> Ekonomiyi hızlandırmak istersen ilk ayarlayacağın yer burası.

## Backend'e taşırken

Şu an tüm ilerleme cihazda tutuluyor — kullanıcı `localStorage`'ı temizleyip sıfırlayabilir.
Gerçek ekonomi için `save()` / `load()` fonksiyonlarını kendi API'nize bağlayın ve
`Telegram.WebApp.initData` değerini sunucuda bot token'ı ile doğrulayın (HMAC-SHA256).
