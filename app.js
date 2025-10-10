// ---- Konstanter / Kategorier ----
var CATS = ['Hem', 'nytt', 'favoriter', 'sök', 'Jul', 'keto', 'kött', 'kyckling', 'fisk', 'färs', 'dessert', 'bröd', 'vegetariskt', 'godis', 'övrigt'];
var LIST_CATS = CATS.filter(function (c) { return !['Hem', 'nytt', 'favoriter', 'sök'].includes(c); });
var coll = new Intl.Collator('sv', { sensitivity: 'base' });

// Tom-bild (dataURL)
var DEFAULT_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="100%" height="100%" fill="#203228"/><text x="400" y="300" fill="#cfe9dd" font-family="Segoe UI, Arial" text-anchor="middle" font-size="42" dy=".35em">Ingen bild</text></svg>'
);

// ---- ID helpers ----
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

// ---- localStorage (metadata) med migration & kvot-hantering ----
var store = {
    key: 'baste-recepten.v4',
    safeParse: function (raw) { try { return JSON.parse(raw); } catch (e) { return null; } },
    get: function () {
        var curr = this.safeParse(localStorage.getItem(this.key));
        if (!curr || !curr.recipes) curr = { recipes: [], theme: 'theme-morkgron' };

        // migrera från äldre keys
        var merged = false;
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k) continue;
            if (k.startsWith('baste-recepten') && k !== this.key) {
                var oldData = this.safeParse(localStorage.getItem(k));
                if (oldData && Array.isArray(oldData.recipes)) {
                    var have = new Set(curr.recipes.map(function (r) { return r.id; }));
                    var add = oldData.recipes.filter(function (r) { return r && r.id && !have.has(r.id); });
                    if (add.length) { curr.recipes = curr.recipes.concat(add); merged = true; }
                    if (!curr.theme && oldData.theme) { curr.theme = oldData.theme; merged = true; }
                }
            }
        }
        if (merged) {
            try {
                localStorage.setItem(this.key, JSON.stringify(curr));
                for (var j = localStorage.length - 1; j >= 0; j--) {
                    var kk = localStorage.key(j);
                    if (kk && kk.startsWith('baste-recepten') && kk !== this.key) {
                        try { localStorage.removeItem(kk); } catch (e) { }
                    }
                }
            } catch (e) { console.warn('Kunde inte spara sammanslagen data:', e); }
        }
        return curr;
    },
    set: function (d) {
        try {
            localStorage.setItem(this.key, JSON.stringify(d));
        } catch (e) {
            console.error('Misslyckades att spara till localStorage:', e);
            var data = JSON.stringify(d, null, 2);
            var blob = new Blob([data], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            try { alert('Lagringsutrymme fullt. Jag laddar ner en säkerhetskopia åt dig nu.'); } catch (_) { }
            var a = document.createElement('a');
            a.href = url;
            var dts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            a.download = 'baste-recepten-NÖD-EXPORT-' + dts + '.json';
            document.body.appendChild(a);
            a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        }
    }
};

var DB = store.get();            // { recipes: [], theme: '...' }
var currentCat = 'Hem';
var wakeLock = null;

// ==========================
// IndexedDB för bilder
// ==========================
var idb = (function () {
    var DB_NAME = 'baste-recepten-db';
    var DB_VER = 1;
    var IMG_STORE = 'images';

    function open() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(IMG_STORE)) {
                    db.createObjectStore(IMG_STORE, { keyPath: 'id' }); // {id, blob, type, size, w, h, createdAt}
                }
            };
            req.onsuccess = function (e) { resolve(e.target.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    async function withStore(mode, fn) {
        var db = await open();
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(IMG_STORE, mode);
            var st = tx.objectStore(IMG_STORE);
            var res;
            Promise.resolve(fn(st)).then(function (r) { res = r; tx.commit && tx.commit(); })
                .catch(reject);
            tx.oncomplete = function () { resolve(res); };
            tx.onerror = function () { reject(tx.error); };
            tx.onabort = function () { reject(tx.error); };
        });
    }

    function putImage(blob, meta) {
        var id = (meta && meta.id) ? meta.id : genId();
        var rec = Object.assign({ id: id, blob: blob, type: blob.type || 'application/octet-stream', size: blob.size || 0, createdAt: Date.now() }, meta || {});
        return withStore('readwrite', function (st) {
            st.put(rec);
            return rec;
        });
    }

    function getImage(id) {
        return withStore('readonly', function (st) {
            return new Promise(function (resolve, reject) {
                var r = st.get(id);
                r.onsuccess = function () { resolve(r.result || null); };
                r.onerror = function () { reject(r.error); };
            });
        });
    }

    function deleteImage(id) {
        return withStore('readwrite', function (st) { st.delete(id); });
    }

    function getAllMeta() {
        return withStore('readonly', function (st) {
            return new Promise(function (resolve, reject) {
                var out = [];
                var req = st.openCursor();
                req.onsuccess = function (e) {
                    var cur = e.target.result;
                    if (cur) {
                        var v = cur.value;
                        out.push({ id: v.id, size: v.size || 0, type: v.type, w: v.w, h: v.h, createdAt: v.createdAt });
                        cur.continue();
                    } else resolve(out);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    // Hämta ALLA poster inkl. blobbar (för full backup)
    function getAllRecords() {
        return withStore('readonly', function (st) {
            return new Promise(function (resolve, reject) {
                var out = [];
                var req = st.openCursor();
                req.onsuccess = function (e) {
                    var cur = e.target.result;
                    if (cur) { out.push(cur.value); cur.continue(); }
                    else resolve(out);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    // Töm hela bildlagret (för återställning)
    function clearAll() { return withStore('readwrite', function (st) { st.clear(); }); }

    return { putImage, getImage, deleteImage, getAllMeta, getAllRecords, clearAll };
})();

// ---- Hjälpare ----
function el(s) { return document.querySelector(s); }
function all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
function parseTags(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { return x.toLowerCase(); }); }
function lines(t) { return String(t || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean); }
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

// dataURL <-> Blob
function dataURLtoBlob(dataUrl) {
    try {
        var parts = dataUrl.split(',');
        var mime = (parts[0].match(/:(.*?);/) || [, 'application/octet-stream'])[1];
        var bstr = atob(parts[1]);
        var n = bstr.length;
        var u8 = new Uint8Array(n);
        while (n--) u8[n] = bstr.charCodeAt(n);
        return new Blob([u8], { type: mime });
    } catch (e) { return null; }
}
// Blob -> dataURL (för export)
function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
        try {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(fr.error); };
            fr.readAsDataURL(blob);
        } catch (e) { resolve(null); }
    });
}

// Oppna/nedladdning
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

// ---- Bildkomprimering vid import/uppladdning ----
function resizeBlobToJpeg(blob, maxSide, quality) {
    return new Promise(function (resolve) {
        try {
            var img = new Image();
            img.onload = function () {
                var w = img.naturalWidth, h = img.naturalHeight;
                var scale = Math.min(1, maxSide / Math.max(w, h));
                var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
                var canvas = document.createElement('canvas');
                canvas.width = tw; canvas.height = th;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, tw, th);
                canvas.toBlob(function (out) {
                    if (out) resolve({ blob: out, w: tw, h: th });
                    else resolve(null);
                }, 'image/jpeg', quality);
            };
            var fr = new FileReader();
            fr.onload = function () { img.src = fr.result; };
            fr.readAsDataURL(blob);
        } catch (e) { resolve(null); }
    });
}
function readFilesAsCompressedBlobs(files) {
    var MAX_SIDE = 1600, QUALITY = 0.85;
    return new Promise(function (res) {
        if (!files || !files.length) return res([]);
        var out = [], i = 0;
        (function next() {
            if (i >= files.length) return res(out);
            var f = files[i++];
            resizeBlobToJpeg(f, MAX_SIDE, QUALITY).then(function (r) {
                if (r && r.blob) out.push(r);
                else out.push({ blob: f, w: undefined, h: undefined });
                next();
            }).catch(function () { out.push({ blob: f }); next(); });
        })();
    });
}

// ---- Visa/dölj ----
function show(sel, visible) {
    var n = el(sel);
    if (!n) return;
    n.style.display = visible ? '' : 'none';
}

// ---- Tema init ----
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

// ==========================
// LAGRINGSMÄTARE
// ==========================
async function computeUsage() {
    var metaStr = localStorage.getItem(store.key) || '';
    var metaBytes = new Blob([metaStr]).size;
    var metas = await idb.getAllMeta();
    var imgBytes = metas.reduce(function (s, m) { return s + (m.size || 0); }, 0);
    return { metaBytes: metaBytes, imgBytes: imgBytes, totalBytes: metaBytes + imgBytes };
}
function formatMB(b) { return (b / 1024 / 1024).toFixed(2) + ' MB'; }
async function renderUsage() {
    var meter = el('#usageLine');
    if (!meter) {
        var tools = el('#toolsWrap');
        if (tools) {
            meter = document.createElement('p');
            meter.id = 'usageLine';
            meter.className = 'hint';
            tools.appendChild(meter);
        }
    }
    if (!meter) return;
    var u = await computeUsage();
    meter.textContent = 'Lagring: ' + formatMB(u.totalBytes) + ' (bilder: ' + formatMB(u.imgBytes) + ', data: ' + formatMB(u.metaBytes) + ')';
}
// Export / Import (metadata)
// ==========================
var exportBtn = el('#exportBtn');
if (exportBtn) {
    exportBtn.addEventListener('click', async function () {
        var metaOnly = { recipes: DB.recipes, theme: DB.theme, note: 'Bilder sparas i IndexedDB och ingår inte i denna export.' };
        var data = JSON.stringify(metaOnly, null, 2);
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
                if (!incoming || Object.prototype.toString.call(incoming.recipes) !== '[object Array]') throw new Error('Ogiltigt JSON (hittade inga recipes)');
                var have = new Set(DB.recipes.map(function (r) { return r.id; }));
                var add = (incoming.recipes || []).filter(function (r) { return r && r.id && !have.has(r.id); });
                DB.recipes = DB.recipes.concat(add);
                if (incoming.theme) DB.theme = incoming.theme;
                store.set(DB);
                alert('Importerade ' + add.length + ' recept.\nObs: Bilder låg i IndexedDB hos källan och följer inte med denna import.');
                routeTo(currentCat);
                renderUsage();
            } catch (err) {
                alert('Kunde inte importera: ' + err.message);
            }
            importFile.value = '';
        };
        reader.readAsText(f);
    });
}

// ==========================
// Full backup (inkl. bilder i IndexedDB) – EXPORT
// ==========================
(function ensureFullBackupBtn() {
    var tools = el('#toolsWrap');
    if (!tools) return;

    if (!el('#fullBackupBtn')) {
        var btn = document.createElement('button');
        btn.id = 'fullBackupBtn';
        btn.className = 'btn small';
        btn.textContent = 'Full backup (inkl. bilder)';
        btn.title = 'Exportera ALLT som en JSON (metadata + bilder)';
        var hint = tools.querySelector('p.hint');
        tools.insertBefore(btn, hint || null);
    }

    var fullBtn = el('#fullBackupBtn');
    if (fullBtn && !fullBtn._bound) {
        fullBtn.addEventListener('click', async function () {
            try {
                fullBtn.disabled = true;
                fullBtn.textContent = 'Skapar backup...';

                var meta = { recipes: DB.recipes, theme: DB.theme };
                var records = await idb.getAllRecords();
                var images = [];
                for (var i = 0; i < records.length; i++) {
                    var r = records[i];
                    var dataURL = await blobToDataURL(r.blob);
                    images.push({
                        id: r.id,
                        type: r.type || 'image/jpeg',
                        size: r.size || (r.blob && r.blob.size) || 0,
                        w: r.w, h: r.h,
                        createdAt: r.createdAt || Date.now(),
                        dataURL: dataURL
                    });
                    fullBtn.textContent = 'Skapar backup... (' + (i + 1) + '/' + records.length + ')';
                }

                var payload = {
                    version: 1,
                    createdAt: Date.now(),
                    note: 'Full backup av Bästa recepten (metadata + bilder)',
                    meta: meta,
                    images: images
                };

                var json = JSON.stringify(payload);
                var blob = new Blob([json], { type: 'application/json' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                a.download = 'baste-recepten-full-backup-' + stamp + '.json';
                a.click();
                URL.revokeObjectURL(a.href);

                fullBtn.textContent = 'Full backup (inkl. bilder)';
                fullBtn.disabled = false;
            } catch (e) {
                console.error(e);
                alert('Kunde inte skapa full backup: ' + e.message);
                fullBtn.textContent = 'Full backup (inkl. bilder)';
                fullBtn.disabled = false;
            }
        });
        fullBtn._bound = true;
    }
})();

// ==========================
// Återställ full backup (ersätter allt)
// ==========================
(function ensureRestoreFullBtn() {
    var tools = el('#toolsWrap');
    if (!tools) return;

    if (!el('#restoreFullBtn')) {
        var btn = document.createElement('button');
        btn.id = 'restoreFullBtn';
        btn.className = 'btn small secondary';
        btn.textContent = 'Återställ full backup';
        btn.title = 'Läs in JSON-backup som innehåller metadata + bilder (ersätter allt)';
        var hint = tools.querySelector('p.hint');
        tools.insertBefore(btn, hint || null);
    }
    if (!el('#restoreFullFile')) {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.id = 'restoreFullFile';
        inp.accept = 'application/json';
        inp.style.display = 'none';
        tools.appendChild(inp);
    }

    var btn = el('#restoreFullBtn');
    var file = el('#restoreFullFile');

    if (btn && file && !btn._bound) {
        btn.addEventListener('click', function () { file.click(); });
        file.addEventListener('change', async function () {
            var f = file.files && file.files[0];
            if (!f) return;
            try {
                var ok = confirm('Detta ersätter ALLA recept och bilder med innehållet i backup-filen. Fortsätt?');
                if (!ok) { file.value = ''; return; }

                btn.disabled = true; btn.textContent = 'Återställer...';

                var text = await f.text();
                var payload = JSON.parse(text);
                if (!payload || payload.version !== 1 || !payload.meta || !Array.isArray(payload.meta.recipes) || !Array.isArray(payload.images)) {
                    throw new Error('Ogiltig backupfil');
                }

                // 1) Töm IDB
                await idb.clearAll();

                // 2) Lägg in alla bilder igen (behåll samma id)
                for (var i = 0; i < payload.images.length; i++) {
                    var im = payload.images[i];
                    if (!im || !im.id || !im.dataURL) continue;
                    var blob = dataURLtoBlob(im.dataURL);
                    if (!blob) continue;
                    await idb.putImage(blob, { id: im.id, w: im.w, h: im.h });
                    btn.textContent = 'Återställer... (' + (i + 1) + '/' + payload.images.length + ')';
                }

                // 3) Skriv metadata
                DB.recipes = payload.meta.recipes || [];
                DB.theme = payload.meta.theme || DB.theme;
                store.set(DB);

                // 4) UI
                routeTo('Hem');
                renderUsage();
                alert('Återställning klar!');
            } catch (e) {
                console.error(e);
                alert('Kunde inte återställa: ' + e.message);
            } finally {
                btn.disabled = false; btn.textContent = 'Återställ full backup';
                file.value = '';
            }
        });
        btn._bound = true;
    }
})();

// ==========================
// OPTIMERA LAGRING (IDB-bilder)
// ==========================
function humanBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
}
async function optimizeAllImages() {
    var btn = el('#optimizeBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Optimerar...'; }
    var MAX = 1280, Q = 0.82;
    var totalBefore = 0, totalAfter = 0, changed = 0, scanned = 0;

    for (var i = 0; i < DB.recipes.length; i++) {
        var r = DB.recipes[i];
        if (!r.images || !r.images.length) continue;
        for (var j = 0; j < r.images.length; j++) {
            var ref = r.images[j];
            if (typeof ref === 'string' && ref.startsWith('data:')) {
                var blob0 = dataURLtoBlob(ref);
                if (!blob0) continue;
                scanned++;
                totalBefore += blob0.size;
                var resized = await resizeBlobToJpeg(blob0, MAX, Q);
                var candidate = resized && resized.blob ? resized.blob : blob0;
                var meta = resized ? { w: resized.w, h: resized.h } : {};
                var rec = await idb.putImage(candidate, meta);
                r.images[j] = { type: 'idb', id: rec.id };
                store.set(DB);
                totalAfter += candidate.size;
                if (candidate.size < blob0.size) changed++;
            } else if (ref && ref.type === 'idb' && ref.id) {
                var imgRec = await idb.getImage(ref.id);
                if (!imgRec || !imgRec.blob) continue;
                scanned++;
                var before = imgRec.blob.size || 0;
                totalBefore += before;
                var resized2 = await resizeBlobToJpeg(imgRec.blob, MAX, Q);
                if (resized2 && resized2.blob && resized2.blob.size < before) {
                    await idb.putImage(resized2.blob, { id: ref.id, w: resized2.w, h: resized2.h });
                    totalAfter += resized2.blob.size;
                    changed++;
                } else {
                    totalAfter += before;
                }
            }
            if (btn) btn.textContent = 'Optimerar... (' + (i + 1) + '/' + DB.recipes.length + ')';
        }
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Optimera lagring'; }
    alert(
        'Genomgång klar!\n\n' +
        'Skannade bilder: ' + scanned + '\n' +
        'Optimerade: ' + changed + '\n' +
        'Före: ' + humanBytes(totalBefore) + '\n' +
        'Efter: ' + humanBytes(totalAfter) + '\n' +
        'Sparat: ' + humanBytes(Math.max(0, totalBefore - totalAfter))
    );
    renderUsage();
}
(function ensureOptimizeBtn() {
    if (!el('#optimizeBtn')) {
        var tools = el('#toolsWrap');
        if (tools) {
            var btn = document.createElement('button');
            btn.id = 'optimizeBtn';
            btn.className = 'btn small secondary';
            btn.textContent = 'Optimera lagring';
            btn.title = 'Minska storlek på sparade bilder';
            tools.insertBefore(btn, tools.querySelector('p.hint') || null);
        }
    }
    var optBtn = el('#optimizeBtn');
    if (optBtn && !optBtn._bound) {
        optBtn.addEventListener('click', function () {
            if (!DB.recipes.length) { alert('Inga recept att optimera ännu.'); return; }
            var ok = confirm('Optimera alla sparade bilder?\nBilder skalas till max 1280 px och komprimeras.');
            if (!ok) return;
            optimizeAllImages();
        });
        optBtn._bound = true;
    }
})();

// ==========================
// Formkategori-chips
// ==========================
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

// ==========================
// Drawer / meny
// ==========================
var drawer = el('#drawer');
var openDrawerBtn = el('#openDrawer');
if (openDrawerBtn) openDrawerBtn.addEventListener('click', function () { openDrawer(); });
if (drawer) {
    drawer.addEventListener('click', function (e) { if (e.target && e.target.hasAttribute('data-close')) closeDrawer(); });
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

// ==========================
// Headerknappar
// ==========================
var goAddBtn = el('#goAddBtn');
var homeAddBtn = el('#homeAddBtn');
if (goAddBtn) goAddBtn.addEventListener('click', function () { routeTo('nytt'); });
if (homeAddBtn) homeAddBtn.addEventListener('click', function () { routeTo('nytt'); });
var goHomeBtn = el('#goHomeBtn');
if (goHomeBtn) goHomeBtn.addEventListener('click', function () { routeTo('Hem'); });

// ==========================
// Form: spara/rensa/favorit
// ==========================
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
    saveBtn.addEventListener('click', async function () {
        var titleEl = el('#titleInput');
        var title = titleEl ? titleEl.value.trim() : '';
        if (!title) { alert('Skriv en rubrik.'); return; }
        if (!selectedFormCat) { alert('Välj en kategori.'); return; }

        var images = [];
        var filesEl = el('#imageInput');
        var files = filesEl ? filesEl.files : null;

        if (files && files.length) {
            var processed = await readFilesAsCompressedBlobs(files);
            for (var i = 0; i < processed.length; i++) {
                var r = processed[i];
                var rec = await idb.putImage(r.blob, { w: r.w, h: r.h });
                images.push({ type: 'idb', id: rec.id });
            }
        } else {
            images.push(DEFAULT_IMG); // placeholder
        }

        var recMeta = {
            id: genId(),
            title: title,
            cat: selectedFormCat,
            fav: formFav,
            images: images,
            ings: lines(el('#ingTextarea') ? el('#ingTextarea').value : ''),
            inst: el('#instTextarea') ? el('#instTextarea').value.trim() : '',
            tags: parseTags(el('#tagInput') ? el('#tagInput').value : ''),
            createdAt: Date.now()
        };
        DB.recipes.push(recMeta);
        store.set(DB);
        clearForm();

        routeTo('Hem');
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { }
        renderUsage();
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

// ==========================
// Bildvisning helpers
// ==========================
async function resolveImageSrc(ref) {
    if (!ref) return DEFAULT_IMG;
    if (typeof ref === 'string') return ref;
    if (ref.type === 'idb' && ref.id) {
        var rec = await idb.getImage(ref.id);
        if (rec && rec.blob) {
            return URL.createObjectURL(rec.blob);
        }
    }
    return DEFAULT_IMG;
}
function setImageAsync(imgEl, ref) {
    if (!imgEl) return;
    imgEl.src = (typeof ref === 'string' && ref.startsWith('data:')) ? ref : DEFAULT_IMG;
    resolveImageSrc(ref).then(function (url) {
        try { imgEl.src = url; } catch (_) { }
    });
}

// ==========================
// Render: kort
// ==========================
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
        var img = document.createElement('img'); img.className = 'thumb'; img.alt = r.title; img.loading = 'lazy';
        c.appendChild(img);
        setImageAsync(img, (r.images && r.images[0]) || DEFAULT_IMG);

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

// ==========================
// Render: A–Ö
// ==========================
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

// ==========================
// Senaste 5 på startsidan
// ==========================
function renderRecent() {
    var wrap = el('#recentCards'); if (!wrap) return;
    wrap.innerHTML = '';
    var list = DB.recipes.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 5);
    list.forEach(function (r) {
        var c = document.createElement('article'); c.className = 'card';
        var img = document.createElement('img'); img.className = 'thumb'; img.alt = r.title; img.loading = 'lazy';
        c.appendChild(img);
        setImageAsync(img, (r.images && r.images[0]) || DEFAULT_IMG);

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

// ==========================
// Routing
// ==========================
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
        // bara formulär
    } else {
        renderAlphaList(list.filter(function (r) { return r.cat === cat; }));
    }

    show('#toolsWrap', true);
    closeDrawer();
}

// ==========================
// Sök
// ==========================
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
// ==========================
// Detaljvy
// ==========================
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

async function openDetail(id) {
    var r = DB.recipes.find(function (x) { return x.id === id; }); if (!r) return;
    openedId = id;

    if (detailTitle) detailTitle.textContent = r.title;
    if (detailCat) detailCat.textContent = r.cat;

    if (detailFav) {
        detailFav.classList.toggle('active', !!r.fav);
        detailFav.textContent = r.fav ? '★ Favorit' : '☆ Favorit';
    }

    var imgs = (r.images && r.images.length ? r.images : [DEFAULT_IMG]);
    if (detailMain) setImageAsync(detailMain, imgs[0]);

    if (detailThumbs) {
        detailThumbs.innerHTML = '';
        imgs.forEach(function (ref, i) {
            var t = document.createElement('img'); t.alt = r.title + ' bild ' + (i + 1);
            detailThumbs.appendChild(t);
            setImageAsync(t, ref);
            t.addEventListener('click', function () { if (detailMain) setImageAsync(detailMain, ref); });
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

// Öppna bild
var openImageBtn = el('#openImage');
if (openImageBtn) {
    openImageBtn.addEventListener('click', async function () {
        var r = DB.recipes.find(function (x) { return x.id === openedId; }); if (!r) return;
        var ref = (r.images && r.images.length) ? r.images[0] : null;
        if (!ref) return;
        if (typeof ref === 'string' && ref.startsWith('data:')) {
            var b = dataURLtoBlob(ref); if (b) openOrDownloadBlob(b, (r.title || 'bild') + '.png');
            else window.open(ref, '_blank', 'noopener');
            return;
        }
        if (ref.type === 'idb') {
            var rec = await idb.getImage(ref.id);
            if (rec && rec.blob) openOrDownloadBlob(rec.blob, (r.title || 'bild') + (rec.type === 'image/png' ? '.png' : '.jpg'));
        }
    });
}
if (detail) detail.addEventListener('close', function () { releaseWakeLock(); });

// Favorit-toggling
if (detailFav) {
    detailFav.addEventListener('click', function () {
        var r = DB.recipes.find(function (x) { return x.id === openedId; }); if (!r) return;
        r.fav = !r.fav; store.set(DB);
        detailFav.classList.toggle('active', !!r.fav);
        detailFav.textContent = r.fav ? '★ Favorit' : '☆ Favorit';
        if (currentCat === 'favoriter') routeTo('favoriter');
    });
}

// ==========================
// Dela (text + ev. bild från IDB)
// ==========================
function getRecipeFromDetailView() {
    var title = (el('#detailTitle') && el('#detailTitle').textContent) || '';
    var cat = (el('#detailCat') && el('#detailCat').textContent) || '';
    var tags = [];
    var tagsWrap = el('#detailTagsWrap');
    if (tagsWrap) {
        tags = Array.prototype.map.call(tagsWrap.querySelectorAll('.tag'), function (t) {
            return (t.textContent || '').replace(/^#/, '').trim();
        }).filter(Boolean);
    }
    var ings = [];
    var ingsUl = el('#detailIngs');
    if (ingsUl) {
        ings = Array.prototype.map.call(ingsUl.querySelectorAll('li'), function (li) {
            return (li.textContent || '').trim();
        }).filter(Boolean);
    }
    var inst = (el('#detailInst') && el('#detailInst').textContent) || '';
    return { title: title, cat: cat, tags: tags, ings: ings, inst: inst };
}
function mergeRecipeWithDOM(r) {
    var dom = getRecipeFromDetailView();
    return {
        title: r.title || dom.title,
        cat: r.cat || dom.cat,
        tags: (r.tags && r.tags.length) ? r.tags : dom.tags,
        ings: (r.ings && r.ings.length) ? r.ings : dom.ings,
        inst: (r.inst && r.inst.trim()) ? r.inst : dom.inst
    };
}
var shareBtn = el('#shareBtn');
if (shareBtn) {
    shareBtn.addEventListener('click', async function () {
        var r = DB.recipes.find(function (x) { return x.id === openedId; });
        if (!r) return;
        var text = r.title + '\nKategori: ' + r.cat
            + (r.tags && r.tags.length ? '\nTaggar: ' + r.tags.join(', ') : '')
            + (r.ings && r.ings.length ? '\n\nIngredienser:\n- ' + r.ings.join('\n- ') : '')
            + (r.inst ? '\n\nInstruktioner:\n' + r.inst : '');

        var first = (r.images && r.images[0]) || null;
        try {
            if (first && navigator.canShare) {
                if (typeof first === 'string' && first.startsWith('data:')) {
                    var blob = dataURLtoBlob(first);
                    if (blob) {
                        var file = new File([blob], (r.title || 'recept') + '.jpg', { type: blob.type || 'image/jpeg' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ title: r.title, text: text, files: [file] });
                            return;
                        }
                    }
                } else if (first.type === 'idb') {
                    var rec = await idb.getImage(first.id);
                    if (rec && rec.blob) {
                        var file = new File([rec.blob], (r.title || 'recept') + (rec.type === 'image/png' ? '.png' : '.jpg'), { type: rec.type || 'image/jpeg' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ title: r.title, text: text, files: [file] });
                            return;
                        }
                    }
                }
            }
        } catch (e) { }

        if (navigator.share) { navigator.share({ title: r.title, text: text }).catch(function () { }); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                alert('Receptet kopierades till urklipp (text).');
            }).catch(function () {
                var blob2 = new Blob([text], { type: 'text/plain' });
                openOrDownloadBlob(blob2, (r.title || 'recept') + '.txt');
            });
        } else {
            var blob3 = new Blob([text], { type: 'text/plain' });
            openOrDownloadBlob(blob3, (r.title || 'recept') + '.txt');
        }
    });
}

// ---- Dela som bild (renderad) ----
function wrapText(ctx, text, maxWidth, lineHeight, font) {
    if (font) ctx.font = font;
    var words = String(text || '').split(/\s+/);
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
        var w = words[i], test = line ? (line + ' ' + w) : w;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            if (ctx.measureText(w).width > maxWidth) {
                var part = '';
                for (var j = 0; j < w.length; j++) {
                    var t = part + w[j];
                    if (ctx.measureText(t).width > maxWidth) { lines.push(part); part = w[j]; }
                    else { part = t; }
                }
                line = part;
            } else line = w;
        } else line = test;
    }
    if (line) lines.push(line);
    return lines;
}
function renderRecipeToCanvas(r) {
    var cs = getComputedStyle(document.body);
    var bg = cs.getPropertyValue('--card').trim() || '#ffffff';
    var fg = cs.getPropertyValue('--text').trim() || '#111111';
    var muted = cs.getPropertyValue('--muted').trim() || '#666666';
    var accent = cs.getPropertyValue('--accent').trim() || '#2c6e49';

    var DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var W = 1080, PAD = 48, contentW = W - PAD * 2;
    var titleFont = '700 48px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    var h3Font = '600 30px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    var bodyFont = '400 28px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    var smallFont = '400 22px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    var lh = 38, lhSmall = 30;

    var c1 = document.createElement('canvas'); var ctx = c1.getContext('2d');
    ctx.font = titleFont;
    var titleLines = wrapText(ctx, r.title || '(Utan titel)', contentW, lh, titleFont);
    var y = PAD + titleLines.length * lh + 8;
    ctx.font = smallFont; var catLine = 'Kategori: ' + (r.cat || '–'); y += lhSmall + 8;
    var tagsText = (r.tags && r.tags.length) ? ('Taggar: ' + r.tags.join(', ')) : '';
    var tagLines = tagsText ? wrapText(ctx, tagsText, contentW, lhSmall, smallFont) : [];
    y += tagLines.length ? (tagLines.length * lhSmall + 8) : 0;

    ctx.font = h3Font; y += lh; var ingsTitleH = lh;
    ctx.font = bodyFont; var ingLines = [];
    (r.ings || []).forEach(function (i) { ingLines = ingLines.concat(wrapText(ctx, '• ' + i, contentW, lh, bodyFont)); });
    var ingHeight = (r.ings && r.ings.length ? (ingsTitleH + ingLines.length * lh + 8) : 0); y += ingHeight;

    ctx.font = h3Font; var hasInst = !!(r.inst && r.inst.trim()); var instTitleH = hasInst ? (lh + 8) : 0; y += instTitleH;
    ctx.font = bodyFont; var instLines = hasInst ? wrapText(ctx, r.inst, contentW, lh, bodyFont) : []; var instHeight = instLines.length * lh; y += instHeight;

    y += PAD;
    var H = y;

    var canvas = document.createElement('canvas');
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    var c = canvas.getContext('2d'); c.scale(DPR, DPR);

    c.fillStyle = bg; c.fillRect(0, 0, W, H);

    var cursorY = PAD;
    c.fillStyle = fg; c.font = titleFont;
    titleLines.forEach(function (line) { c.fillText(line, PAD, cursorY); cursorY += lh; });

    c.font = smallFont; c.fillStyle = muted; c.fillText(catLine, PAD, cursorY); cursorY += lhSmall + 8;
    c.fillStyle = muted; tagLines.forEach(function (line) { c.fillText(line, PAD, cursorY); cursorY += lhSmall; });

    if (r.ings && r.ings.length) {
        cursorY += 8; c.font = h3Font; c.fillStyle = accent; c.fillText('Ingredienser', PAD, cursorY); cursorY += lh;
        c.font = bodyFont; c.fillStyle = fg; ingLines.forEach(function (line) { c.fillText(line, PAD, cursorY); cursorY += lh; });
    }
    if (hasInst) {
        cursorY += 8; c.font = h3Font; c.fillStyle = accent; c.fillText('Instruktioner', PAD, cursorY); cursorY += lh;
        c.font = bodyFont; c.fillStyle = fg; instLines.forEach(function (line) { c.fillText(line, PAD, cursorY); cursorY += lh; });
    }
    return canvas;
}
function shareRecipeImage(r) {
    var canvas = renderRecipeToCanvas(r);
    return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob || null); }, 'image/png', 0.95);
    });
}
(function ensureShareImageBtn() {
    if (!el('#shareImgBtn')) {
        var bars = all('.closebar .top-actions');
        if (bars && bars[0]) {
            var btn = document.createElement('button');
            btn.id = 'shareImgBtn'; btn.className = 'btn secondary'; btn.textContent = 'Dela som bild';
            bars[0].appendChild(btn);
        }
    }
    var shareImgBtn = el('#shareImgBtn');
    if (shareImgBtn && !shareImgBtn._bound) {
        shareImgBtn.addEventListener('click', async function () {
            var r0 = DB.recipes.find(function (x) { return x.id === openedId; });
            if (!r0) return;
            var r = mergeRecipeWithDOM(r0);
            var blob = await shareRecipeImage(r);
            if (!blob) return;
            var file = new File([blob], (r.title || 'recept') + '.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ title: r.title, files: [file] }).catch(function () { });
            } else {
                openOrDownloadBlob(blob, (r.title || 'recept') + '.png');
            }
        });
        shareImgBtn._bound = true;
    }
})();

// Print
var printBtn = el('#printBtn');
if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

// Ta bort recept
if (deleteBtn) {
    deleteBtn.addEventListener('click', async function () {
        if (!openedId) return;
        var idx = DB.recipes.findIndex(function (x) { return x.id === openedId; });
        if (idx === -1) return;
        if (!confirm('Ta bort detta recept? Det går inte att ångra.')) return;

        var rec = DB.recipes[idx];
        if (rec && Array.isArray(rec.images)) {
            for (var i = 0; i < rec.images.length; i++) {
                var ref = rec.images[i];
                if (ref && ref.type === 'idb' && ref.id) {
                    try { await idb.deleteImage(ref.id); } catch (e) { }
                }
            }
        }

        DB.recipes.splice(idx, 1);
        store.set(DB);
        openedId = null;
        if (detail && detail.close) detail.close();
        routeTo(currentCat);
        renderUsage();
    });
}

// Wake Lock
function requestWakeLock() { try { if ('wakeLock' in navigator) { navigator.wakeLock.request('screen').then(function (lock) { wakeLock = lock; }); } } catch (e) { } }
function releaseWakeLock() { try { if (wakeLock && wakeLock.release) { wakeLock.release(); } } catch (e) { } finally { wakeLock = null; } }

// ==========================
// Bootstrap
// ==========================
(async function () {
    renderCatList();
    routeTo('Hem');

    // Första-run seed
    if (DB.recipes.length === 0) {
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
        ketoKopia.id = genId(); ketoKopia.cat = 'keto'; ketoKopia.fav = false;

        DB.recipes.push(pepparkaksRecept);
        DB.recipes.push(ketoKopia);
        store.set(DB);
        routeTo('Hem');
    }

    await renderUsage();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(function () { });
    }
})();