/* Ölü kod taraması — proje kökünden çalıştır: node <bu dosya> */
const fs = require('fs');
const js = fs.readFileSync('js/app.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const markup = html + js;

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const count = (hay, re) => (hay.match(re) || []).length;
const show = (title, list) => {
  console.log('=== ' + title + ' ===');
  console.log(list.length ? list.map((x) => '  ' + x).join('\n') : '  (temiz)');
};

/* --- JS: tanımlı ama kullanılmayan fonksiyon / SABİT --- */
const names = new Set();
for (const m of js.matchAll(/^\s*function\s+([A-Za-z_]\w*)/gm)) names.add(m[1]);
for (const m of js.matchAll(/^\s*const\s+([A-Z_][A-Z0-9_]*)\s*=/gm)) names.add(m[1]);
show('olu JS', [...names].filter((n) => count(js, new RegExp('\\b' + esc(n) + '\\b', 'g')) <= 1));

/* --- JS: kullanılmayan el.* kısayolu --- */
show('olu el.* kisayolu',
  [...js.matchAll(/^\s*([a-zA-Z]\w*):\s*\$\(/gm)].map((m) => m[1])
    .filter((k) => !new RegExp('el\\.' + esc(k) + '\\b').test(js))
    .map((k) => 'el.' + k));

/* --- CSS: HTML/JS'te hiç geçmeyen sınıf --- */
const cls = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
show('olu CSS sinif',
  [...cls].filter((c) => !new RegExp('["\'\\s.]' + esc(c) + '(["\'\\s.)]|$)').test(markup))
    .map((c) => '.' + c));

/* --- CSS: kullanılmayan değişken (tg-* Telegram'ın, atlanır) --- */
const vars = new Set([...css.matchAll(/--([\w-]+):/g)].map((m) => m[1]).filter((v) => !v.startsWith('tg-')));
show('olu CSS degisken',
  [...vars].filter((v) => !new RegExp('var\\(--' + esc(v)).test(css)).map((v) => '--' + v));

/* --- CSS: kullanılmayan keyframes --- */
const kf = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
show('olu keyframes',
  [...kf].filter((k) => !new RegExp('animation[^;]*\\b' + esc(k) + '\\b').test(css)));

/* --- HTML: hiçbir yerde referans edilmeyen id --- */
show('olu HTML id',
  [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]).filter((i) =>
    !new RegExp('[\'"]' + esc(i) + '[\'"]').test(js) &&
    !new RegExp('url\\(#' + esc(i) + '\\)').test(html) &&
    !new RegExp('\\b' + esc(i) + '\\b').test(css)).map((i) => '#' + i));
