// Bäste recepten – app.js (kompatibel, med Ta bort)

// --- Konstanter ---
var CATS = ['Hem', 'keto', 'kött', 'kyckling', 'fisk', 'färs', 'dessert', 'bröd', 'vegetariskt', 'godis', 'övrigt', 'favoriter', 'sök'];
var LIST_CATS = CATS.filter(function (c) { return c !== 'Hem'; });
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
    key: 'baste-recepten.v2',   // bumpa version om du haft cache-trubbel
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
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]; }); }
function readFilesAsDataURLs(files) {
    return new Promise(function (res) {
        if (!files || !files.length) return res([]);
        var out = [], i = 0;
        (function next() {
            if (i >= files.length) return res(out);
            var fr = new FileReader();
            fr.onload = function () { out.push(fr.result); next(); };
            fr.readAsDataURL(files[i++]);
        })();
    });
}

// Tema init
(function () {
    var body = document.body;
    body.classList.remove('theme-morkgron', 'theme-klassisk', 'theme-pastell');
    body.classList.add(DB.theme || 'theme-morkgron');
    var sel = el('#themeSel');
    if (sel) {
        sel.value = DB.theme || 'theme-morkgron';
        sel.addEventListener('change', function (e) {
            body.classList.remove('theme-morkgron', 'theme-klassisk', 'theme-pastell');
            body.classList.add(e.target.value);
            DB.theme = e.target.value; store.set(DB);
        });
    }
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

// Formkategori-chips
var selectedFormCat = null;
function renderCatChips() {
    var wrap = el('#catChips'); if (!wrap) return;
    wrap.innerHTML = '';
    LIST_CATS.filter(function (c) { return c !== 'favoriter' && c !== 'sök'; })
        .forEach(function (c) {
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

// Kategoribar
(function () {
    var bar = el('#catBar'); if (!bar) return;
    bar.innerHTML = '';
    CATS.forEach(function (c) {
        var btn = document.createElement('button');
        btn.className = 'catbtn' + (c === currentCat ? ' active' : '');
        btn.textContent = (c === 'Hem' ? '🏠 Hem' : c);
        btn.addEventListener('click', function () { routeTo(c); });
        bar.appendChild(btn);
    });
})();

// Drawer (hamburgermeny)
var drawer = el('#drawer');
var openDrawerBtn = el('#openDrawer');
if (openDrawerBtn) {
    openDrawerBtn.addEventListener('click', function () { openDrawer(); });
}
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
    CATS.forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'cat' + (c === currentCat ? ' active' : '');
        d.textContent = (c === 'Hem' ? '🏠 Hem' : c);
        d.addEventListener('click', function () { closeDrawer(); routeTo(c); });
        wrap.appendChild(d);
    });
}

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
            routeTo(currentCat);
        });
    });
}
var clearBtn = el('#clearBtn');
if (clearBtn) {
    clearBtn.addEventListener('click', function () { clearForm(); });
}
function clearForm() {
    var ids = ['#titleInput', '#ingTextarea', '#instTextarea', '#tagInput'];
    ids.forEach(function (id) { var n = el(id); if (n) n.value = ''; });
    var fi = el('#imageInput'); if (fi) fi.value = '';
    formFav = false; if (favToggle) { favToggle.classList.remove('active'); favToggle.textContent = '☆ Lägg som favorit'; }
    selectedFormCat = null; renderCatChips();
}

// Render: cards
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

// Routing
function routeTo(cat) {
    currentCat = cat;
    var vt = el('#viewTitle'); if (vt) vt.textContent = cat;
    all('.catbtn').forEach(function (b) { b.classList.toggle('active', b.textContent.replace('🏠 ', '') === cat); });
    var searchBar = el('#searchBar'); if (searchBar) searchBar.style.display = (cat === 'sök') ? 'flex' : 'none';

    var list = DB.recipes.slice();
    if (cat === 'Hem') {
        list.sort(function (a, b) { return b.createdAt - a.createdAt; }); renderCards(list);
    } else if (cat === 'favoriter') {
        renderCards(list.filter(function (r) { return r.fav; }));
    } else if (cat === 'sök') {
        renderCards(list);
    } else {
        renderAlphaList(list.filter(function (r) { return r.cat === cat; }));
    }
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
if (closeDetailBtn) {
    closeDetailBtn.addEventListener('click', function () { if (detail && detail.close) detail.close(); releaseWakeLock(); });
}
var openImageBtn = el('#openImage');
if (openImageBtn) {
    openImageBtn.addEventListener('click', function () { if (detailMain && detailMain.src) window.open(detailMain.src, '_blank'); });
}
if (detail) {
    detail.addEventListener('close', function () { releaseWakeLock(); });
}
if (detailFav) {
    detailFav.addEventListener('click', function () {
        var r = DB.recipes.find(function (x) { return x.id === openedId; }); if (!r) return;
        r.fav = !r.fav; store.set(DB);
        detailFav.classList.toggle('active', !!r.fav);
        detailFav.textContent = r.fav ? '★ Favorit' : '☆ Favorit';
        if (currentCat === 'favoriter') routeTo('favoriter');
    });
}
var shareBtn = el('#shareBtn');
if (shareBtn) {
    shareBtn.addEventListener('click', function () {
        var r = DB.recipes.find(function (x) { return x.id === openedId; }); if (!r) return;
        var text = r.title + '\nKategori: ' + r.cat
            + (r.tags && r.tags.length ? '\nTaggar: ' + r.tags.join(', ') : '')
            + (r.ings && r.ings.length ? '\n\nIngredienser:\n- ' + r.ings.join('\n- ') : '')
            + (r.inst ? '\n\nInstruktioner:\n' + r.inst : '');
        if (navigator.share) { navigator.share({ title: r.title, text: text }).catch(function () { }); }
        else { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); alert('Receptet kopierades till urklipp.'); } }
    });
}
var printBtn = el('#printBtn');
if (printBtn) {
    printBtn.addEventListener('click', function () { window.print(); });
}

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
        [{ title: 'Keto pepparkakor', cat: 'keto', tags: ['keto', 'jul'] },
        { title: 'Köttbullar', cat: 'kött', tags: ['klassiker'] },
        { title: 'Citronfisk i ugn', cat: 'fisk', tags: ['snabb'] }]
            .forEach(function (d) {
                DB.recipes.push({
                    id: genId(), title: d.title, cat: d.cat, fav: false,
                    images: [DEFAULT_IMG], ings: [], inst: '', tags: d.tags || [], createdAt: Date.now()
                });
            });
        store.set(DB);
        routeTo('Hem');
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')['catch'](function () { });
    }
})();
