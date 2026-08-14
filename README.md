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
- Altın kenarlı "Toplam Kazılan BB" barı + uçan `+BB` efektleri
- 3 aksiyon kartı: **Kazımı Başlat**, **Kazımı 2X Yükselt**, **+12:00H Zaman Ekle**
- Kazım aktifken sahne hızlanır: tüm parıltılar 2-3x hızlanır, sahneye sıcak bir iç ışıma gelir,
  başlat kartı yeşil nabız halkası alır

### Şu an kilitli bölümler

Pazar Yeri, Canlı Bot, Görevler ve Cüzdan sekmeleri **"YAKINDA GELİYOR"** ekranı gösteriyor.
Kod ve arayüzleri hazır, sadece gizli:

- **Pazar Yeri** — 4 kalıcı yükseltme (kazma / matkap / ekip / tılsım), üstel fiyatlama
- **Canlı Bot** — 8 saatlik vardiya, %50 verimle sen yokken kazar
- **Görevler** — kanal/grup/X takibi, davet, seri kazım ödülleri
- **Cüzdan** — bakiye kartı, kaynak dağılımı, işlem defteri, çekim talebi

Bir bölümü açmak için `index.html` içinde o bölümün `.soon` bloğunu sil ve
ilgili elemandan `is-locked` sınıfını kaldır. Başka bir değişiklik gerekmiyor —
JS tarafı zaten çalışıyor.
**Ayarlar** — titreşim, ses, animasyon, bildirim anahtarları + sıfırlama

**Motor**
- 1 sn'lik tick ile gerçek zamanlı birikim
- Çevrimdışı kazanç: uygulamayı kapatınca da (12 saat tavanla) kazanç işlenir ve dönüşte özet gösterilir
- `localStorage` ile otomatik kayıt (10 sn periyot + sekme gizlenince anında)
- Telegram HapticFeedback, `expand()`, tema rengi, davet paylaşımı entegre
- Derin bağlantı: `?tab=wallet`, `#market` veya Telegram `start_param=tab_tasks` ile
  doğrudan ilgili sekme açılır

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
| `BASE_RATE` | Temel kazım hızı (BB/saat) | `12.5` |
| `SESSION_MS` | İlk oturum süresi | 24 saat |
| `MAX_TIME_MS` | Biriktirilebilir süre tavanı | 48 saat |
| `ADD_TIME_MS` | Zaman ekle butonu | 12 saat |
| `BOOST_MS` | 2X süresi | 4 saat |
| `BOT_MS` / `BOT_EFFICIENCY` | Bot vardiyası ve verimi | 8 saat / %50 |

## Backend'e taşırken

Şu an tüm ilerleme cihazda tutuluyor — kullanıcı `localStorage`'ı temizleyip sıfırlayabilir.
Gerçek ekonomi için `save()` / `load()` fonksiyonlarını kendi API'nize bağlayın ve
`Telegram.WebApp.initData` değerini sunucuda bot token'ı ile doğrulayın (HMAC-SHA256).
