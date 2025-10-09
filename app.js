// --- Konstanter ---
var CATS = ['Hem', 'nytt', 'favoriter', 'sök', 'Jul', 'keto', 'kött', 'kyckling', 'fisk', 'färs', 'dessert', 'bröd', 'vegetariskt', 'godis', 'övrigt'];
var LIST_CATS = CATS.filter(function (c) { return !['Hem', 'nytt', 'favoriter', 'sök'].includes(c); });
var coll = new Intl.Collator('sv', { sensitivity: 'base' });

// Tom-bild
var DEFAULT_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="100%" height="100%" fill="#203228"/><text x="400" y="300" fill="#cfe9dd" font-family="Segoe UI, Arial" text-anchor="middle" font-size="42" dy=".35em">Ingen bild</text></svg>'
);

// randomUUID fallback
function uuidv4() {
    var cryptoObj = (window.crypto || window.msCrypto);
    if (cryptoObj && cryptoObj.getRandomValues) {
        var buf = new Uint8Array(16);
        cryptoObj.getRandomValues(buf);
        buf[6] = (buf[6] & 0x0f) | 0x40;
        buf[8] = (buf[8] & 0x3f) | 0x80;
        var hex = Array.prototype.map.call(buf, function (b) { return ('00' + b.toString(16)).slice(-2); }).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    } else {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
var genId = (window.crypto && window.crypto.randomUUID) ? function () { return window.crypto.randomUUID(); } : uuidv4;

// Lagring
var store = {
    key: 'baste-recepten.v4', // bumpad pga layoutförändringar
    get: function () {
        try { return JSON.parse(localStorage.getItem(this.key)) || { recipes: [], theme: 'theme-morkgron' }; }
        catch (e) { return { recipes: [], theme: 'theme-morkgron' }; }
    },
    set: function (d) { localStorage.setItem(this.key, JSON.stringify(d)); }
};

var DB = store.get();
var currentCat = 'Hem';
var wakeLock = null;

// Hjälpare
function el(s) { return document.querySelector(s); }
function all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
function parseTags(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { return x.toLowerCase(); }); }
function lines(t) { return String(t || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean); }
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

// 🔧 data:URL → Blob (för att öppna/dela bilder robust)
function dataURLtoBlob(dataUrl) {
    try {
        var parts = dataUrl.split(',');
        var mime = (parts[0].match(/:(.*?);/) || [, 'application/octet-stream'])[1];
        var bstr = atob(parts[1]);
        var n = bstr.length;
        var u8 = new Uint8Array(n);
        while (n--) u8[n] = bstr.charCodeAt(n);
        return new Blob([u8], { type: mime });
    } catch (e) {
        return null;
    }
}
// 🔧 öppna eller ladda ner en Blob
function openOrDownloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var win = window.open(url, '_blank', 'noopener');
    if (!win) {
        var a = document.createElement('a');
        a.href = url;
        a.download = filename || 'fil';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
}

// Skala ned bilder innan de sparas som data-URL
function readFilesAsDataURLs(files) {
    var MAX_SIDE = 1600;  // max bredd/höjd i px
    var QUALITY = 0.85;   // JPEG-kvalitet

    function loadAndResize(file) {
        return new Promise(function (resolve) {
            var fr = new FileReader();
            fr.onload = function () {
                var img = new Image();
                img.onload = function () {
                    var w = img.naturalWidth, h = img.naturalHeight;
                    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
                    var tw = Math.round(w * scale), th = Math.round(h * scale);
                    var canvas = document.createElement('canvas');
                    canvas.width = tw; canvas.height = th;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, tw, th);
                    var likelyAlpha = /png|webp/i.test(file.type);
                    var mime = likelyAlpha ? 'image/png' : 'image/jpeg';
                    var dataUrl = canvas.toDataURL(mime, QUALITY);
                    resolve(dataUrl);
                };
                img.src = fr.result;
            };
            fr.readAsDataURL(file);
        });
    }

    return new Promise(function (res) {
        if (!files || !files.length) return res([]);
        var out = [], i = 0;
        (function next() {
            if (i >= files.length) return res(out);
            loadAndResize(files[i++]).then(function (u) {
                out.push(u);
                next();
            }).catch(function () {
                var fr = new FileReader();
                fr.onload = function () { out.push(fr.result); next(); };
                fr.readAsDataURL(files[i - 1]);
            });
        })();
    });
}

function show(sel, visible) {
    var n = el(sel);
    if (!n) return;
    n.style.display = visible ? '' : 'none';
}

// Tema init (nu i menyn)
(function () {
    var body = document.body;
    body.classList.remove('theme-morkgron', 'theme-klassisk', 'theme-pastell');
    body.classList.add(DB.theme || 'theme-morkgron');
    function bindThemeSel() {
        var sel = el('#themeSel');
        if (sel) {
            sel.value = DB.theme || 'theme-morkgron';
            sel.addEventListener('change', function (e) {
                body.classList.remove('theme-morkgron', 'theme-klassisk', 'theme-pastell');
                body.classList.add(e.target.value);
                DB.theme = e.target.value; store.set(DB);
            });
        }
    }
    bindThemeSel();
    setTimeout(bindThemeSel, 200);
})();

// Export/Import
var exportBtn = el('#exportBtn');
if (exportBtn) {
    exportBtn.addEventListener('click', function () {
        var data = JSON.stringify(DB, null, 2);
        var blob = new Blob([data], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'baste-recepten-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });
}
var importBtn = el('#importBtn');
var importFile = el('#importFile');
if (importBtn && importFile) {
    importBtn.addEventListener('click', function () { importFile.click(); });
    importFile.addEventListener('change', function () {
        var f = importFile.files && importFile.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var incoming = JSON.parse(reader.result);
                if (!incoming || Object.prototype.toString.call(incoming.recipes) !== '[object Array]') throw new Error('Ogiltigt JSON');
                var have = new Set(DB.recipes.map(function (r) { return r.id; }));
                var add = (incoming.recipes || []).filter(function (r) { return !have.has(r.id); });
                DB.recipes = DB.recipes.concat(add);
                if (incoming.theme) DB.theme = incoming.theme;
                store.set(DB);
                alert('Importerade ' + add.length + ' recept.');
                routeTo(currentCat);
            } catch (err) {
                alert('Kunde inte importera: ' + err.message);
            }
            importFile.value = '';
        };
        reader.readAsText(f);
    });
}

/* ===== 🔒 Auto-backup när appen stängs ===== */
function backupFilename(prefix) {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return prefix + '-' +
        d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
        pad(d.getHours()) + pad(d.getMinutes()) + '.json';
}
function tryAutoExport() {
    try {
        var data = JSON.stringify(DB, null, 2);
        var blob = new Blob([data], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = backupFilename('baste-recepten-autobackup');
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { }
}
var _autoExported = false;
function scheduleAutoExport() {
    if (_autoExported) return;
    _autoExported = true;
    tryAutoExport();
}
window.addEventListener('pagehide', scheduleAutoExport, { once: true });
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') scheduleAutoExport();
}, { once: true });
/* ===== /Auto-backup ===== */

// Formkategori-chips
var selectedFormCat = null;
function renderCatChips() {
    var wrap = el('#catChips'); if (!wrap) return;
    wrap.innerHTML = '';
    LIST_CATS.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'chip'; b.textContent = c;
        if (selectedFormCat === c) b.classList.add('active');
        b.addEventListener('click', function () {
            selectedFormCat = (selectedFormCat === c ? null : c);
            renderCatChips();
        });
        wrap.appendChild(b);
    });
}
renderCatChips();

// Drawer (hamburgermeny)
var drawer = el('#drawer');
var openDrawerBtn = el('#openDrawer');
if (openDrawerBtn) openDrawerBtn.addEventListener('click', function () { openDrawer(); });
if (drawer) {
    drawer.addEventListener('click', function (e) {
        if (e.target && e.target.hasAttribute('data-close')) closeDrawer();
    });
}
function openDrawer() { if (!drawer) return; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); renderCatList(); }
function closeDrawer() { if (!drawer) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
function renderCatList() {
    var wrap = el('#catList'); if (!wrap) return;
    wrap.innerHTML = '';
    ['Hem', 'nytt', 'favoriter', 'sök'].forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'cat' + (c === currentCat ? ' active' : '');
        d.textContent = (c === 'nytt' ? '＋ Nytt' : (c === 'favoriter' ? '★ Favoriter' : (c === 'sök' ? '🔎 Sök' : '🏠 Hem')));
        d.addEventListener('click', function () { closeDrawer(); routeTo(c); });
        wrap.appendChild(d);
    });
    var hr = document.createElement('hr'); hr.style.borderColor = 'var(--border)'; wrap.appendChild(hr);
    LIST_CATS.forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'cat' + (c === currentCat ? ' active' : '');
        d.textContent = c;
        d.addEventListener('click', function () { closeDrawer(); routeTo(c); });
        wrap.appendChild(d);
    });
}

// Headerknappar
var goAddBtn = el('#goAddBtn');
var homeAddBtn = el('#homeAddBtn');
if (goAddBtn) goAddBtn.addEventListener('click', function () { routeTo('nytt'); });
if (homeAddBtn) homeAddBtn.addEventListener('click', function () { routeTo('nytt'); });
var goHomeBtn = el('#goHomeBtn');
if (goHomeBtn) goHomeBtn.addEventListener('click', function () { routeTo('Hem'); });

// Form: spara/rensa/favorit
var formFav = false;
var favToggle = el('#favToggle');
if (favToggle) {
    favToggle.addEventListener('click', function () {
        formFav = !formFav;
        favToggle.classList.toggle('active', formFav);
        favToggle.textContent = formFav ? '★ Favorit' : '☆ Lägg som favorit';
    });
}
var saveBtn = el('#saveBtn');
if (saveBtn) {
    saveBtn.addEventListener('click', function () {
        var titleEl = el('#titleInput');
        var title = titleEl ? titleEl.value.trim() : '';
        if (!title) { alert('Skriv en rubrik.'); return; }
        if (!selectedFormCat) { alert('Välj en kategori.'); return; }

        var filesEl = el('#imageInput');
        var files = filesEl ? filesEl.files : null;

        readFilesAsDataURLs(files).then(function (images) {
            var rec = {
                id: genId(),
                title: title,
                cat: selectedFormCat,
                fav: formFav,
                images: (images.length ? images : [DEFAULT_IMG]),
                ings: lines(el('#ingTextarea') ? el('#ingTextarea').value : ''),
                inst: el('#instTextarea') ? el('#instTextarea').value.trim() : '',
                tags: parseTags(el('#tagInput') ? el('#tagInput').value : ''),
                createdAt: Date.now()
            };
            DB.recipes.push(rec);
            store.set(DB);
            clearForm();
            routeTo('Hem');
        });
    });
}
var clearBtn = el('#clearBtn');
if (clearBtn) clearBtn.addEventListener('click', function () { clearForm(); });
function clearForm() {
    ['#titleInput', '#ingTextarea', '#instTextarea', '#tagInput'].forEach(function (id) { var n = el(id); if (n) n.value = ''; });
    var fi = el('#imageInput'); if (fi) fi.value = '';
    formFav = false; if (favToggle) { favToggle.classList.remove('active'); favToggle.textContent = '☆ Lägg som favorit'; }
    selectedFormCat = null; renderCatChips();
}

// Render: kort
function renderCards(list) {
    var cards = el('#cards'), alpha = el('#alphaList'), empty = el('#empty');
    if (!cards || !alpha || !empty) return;
    cards.innerHTML = '';
    if (!list || !list.length) {
        empty.style.display = 'block'; cards.style.display = 'none'; alpha.style.display = 'none'; return;
    }
    empty.style.display = 'none'; cards.style.display = 'grid'; alpha.style.display = 'none';

    list.forEach(function (r) {
        var c = document.createElement('article'); c.className = 'card';
        var img = document.createElement('img'); img.className = 'thumb'; img.alt = r.title; img.loading = 'lazy'; img.src = (r.images && r.images[0]) || DEFAULT_IMG; c.appendChild(img);
        var body = document.createElement('div'); body.className = 'card-body';
        var row = document.createElement('div'); row.className = 'title-row';
        var h = document.createElement('h3'); h.textContent = r.title; row.appendChild(h);
        var fav = document.createElement('div'); fav.className = 'fav';
        var favBtn = document.createElement('button'); favBtn.textContent = r.fav ? '★' : '☆';
        favBtn.addEventListener('click', function (e) {
            e.stopPropagation(); r.fav = !r.fav; favBtn.textContent = r.fav ? '★' : '☆'; store.set(DB);
            if (currentCat === 'favoriter') routeTo('favoriter');
        });
        fav.appendChild(favBtn); row.appendChild(fav);
        body.appendChild(row);
        var badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = r.cat; body.appendChild(badge);
        c.appendChild(body);
        c.addEventListener('click', function () { openDetail(r.id); });
        cards.appendChild(c);
    });
}

// Render: A–Ö
function renderAlphaList(list) {
    var cards = el('#cards'), alpha = el('#alphaList'), empty = el('#empty');
    if (!cards || !alpha || !empty) return;
    alpha.innerHTML = '';
    if (!list || !list.length) {
        empty.style.display = 'block'; cards.style.display = 'none'; alpha.style.display = 'none'; return;
    }
    empty.style.display = 'none'; cards.style.display = 'none'; alpha.style.display = 'grid';

    var groups = {};
    list.sort(function (a, b) { return coll.compare(a.title, b.title); }).forEach(function (r) {
        var ch = (r.title && r.title[0] ? r.title[0] : '#').toUpperCase();
        if (!groups[ch]) groups[ch] = [];
        groups[ch].push(r);
    });

    Object.keys(groups).forEach(function (letter) {
        var arr = groups[letter];
        var sec = document.createElement('section');
        var h = document.createElement('h5'); h.textContent = letter; sec.appendChild(h);
        var ul = document.createElement('ul');
        arr.forEach(function (r) {
            var li = document.createElement('li');
            var a = document.createElement('a'); a.href = '#'; a.textContent = r.title;
            a.addEventListener('click', function (e) { e.preventDefault(); openDetail(r.id); });
            li.appendChild(a); ul.appendChild(li);
        });
        sec.appendChild(ul); alpha.appendChild(sec);
    });
}

// Senaste 5 på startsidan
function renderRecent() {
    var wrap = el('#recentCards'); if (!wrap) return;
    wrap.innerHTML = '';
    var list = DB.recipes.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 5);
    list.forEach(function (r) {
        var c = document.createElement('article'); c.className = 'card';
        var img = document.createElement('img'); img.className = 'thumb'; img.alt = r.title; img.loading = 'lazy'; img.src = (r.images && r.images[0]) || DEFAULT_IMG; c.appendChild(img);
        var body = document.createElement('div'); body.className = 'card-body';
        var row = document.createElement('div'); row.className = 'title-row';
        var h = document.createElement('h3'); h.textContent = r.title; row.appendChild(h);
        var fav = document.createElement('div'); fav.className = 'fav';
        var favBtn = document.createElement('button'); favBtn.textContent = r.fav ? '★' : '☆';
        favBtn.addEventListener('click', function (e) {
            e.stopPropagation(); r.fav = !r.fav; favBtn.textContent = r.fav ? '★' : '☆'; store.set(DB);
        });
        fav.appendChild(favBtn); row.appendChild(fav);
        body.appendChild(row);
        var badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = r.cat; body.appendChild(badge);
        c.appendChild(body);
        c.addEventListener('click', function () { openDetail(r.id); });
        wrap.appendChild(c);
    });
}

// Routing
function routeTo(cat) {
    currentCat = cat;
    var isHome = (cat === 'Hem');
    var isNew = (cat === 'nytt');
    var isFav = (cat === 'favoriter');
    var isSearch = (cat === 'sök');

    show('#homeIntro', isHome);
    show('#recentWrap', isHome);
    show('#addView', isNew);
    show('#searchBar', isSearch);

    show('#cards', false);
    show('#alphaList', false);
    show('#empty', false);

    var list = DB.recipes.slice();

    if (isHome) {
        renderRecent();
    } else if (isFav) {
        renderCards(list.filter(function (r) { return r.fav; }));
    } else if (isSearch) {
        renderCards(list);
    } else if (isNew) {
        // bara formuläret
    } else {
        renderAlphaList(list.filter(function (r) { return r.cat === cat; }));
    }

    show('#toolsWrap', true);
    closeDrawer();
}

// Sök
var searchBtn = el('#searchBtn');
var searchClear = el('#searchClear');
var searchInput = el('#searchInput');
if (searchBtn) searchBtn.addEventListener('click', runSearch);
if (searchClear) searchClear.addEventListener('click', function () { if (searchInput) searchInput.value = ''; routeTo('sök'); });
if (searchInput) searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
function runSearch() {
    var q = (searchInput && searchInput.value || '').trim().toLowerCase();
    var list = DB.recipes.filter(function (r) {
        if ((r.title || '').toLowerCase().includes(q)) return true;
        if ((r.ings || []).some(function (i) { return (i || '').toLowerCase().includes(q); })) return true;
        if ((r.tags || []).some(function (t) { return (t || '').toLowerCase().includes(q); })) return true;
        return false;
    });
    renderCards(list);
}

// Detaljvy
var detail = el('#detail');
var detailTitle = el('#detailTitle');
var detailCat = el('#detailCat');
var detailFav = el('#detailFav');
var detailIngs = el('#detailIngs');
var detailIngsWrap = el('#detailIngsWrap');
var detailInst = el('#detailInst');
var detailInstWrap = el('#detailInstWrap');
var detailMain = el('#detailMain');
var detailThumbs = el('#detailThumbs');
var detailTagsWrap = el('#detailTagsWrap');
var deleteBtn = el('#deleteBtn');

var openedId = null;

function openDetail(id) {
    var r = DB.recipes.find(function (x) { return x.id === id; }); if (!r) return;
    openedId = id;

    if (detailTitle) detailTitle.textContent = r.title;
    if (detailCat) detailCat.textContent = r.cat;

    if (detailFav) {
        detailFav.classList.toggle('active', !!r.fav);
        detailFav.textContent = r.fav ? '★ Favorit' : '☆ Favorit';
    }

    var imgs = (r.images && r.images.length ? r.images : [DEFAULT_IMG]);
    if (detailMain) detailMain.src = imgs[0];
    if (detailThumbs) {
        detailThumbs.innerHTML = '';
        imgs.forEach(function (src, i) {
            var t = document.createElement('img'); t.src = src; t.alt = r.title + ' bild ' + (i + 1);
            t.addEventListener('click', function () { if (detailMain) detailMain.src = src; });
            detailThumbs.appendChild(t);
        });
    }

    if (detailTagsWrap) {
        if (r.tags && r.tags.length) {
            detailTagsWrap.style.display = 'flex';
            detailTagsWrap.innerHTML = '';
            r.tags.forEach(function (t) {
                var span = document.createElement('span'); span.className = 'tag'; span.textContent = '#' + t; detailTagsWrap.appendChild(span);
            });
        } else {
            detailTagsWrap.style.display = 'none'; detailTagsWrap.innerHTML = '';
        }
    }

    if (detailIngsWrap && detailIngs) {
        detailIngsWrap.style.display = (r.ings && r.ings.length) ? 'block' : 'none';
        detailIngs.innerHTML = (r.ings || []).map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('');
    }
    if (detailInstWrap && detailInst) {
        detailInstWrap.style.display = r.inst ? 'block' : 'none';
        detailInst.textContent = r.inst || '';
    }

    if (detail && detail.showModal) detail.showModal();
    requestWakeLock();
}

var closeDetailBtn = el('#closeDetail');
if (closeDetailBtn) closeDetailBtn.addEventListener('click', function () { if (detail && detail.close) detail.close(); releaseWakeLock(); });

// ✔️ Öppna bild: robust för data:-URL och popup-blockers
var openImageBtn = el('#openImage');
if (openImageBtn) {
    openImageBtn.addEventListener('click', function () {
        var src = detailMain && detailMain.src;
        if (!src) return;
        if (src.startsWith('data:')) {
            var blob = dataURLtoBlob(src);
            if (blob) {
                var ext = (blob.type === 'image/png') ? '.png' :
                    (blob.type === 'image/jpeg') ? '.jpg' :
                        (blob.type === 'image/webp') ? '.webp' : '';
                openOrDownloadBlob(blob, (detailTitle && detailTitle.textContent || 'bild') + ext);
                return;
            }
        }
        var win = window.open(src, '_blank', 'noopener');
        if (!win) {
            var a = document.createElement('a');
            a.href = src;
            a.download = (detailTitle && detailTitle.textContent) || 'bild';
            a.click();
        }
    });
}
if (detail) detail.addEventListener('close', function () { releaseWakeLock(); });

// ⭐ Favorit-toggling i detail
if (detailFav) {
    detailFav.addEventListener('click', function () {
        var r = DB.recipes.find(function (x) { return x.id === openedId; }); if (!r) return;
        r.fav = !r.fav; store.set(DB);
        detailFav.classList.toggle('active', !!r.fav);
        detailFav.textContent = r.fav ? '★ Favorit' : '☆ Favorit';
        if (currentCat === 'favoriter') routeTo('favoriter');
    });
}

// ✔️ Dela: försök bild + full text (Web Share L2), annars smart fallback
var shareBtn = el('#shareBtn');
if (shareBtn) {
    shareBtn.addEventListener('click', function () {
        var r = DB.recipes.find(function (x) { return x.id === openedId; });
        if (!r) return;

        var text = r.title + '\nKategori: ' + r.cat
            + (r.tags && r.tags.length ? '\nTaggar: ' + r.tags.join(', ') : '')
            + (r.ings && r.ings.length ? '\n\nIngredienser:\n- ' + r.ings.join('\n- ') : '')
            + (r.inst ? '\n\nInstruktioner:\n' + r.inst : '');

        var firstImg = (r.images && r.images[0]) || '';
        var canAttachImage = firstImg && firstImg.startsWith('data:') && firstImg.length < 15 * 1024 * 1024;

        try {
            if (navigator.canShare && canAttachImage) {
                var blob = dataURLtoBlob(firstImg);
                if (blob) {
                    var fileExt = (blob.type === 'image/png') ? '.png' :
                        (blob.type === 'image/webp') ? '.webp' : '.jpg';
                    var file = new File([blob], (r.title || 'recept') + fileExt, { type: blob.type || 'image/jpeg' });
                    if (navigator.canShare({ files: [file] })) {
                        navigator.share({ title: r.title, text: text, files: [file] }).catch(function () { });
                        return;
                    }
                }
            }
        } catch (e) { /* fortsätt till fallback */ }

        if (navigator.share) {
            navigator.share({ title: r.title, text: text }).catch(function () { });
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                alert('Receptet kopierades till urklipp (text). Klistra in i din app/chatt.');
            }).catch(function () {
                var blob = new Blob([text], { type: 'text/plain' });
                openOrDownloadBlob(blob, (r.title || 'recept') + '.txt');
            });
        } else {
            var blob = new Blob([text], { type: 'text/plain' });
            openOrDownloadBlob(blob, (r.title || 'recept') + '.txt');
        }
    });
}

var printBtn = el('#printBtn');
if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

// Ta bort recept
if (deleteBtn) {
    deleteBtn.addEventListener('click', function () {
        if (!openedId) return;
        var idx = DB.recipes.findIndex(function (x) { return x.id === openedId; });
        if (idx === -1) return;
        if (!confirm('Ta bort detta recept? Det går inte att ångra.')) return;
        DB.recipes.splice(idx, 1);
        store.set(DB);
        openedId = null;
        if (detail && detail.close) detail.close();
        routeTo(currentCat);
    });
}

// Wake Lock
function requestWakeLock() { try { if ('wakeLock' in navigator) { navigator.wakeLock.request('screen').then(function (lock) { wakeLock = lock; }); } } catch (e) { } }
function releaseWakeLock() { try { if (wakeLock && wakeLock.release) { wakeLock.release(); } } catch (e) { } finally { wakeLock = null; } }

// Bootstrap
(function () {
    renderCatList();
    routeTo('Hem');

    if (DB.recipes.length === 0) {
        // Förifyllt recept: Pepparkaksdeg utan "socker" – läggs i Jul (fav) och i keto
        var baseTags = ['jul', 'keto', 'sockerfri', 'pepparkakor'];
        var pepparkaksRecept = {
            id: genId(),
            title: 'Pepparkaksdeg utan "socker"',
            cat: 'Jul',
            fav: true,
            images: [DEFAULT_IMG],
            tags: baseTags,
            ings: [
                '100 g smör',
                '1 dl sötning (t.ex. erytritol/stevia-blandning eller Sukrin Gold)',
                '1 msk pepparkakskryddor (kanel, ingefära, nejlika, kardemumma)',
                '1 ägg',
                '4 dl mandelmjöl',
                '1 dl kokosmjöl',
                '1 tsk bakpulver',
                '1 krm salt'
            ],
            inst: '1. Smält smör, sötning och kryddor i kastrull. Låt svalna något.\n2. Vispa ner ägget.\n3. Blanda torra ingredienser separat.\n4. Rör ihop allt till en deg.\n5. Vila i kyl minst 1 timme (gärna över natt).\n6. Kavla ut mellan bakplåtspapper, stansa figurer.\n7. Grädda 8–10 min i 175°C. Låt svalna helt för krisp.',
            createdAt: Date.now()
        };

        var ketoKopia = JSON.parse(JSON.stringify(pepparkaksRecept));
        ketoKopia.id = genId();
        ketoKopia.cat = 'keto';
        ketoKopia.fav = false;

        DB.recipes.push(pepparkaksRecept);
        DB.recipes.push(ketoKopia);

        store.set(DB);
        routeTo('Hem');
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(function () { });
    }
})();