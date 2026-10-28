(function () {
"use strict";
var $ = function (i) { return document.getElementById(i); };
var S = { user: "", days: {}, notes: [], photos: [], pending: {}, num: "", obs: [], pendingO: {}, settings: {} };
var up = [], urls = {}, staged = [], viewing = null, mode = "login", busy = false, again = false;
var dateEl = $("date");

function pad(n) { return String(n).padStart(2, "0"); }
function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
dateEl.value = today();
function fmt(iso) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
function monthName(pre) { var p = pre.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function toast(m) { var t = $("toast"); t.textContent = m; t.classList.add("on"); setTimeout(function () { t.classList.remove("on"); }, 2200); }
function setSync(t) { $("sync").textContent = t; }
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
}
function mins(t) { if (!t) return null; var p = t.split(":"); return +p[0] * 60 + +p[1]; }
function isFri(d) { var p = d.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).getDay() === 5; }
function worked(d) { var j = S.days[d]; return !!((j && j.out) || dayNotes(d).length); }
function fridayMins(d) { var j = S.days[d]; if (!j || !j.out) return 0; var m = mins(j.out) - mins(j.arr || "08:00"); return m > 0 ? m : 0; }
function otOf(d) { if (isFri(d)) return 0; var j = S.days[d]; if (!j || !j.out) return 0; var o = mins(j.out); return o > 960 ? o - 960 : 0; }
function hm(m) { return Math.floor(m / 60) + " h " + pad(m % 60); }
function dayNotes(d) { return S.notes.filter(function (n) { return n.date === d; }).sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; }); }
function findPhoto(id) { return S.photos.concat(up).filter(function (p) { return p.id === id; })[0]; }
function allPhotos(d) { return S.photos.filter(function (p) { return p.date === d; }).concat(up.filter(function (u) { return u.date === d; })); }

/* ---------- stockage local ---------- */
function persist() { try { localStorage.setItem("carnet:s:" + S.user, JSON.stringify({ days: S.days, notes: S.notes, photos: S.photos, pending: S.pending, num: S.num, obs: S.obs, pendingO: S.pendingO, settings: S.settings })); } catch (e) {} }
function restore(u) {
  S.user = u; S.days = {}; S.notes = []; S.photos = []; S.pending = {}; S.num = ""; S.obs = []; S.pendingO = {}; S.settings = {};
  try { var x = JSON.parse(localStorage.getItem("carnet:s:" + u) || "null"); if (x) { S.days = x.days || {}; S.notes = x.notes || []; S.photos = x.photos || []; S.pending = x.pending || {}; S.num = x.num || ""; S.obs = x.obs || []; S.pendingO = x.pendingO || {}; S.settings = x.settings || {}; } } catch (e) {}
}
var dbp = null;
function idb() {
  if (!dbp) dbp = new Promise(function (ok, ko) {
    var r = indexedDB.open("carnet", 1);
    r.onupgradeneeded = function () { r.result.createObjectStore("up", { keyPath: "id" }); };
    r.onsuccess = function () { ok(r.result); }; r.onerror = function () { ko(r.error); };
  });
  return dbp;
}
function idbDo(mode, fn) {
  return idb().then(function (db) {
    return new Promise(function (ok, ko) {
      var t = db.transaction("up", mode), q = fn(t.objectStore("up"));
      t.oncomplete = function () { ok(q && q.result); }; t.onerror = function () { ko(t.error); };
    });
  });
}
function idbPut(o) { return idbDo("readwrite", function (s) { return s.put(o); }); }
function idbDel(id) { return idbDo("readwrite", function (s) { return s.delete(id); }).catch(function () {}); }
function loadUp() {
  return idbDo("readonly", function (s) { return s.getAll(); }).then(function (a) { up = (a || []).filter(function (u) { return u.user === S.user; }); }).catch(function () { up = []; });
}

/* ---------- réseau ---------- */
function api(method, url, body, raw) {
  var o = { method: method, credentials: "same-origin", headers: {} };
  if (raw) { o.body = raw; o.headers["Content-Type"] = "image/jpeg"; }
  else if (body) { o.body = JSON.stringify(body); o.headers["Content-Type"] = "application/json"; }
  return fetch(url, o).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.status === 401 && url !== "/api/login") $("auth").hidden = false;
      if (!r.ok) throw { code: r.status, msg: j.error };
      return j;
    });
  });
}
function applyRemote(r) {
  if (S.user !== r.username) restore(r.username);
  try { localStorage.setItem("carnet:user", r.username); } catch (e) {}
  var days = {}, notes = [];
  r.days.forEach(function (x) { days[x.date] = { arr: x.arr, out: x.out, sent: x.sent || "", journal: x.journal || {} }; });
  notes = r.notes.slice();
  Object.keys(S.pending).forEach(function (d) {
    if (S.days[d]) days[d] = S.days[d]; else delete days[d];
    notes = notes.filter(function (n) { return n.date !== d; });
    S.notes.forEach(function (n) { if (n.date === d) notes.push(n); });
  });
  S.days = days; S.notes = notes; S.photos = r.photos; if (r.num) S.num = r.num;
  S.settings = r.settings || {};
  var obs = (r.obs || []).filter(function (o) { return !S.pendingO[o.id]; });
  S.obs.forEach(function (o) { if (S.pendingO[o.id]) obs.push(o); }); S.obs = obs;
  persist(); $("num").value = S.num;
}
function uploadAll() {
  return up.slice().reduce(function (p, u) {
    return p.then(function () {
      return api("PUT", "/api/photo/" + u.id + "?date=" + u.date + (u.note ? "&note=" + encodeURIComponent(u.note) : ""), null, u.blob).then(function () {
        S.photos.push({ id: u.id, date: u.date, note: u.note || null }); persist();
        up = up.filter(function (x) { return x.id !== u.id; }); return idbDel(u.id);
      }).catch(function (e) {
        if (e && (e.code === 400 || e.code === 413 || e.code === 415)) { toast(e.msg || "Photo refusée"); up = up.filter(function (x) { return x.id !== u.id; }); return idbDel(u.id); }
        throw e;
      });
    });
  }, Promise.resolve());
}
function flushObs() {
  return Object.keys(S.pendingO).reduce(function (p, id) {
    return p.then(function () {
      var v = S.pendingO[id], o = S.obs.filter(function (x) { return x.id === id; })[0];
      function done() { if (S.pendingO[id] === v) delete S.pendingO[id]; persist(); }
      if (!o) { delete S.pendingO[id]; return; }
      if (o.deleted) return api("DELETE", "/api/obs/" + id).then(function () { S.obs = S.obs.filter(function (x) { return x.id !== id; }); done(); });
      return api("PUT", "/api/obs/" + id, { day: o.day, bloc: o.bloc, niveau: o.niveau, zone: o.zone, text: o.text, company: o.company, priority: o.priority, due: o.due, status: o.status, closed: o.closed }).then(done);
    });
  }, Promise.resolve());
}
function flush() {
  if (busy) return Promise.resolve();
  busy = true;
  return Object.keys(S.pending).reduce(function (p, d) {
    return p.then(function () {
      var v = S.pending[d], j = S.days[d] || {};
      return api("PUT", "/api/day/" + d, { arr: j.arr || "08:00", out: j.out || "", sent: j.sent || "", journal: j.journal || {}, notes: dayNotes(d) }).then(function () { if (S.pending[d] === v) delete S.pending[d]; persist(); });
    });
  }, Promise.resolve()).then(flushObs).then(uploadAll).then(function () { setSync("Synchronisé."); })
    .catch(function (e) { if (!e || e.code !== 401) setSync("Hors ligne : envoi plus tard."); })
    .then(function () { busy = false; render(); if (again) { again = false; flush(); } });
}
function pushDay(d) { S.pending[d] = (S.pending[d] || 0) + 1; persist(); if (busy) again = true; else flush(); }
function refresh() { return api("GET", "/api/data").then(function (r) { applyRemote(r); render(); }).catch(function () {}); }
function boot() {
  api("GET", "/api/data").then(function (r) { applyRemote(r); return loadUp(); })
    .then(function () { $("auth").hidden = true; render(); flush(); })
    .catch(function (e) {
      if (e && e.code === 401) { $("auth").hidden = false; return; }
      var u = null; try { u = localStorage.getItem("carnet:user"); } catch (x) {}
      if (!u) { $("auth").hidden = false; return; }
      restore(u); $("num").value = S.num;
      loadUp().then(function () { $("auth").hidden = true; render(); setSync("Hors ligne."); });
    });
}

/* ---------- affichage ---------- */
function src(p) { if (p.blob) { if (!urls[p.id]) urls[p.id] = URL.createObjectURL(p.blob); return urls[p.id]; } return "/api/photo/" + p.id; }
function thumbs(list) {
  return list.map(function (p) { return '<button class="th' + (p.blob ? " wait" : "") + '" data-p="' + p.id + '" aria-label="Voir la photo"><img loading="lazy" alt="Photo" src="' + src(p) + '"></button>'; }).join("");
}
function showOt(d) {
  var m = otOf(d), j = S.days[d] || {};
  if (isFri(d)) { var fm = fridayMins(d); $("ot").innerHTML = worked(d) ? "Vendredi (week-end) : <strong>travaillé</strong>" + (fm ? " · " + hm(fm) : (j.out ? "" : " · saisissez l’heure de sortie")) : "Vendredi (week-end) : non travaillé"; }
  else $("ot").innerHTML = !j.out ? "Saisissez l’heure de sortie." : (m ? "Heures sup. : <strong>" + hm(m) + "</strong>" : "Pas d’heure sup. (sortie avant 16 h)");
  var show = isFri(d) ? worked(d) : otOf(d) > 0; $("sentRow").hidden = !show; $("sent").checked = !!j.sent;
  var pre = d.slice(0, 7), tot = 0, ks = Object.keys(S.days).filter(function (k) { return k.slice(0, 7) === pre && otOf(k); }).sort(), lh = "";
  ks.forEach(function (k) { tot += otOf(k); lh += '<button data-d="' + k + '"><span style="text-transform:capitalize">' + fmt(k) + '</span><span>sortie ' + S.days[k].out + ' → ' + hm(otOf(k)) + (S.days[k].sent ? ' ✓' : '') + '</span></button>'; });
  $("mtotal").innerHTML = "Total en " + monthName(pre) + " : <strong>" + hm(tot) + "</strong> sur " + ks.length + " jour" + (ks.length > 1 ? "s" : "");
  var nf = Object.keys(S.days).filter(function (k) { return k.slice(0, 7) === pre && isFri(k) && worked(k); }).length;
  if (nf) $("mtotal").innerHTML += "<br>Vendredis travaillés : <strong>" + nf + "</strong>";
  $("otList").innerHTML = lh;
}
function render() {
  var d = dateEl.value || today();
  fillSelects(); $("who").textContent = S.user ? S.user + " · " : "";
  $("dayLabel").textContent = fmt(d);
  var j = S.days[d] || {};
  if (document.activeElement !== $("tin")) $("tin").value = j.arr || "08:00";
  if (document.activeElement !== $("tout")) $("tout").value = j.out || "";
  showOt(d);
  var ns = dayNotes(d), ph = allPhotos(d), ids = {}, html = "";
  ns.forEach(function (n) { ids[n.id] = 1; });
  ns.forEach(function (n) {
    html += '<div class="note"><div class="meta"><strong>' + esc(n.time) + '</strong><span class="tag">' + esc(n.cat) + '</span>' + (locStr(n) ? '<span>' + esc(locStr(n)) + '</span>' : '') + '<button class="del" data-id="' + esc(n.id) + '">Supprimer</button></div><p class="txt">' + esc(n.text) + '</p>' +
      (function () { var l = ph.filter(function (p) { return p.note === n.id; }); return l.length ? '<div class="ph">' + thumbs(l) + '</div>' : ""; })() + '</div>';
  });
  $("list").innerHTML = html || '<div class="empty">Aucune note pour cette journée. Ajoutez la première ci-dessus.</div>';
  var free = ph.filter(function (p) { return !p.note || (!ids[p.note] && p.note.indexOf("obs-") !== 0); });
  $("gal").innerHTML = free.length ? '<div class="ph">' + thumbs(free) + '</div>' : '<div class="empty">Aucune photo pour le moment.</div>';
  $("share").hidden = !(ph.length && navigator.canShare);
  renderHist(); renderReport(); renderJournal(d); renderObs();
}
function renderHist() {
  var q = $("q").value.trim().toLowerCase(), cur = dateEl.value, map = {}, html = "";
  S.notes.forEach(function (n) { if (q && (n.text + " " + n.cat + " " + n.zone).toLowerCase().indexOf(q) < 0) return; (map[n.date] = map[n.date] || { n: 0, p: 0 }).n++; });
  if (!q) S.photos.forEach(function (p) { (map[p.date] = map[p.date] || { n: 0, p: 0 }).p++; });
  Object.keys(map).sort().reverse().forEach(function (d) {
    if (!q && d === cur) return;
    var x = map[d], lbl = (x.n ? x.n + " note" + (x.n > 1 ? "s" : "") : "") + (x.n && x.p ? " · " : "") + (x.p ? x.p + " photo" + (x.p > 1 ? "s" : "") : "");
    html += '<button data-d="' + d + '"><span style="text-transform:capitalize">' + fmt(d) + '</span><span>' + lbl + '</span></button>';
  });
  $("hist").innerHTML = html || '<div class="empty">' + (q ? "Aucun résultat." : "Pas d’autres journées enregistrées.") + '</div>';
}

/* ---------- photos ---------- */
function shrink(file) {
  return new Promise(function (ok, ko) {
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(function (b) { b ? ok(b) : ko(); }, "image/jpeg", 0.82);
    };
    im.onerror = function () { URL.revokeObjectURL(url); ko(); };
    im.src = url;
  });
}
function queue(list) {
  return Promise.all(list.map(function (o) { return idbPut(o).catch(function () {}).then(function () { up.push(o); }); }));
}
function renderStaged() {
  $("staged").innerHTML = staged.map(function (s, i) { return '<button class="th" data-s="' + i + '" aria-label="Retirer cette photo"><img alt="Photo à joindre" src="' + s.url + '"></button>'; }).join("");
}
function pickFiles(input, cb) {
  input.onchange = function () {
    var fs = Array.prototype.slice.call(input.files); input.value = "";
    Promise.all(fs.map(function (f) { return shrink(f).catch(function () { toast("Photo illisible"); return null; }); })).then(function (bs) { cb(bs.filter(Boolean)); });
  };
}
pickFiles($("fileNote"), function (bs) { bs.forEach(function (b) { staged.push({ blob: b, url: URL.createObjectURL(b) }); }); renderStaged(); });
pickFiles($("fileDay"), function (bs) {
  var d = dateEl.value || today();
  queue(bs.map(function (b) { return { id: uuid(), user: S.user, date: d, note: null, blob: b }; })).then(function () { render(); flush(); });
});
$("pickNote").onclick = function () { $("fileNote").click(); };
$("pickDay").onclick = function () { $("fileDay").click(); };
$("staged").onclick = function (e) { var b = e.target.closest("button"); if (!b) return; staged.splice(+b.getAttribute("data-s"), 1); renderStaged(); };
$("share").onclick = function () {
  var ph = allPhotos(dateEl.value).slice(0, 10);
  Promise.all(ph.map(function (p) {
    return (p.blob ? Promise.resolve(p.blob) : fetch("/api/photo/" + p.id).then(function (r) { return r.blob(); })).then(function (b) { return new File([b], "chantier-" + p.id.slice(0, 6) + ".jpg", { type: "image/jpeg" }); });
  })).then(function (files) {
    if (navigator.canShare && navigator.canShare({ files: files })) return navigator.share({ files: files, text: "Chantier du " + fmt(dateEl.value) });
    toast("Partage de photos indisponible sur cet appareil");
  }).catch(function () {});
};
function openViewer(e) {
  var b = e.target.closest("button[data-p]"); if (!b) return;
  var id = b.getAttribute("data-p"), p = findPhoto(id); if (!p) return;
  viewing = p; $("vimg").src = src(p); $("viewer").hidden = false;
}
$("list").addEventListener("click", openViewer); $("gal").addEventListener("click", openViewer);
$("vclose").onclick = function () { $("viewer").hidden = true; viewing = null; };
$("vdel").onclick = function () {
  var p = viewing; if (!p) return;
  if (p.blob) { up = up.filter(function (x) { return x.id !== p.id; }); idbDel(p.id); $("vclose").onclick(); render(); return; }
  api("DELETE", "/api/photo/" + p.id).then(function () { S.photos = S.photos.filter(function (x) { return x.id !== p.id; }); persist(); $("vclose").onclick(); render(); })
    .catch(function () { toast("Connexion requise pour supprimer une photo"); });
};

/* ---------- notes et heures ---------- */
$("add").onclick = function () {
  var t = $("text").value.trim();
  if (!t) { toast("Écrivez d’abord la note"); $("text").focus(); return; }
  var now = new Date(), d = dateEl.value || today(), id = uuid().slice(0, 18);
  S.notes.push({ id: id, date: d, time: pad(now.getHours()) + ":" + pad(now.getMinutes()), cat: $("cat").value, zone: $("zone").value.trim(), bloc: $("nbloc").value, niveau: $("nniv").value, text: t });
  var ps = staged.map(function (s) { return { id: uuid(), user: S.user, date: d, note: id, blob: s.blob }; }); staged = []; renderStaged();
  queue(ps).then(function () { persist(); pushDay(d); $("text").value = ""; render(); toast("Note ajoutée"); });
};
$("list").addEventListener("click", function (e) {
  var b = e.target, id = b.getAttribute && b.getAttribute("data-id"); if (!id) return;
  if (b.getAttribute("data-arm") !== "1") { b.setAttribute("data-arm", "1"); b.textContent = "Confirmer ?"; setTimeout(function () { b.setAttribute("data-arm", "0"); b.textContent = "Supprimer"; }, 3000); return; }
  var n = S.notes.filter(function (x) { return x.id === id; })[0]; if (!n) return;
  S.notes = S.notes.filter(function (x) { return x.id !== id; });
  up.filter(function (u) { return u.note === id; }).forEach(function (u) { idbDel(u.id); });
  up = up.filter(function (u) { return u.note !== id; }); S.photos = S.photos.filter(function (p) { return p.note !== id; });
  persist(); pushDay(n.date); render();
});
function onTimes() { var d = dateEl.value; var pj = S.days[d] || {}; S.days[d] = { arr: $("tin").value, out: $("tout").value, sent: pj.out === $("tout").value ? (pj.sent || "") : "", journal: pj.journal || {} }; persist(); pushDay(d); showOt(d); renderReport(); }
$("tin").onchange = onTimes; $("tout").onchange = onTimes;
$("padd").onclick = function () {
  var d = $("pd").value, o = $("po").value;
  if (!d || !o) { toast("Choisissez la date et l’heure de sortie"); return; }
  var j = S.days[d] || {}; S.days[d] = { arr: j.arr || "08:00", out: o, sent: j.out === o ? (j.sent || "") : "", journal: j.journal || {} }; persist(); pushDay(d); dateEl.value = d; render();
  toast(isFri(d) ? "Vendredi enregistré (travaillé)" : otOf(d) ? "Heures sup. enregistrées : " + hm(otOf(d)) : "Enregistré (pas d’heure sup.)");
};
$("otList").onclick = $("hist").onclick = function (e) {
  var b = e.target.closest("button"); if (!b) return;
  dateEl.value = b.getAttribute("data-d"); $("q").value = ""; render(); window.scrollTo({ top: 0, behavior: "smooth" });
};
$("q").oninput = renderHist; dateEl.onchange = render;

/* ---------- rapport pour le comptable (heures non encore envoyées) ---------- */
function iso(dt) { return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()); }
function parseD(d) { var p = d.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function fmtShort(d) { return parseD(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
function noteLines(ns) { return ns.map(function (n) { return "   - [" + n.cat + (locStr(n) ? " – " + locStr(n) : "") + "] " + n.text.replace(/\n/g, "\n     "); }); }
function allDates() { var m = {}; Object.keys(S.days).forEach(function (d) { m[d] = 1; }); S.notes.forEach(function (n) { m[n.date] = 1; }); return Object.keys(m).sort(); }
function isPending(d) { var x = S.days[d] || {}; if (x.sent) return false; return isFri(d) ? worked(d) : otOf(d) > 0; }
function pendingDates() { return allDates().filter(isPending); }
function unsentReport() {
  var pend = pendingDates(); if (!pend.length) return "";
  var tot = 0, nOt = 0, lines = [], fri = [];
  pend.forEach(function (d) {
    var ns = dayNotes(d), x = S.days[d] || {};
    if (isFri(d)) {
      var fm = fridayMins(d);
      fri.push("• " + fmt(d) + " : travaillé" + (x.out ? " (" + (x.arr || "08:00") + " → " + x.out + (fm ? ", " + hm(fm) : "") + ")" : ""));
      noteLines(ns).forEach(function (l) { fri.push(l); });
      return;
    }
    var m = otOf(d); tot += m; nOt++;
    lines.push("• " + fmt(d) + " — sortie " + x.out + " → " + hm(m));
    noteLines(ns).forEach(function (l) { lines.push(l); });
  });
  var out = "TOTAL HEURES SUPPLÉMENTAIRES À ENVOYER : " + hm(tot) + "\n(" + nOt + " jour" + (nOt > 1 ? "s" : "") + " · du " + fmtShort(pend[0]) + " au " + fmtShort(pend[pend.length - 1]) + " · heures après 16 h)\n";
  if (nOt) out += "\nDÉTAIL PAR JOURNÉE\n" + lines.join("\n") + "\n";
  if (fri.length) out += "\nVENDREDIS TRAVAILLÉS (week-end, non inclus dans le total)\n" + fri.join("\n") + "\n";
  return out;
}
function renderReport() {
  $("rep").value = unsentReport() || "Aucune heure supplémentaire en attente d’envoi.";
  var p = pendingDates(), n = 0, m = 0, f = 0;
  p.forEach(function (d) { if (isFri(d)) f++; else { n++; m += otOf(d); } });
  $("pendInfo").innerHTML = p.length ? "En attente d’envoi : <strong>" + n + "</strong> jour" + (n > 1 ? "s" : "") + " (" + hm(m) + ")" + (f ? " · <strong>" + f + "</strong> vendredi" + (f > 1 ? "s" : "") + " travaillé" + (f > 1 ? "s" : "") : "") : "Tout est envoyé.";
}
$("mark").onclick = function () {
  var p = pendingDates(); if (!p.length) { toast("Rien en attente"); return; }
  var t = today(); p.forEach(function (d) { var x = S.days[d] || (S.days[d] = { arr: "08:00", out: "" }); x.sent = t; });
  try { localStorage.setItem("carnet:last:" + S.user, JSON.stringify(p)); } catch (e) {}
  persist(); p.forEach(function (d) { pushDay(d); }); render(); toast("Marqué comme envoyé (" + p.length + " jour" + (p.length > 1 ? "s" : "") + ")");
};
$("undo").onclick = function () {
  var p = []; try { p = JSON.parse(localStorage.getItem("carnet:last:" + S.user) || "[]"); } catch (e) {}
  if (!p.length) { toast("Rien à annuler"); return; }
  p.forEach(function (d) { if (S.days[d]) S.days[d].sent = ""; });
  try { localStorage.removeItem("carnet:last:" + S.user); } catch (e) {}
  persist(); p.forEach(function (d) { pushDay(d); }); render(); toast("Dernier marquage annulé");
};
$("sent").onchange = function () {
  var d = dateEl.value, x = S.days[d] || (S.days[d] = { arr: "08:00", out: "" });
  x.sent = this.checked ? today() : ""; persist(); pushDay(d); render();
};
function copyText(t) {
  try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t); } catch (e) {}
  return new Promise(function (ok, ko) {
    var ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
    var r = false; try { r = document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); r ? ok() : ko();
  });
}
$("copy").onclick = function () {
  var t = unsentReport(); if (!t) { toast("Choisissez la période du rapport"); return; }
  copyText(t).then(function () { toast("Rapport copié"); }, function () { $("rep").select(); toast("Sélectionnez le texte et copiez-le"); });
};
$("wa").onclick = function () {
  var t = unsentReport(); if (!t) { toast("Choisissez la période du rapport"); return; }
  var base = "https://wa.me/" + S.num, w = null, long = t.length > 1500;
  try { w = window.open(long ? base : base + "?text=" + encodeURIComponent(t), "_blank"); } catch (e) {}
  if (long || !w) copyText(t).then(function () { toast("Rapport copié : collez-le dans WhatsApp"); }, function () { toast("Copiez le rapport affiché puis collez-le dans WhatsApp"); });
};
$("num").onchange = function () { S.num = $("num").value.replace(/\D/g, ""); persist(); api("PUT", "/api/settings", { num: S.num }).catch(function () {}); };

/* ---------- connexion ---------- */
function setMode(m) {
  mode = m; var reg = m === "register";
  $("authSub").textContent = reg ? "Créez votre carnet personnel." : "Connectez-vous à votre carnet.";
  $("aok").textContent = reg ? "Créer mon compte" : "Se connecter"; $("swap").textContent = reg ? "J’ai déjà un compte" : "Créer un compte";
  $("codeRow").hidden = !reg; $("ap").autocomplete = reg ? "new-password" : "current-password"; $("aerr").textContent = "";
}
$("swap").onclick = function () { setMode(mode === "login" ? "register" : "login"); };
$("aok").onclick = function () {
  $("aerr").textContent = "";
  api("POST", mode === "login" ? "/api/login" : "/api/register", { username: $("au").value.trim(), password: $("ap").value, code: $("ac").value.trim() })
    .then(function () { $("ap").value = ""; $("auth").hidden = true; boot(); })
    .catch(function (e) { $("aerr").textContent = (e && e.msg) || "Connexion impossible."; });
};
$("ap").onkeydown = function (e) { if (e.key === "Enter") $("aok").click(); };
$("logout").onclick = function () {
  if (Object.keys(S.pending).length || up.length) { toast("Des données ne sont pas encore envoyées. Reconnectez-vous au réseau d’abord."); return; }
  api("POST", "/api/logout").catch(function () {}).then(function () {
    try { localStorage.removeItem("carnet:s:" + S.user); localStorage.removeItem("carnet:user"); } catch (e) {}
    location.reload();
  });
};

/* ---------- chantier : blocs, niveaux, réglages ---------- */
var DEF_NIV = ["Sous-sol", "RDC", "R+1", "R+2", "R+3", "R+4", "R+5", "R+6", "Attique", "Toiture"], cfgSig = "";
function cfg() {
  var s = S.settings || {};
  return { blocs: s.blocs && s.blocs.length ? s.blocs : ["Bloc A", "Bloc B"], niveaux: s.niveaux && s.niveaux.length ? s.niveaux : DEF_NIV,
    company: s.company || "Inbar Construction", project: s.project || "", promoter: s.promoter || "", author: s.author || "", attendees: s.attendees || "", lastPv: s.lastPv || null };
}
function locStr(o) { return [o.bloc, o.niveau, o.zone].filter(Boolean).join(" · "); }
function ord(arr, v) { var i = arr.indexOf(v); return i < 0 ? 999 : i; }
function grp(list, gb, gn) {
  var c = cfg(), m = {};
  list.forEach(function (x) { var b = gb(x) || "Bloc non précisé", n = gn(x) || "Niveau non précisé"; ((m[b] = m[b] || {})[n] = m[b][n] || []).push(x); });
  return Object.keys(m).sort(function (a, b) { return ord(c.blocs, a) - ord(c.blocs, b); }).map(function (b) {
    return { b: b, ns: Object.keys(m[b]).sort(function (a, z) { return ord(c.niveaux, a) - ord(c.niveaux, z); }).map(function (n) { return { n: n, items: m[b][n] }; }) };
  });
}
function fillSel(id, items, first) {
  var el = $(id), cur = el.value;
  el.innerHTML = '<option value="">' + first + "</option>" + items.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("");
  if (cur && items.indexOf(cur) >= 0) el.value = cur;
}
function fillSelects() {
  var c = cfg(), sig = JSON.stringify(c); if (sig === cfgSig) return; cfgSig = sig;
  fillSel("nbloc", c.blocs, "Bloc"); fillSel("obloc", c.blocs, "Bloc"); fillSel("fbloc", c.blocs, "Tous les blocs");
  fillSel("nniv", c.niveaux, "Niveau"); fillSel("oniv", c.niveaux, "Niveau"); fillSel("fniv", c.niveaux, "Tous les niveaux");
  $("ocomp").placeholder = c.company;
  [["sproj", c.project], ["sprom", c.promoter], ["scomp", c.company], ["sauth", c.author]].forEach(function (p) { if (document.activeElement !== $(p[0])) $(p[0]).value = p[1]; });
  if (document.activeElement !== $("sblocs")) $("sblocs").value = c.blocs.join("\n");
  if (document.activeElement !== $("sniv")) $("sniv").value = c.niveaux.join("\n");
}
function saveSettings() {
  persist();
  return api("PUT", "/api/settings", { settings: S.settings }).catch(function () { toast("Connexion requise pour enregistrer les réglages"); throw 0; });
}
$("ssave").onclick = function () {
  var lines = function (id) { return $(id).value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); };
  S.settings = Object.assign({}, S.settings, { blocs: lines("sblocs"), niveaux: lines("sniv"), company: $("scomp").value.trim(), project: $("sproj").value.trim(), promoter: $("sprom").value.trim(), author: $("sauth").value.trim() });
  saveSettings().then(function () { cfgSig = ""; fillSelects(); render(); toast("Réglages enregistrés"); }, function () {});
};
function showTab(t) {
  document.querySelectorAll("section[data-tab]").forEach(function (s) { s.hidden = s.getAttribute("data-tab") !== t; });
  document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-t") === t); });
  try { localStorage.setItem("carnet:tab", t); } catch (e) {}
  if (t === "pv") initPv();
  window.scrollTo(0, 0);
}
$("tabs").onclick = function (e) { var b = e.target.closest("button"); if (b) showTab(b.getAttribute("data-t")); };

/* ---------- journal de chantier ---------- */
var JF = { meteo: "jmeteo", inbar: "jinbar", other: "jother", stoppage: "jstop", material: "jmat", deliveries: "jdeliv", remarks: "jrem" };
function renderJournal(d) { var jj = (S.days[d] || {}).journal || {}; Object.keys(JF).forEach(function (k) { var el = $(JF[k]); if (document.activeElement !== el) el.value = jj[k] || ""; }); }
function saveJournal() {
  var d = dateEl.value, x = S.days[d] || (S.days[d] = { arr: "08:00", out: "", sent: "" }), jj = {};
  Object.keys(JF).forEach(function (k) { var v = $(JF[k]).value.trim(); if (v) jj[k] = v; });
  x.journal = jj; persist(); pushDay(d);
}
Object.keys(JF).forEach(function (k) { $(JF[k]).onchange = saveJournal; });

/* ---------- observations et réserves ---------- */
var stagedO = [];
function renderStagedO() { $("ostaged").innerHTML = stagedO.map(function (s, i) { return '<button class="th" data-s="' + i + '" aria-label="Retirer cette photo"><img alt="Photo à joindre" src="' + s.url + '"></button>'; }).join(""); }
pickFiles($("fileObs"), function (bs) { bs.forEach(function (b) { stagedO.push({ blob: b, url: URL.createObjectURL(b) }); }); renderStagedO(); });
$("pickObs").onclick = function () { $("fileObs").click(); };
$("ostaged").onclick = function (e) { var b = e.target.closest("button"); if (!b) return; stagedO.splice(+b.getAttribute("data-s"), 1); renderStagedO(); };
function pushObs(id) { S.pendingO[id] = (S.pendingO[id] || 0) + 1; persist(); if (busy) again = true; else flush(); }
function overdue(o) { return !!(o.due && o.due < today() && o.status !== "levé"); }
$("addObs").onclick = function () {
  var t = $("otext").value.trim(); if (!t) { toast("Décrivez l’observation"); $("otext").focus(); return; }
  var id = "obs-" + uuid().slice(0, 12), d = today();
  S.obs.push({ id: id, day: d, bloc: $("obloc").value, niveau: $("oniv").value, zone: $("ozone").value.trim(), text: t, company: $("ocomp").value.trim() || cfg().company, priority: $("oprio").value, due: $("odue").value, status: "ouvert", closed: "" });
  var ps = stagedO.map(function (s) { return { id: uuid(), user: S.user, date: d, note: id, blob: s.blob }; }); stagedO = []; renderStagedO();
  queue(ps).then(function () { persist(); pushObs(id); $("otext").value = ""; $("ozone").value = ""; $("odue").value = ""; $("oprio").value = "normale"; render(); toast("Observation ajoutée"); });
};
function renderObs() {
  var fb = $("fbloc").value, fn = $("fniv").value, fs = $("fstat").value;
  var all = S.obs.filter(function (o) { return !o.deleted; }), open = all.filter(function (o) { return o.status !== "levé"; });
  var late = open.filter(overdue).length, urg = open.filter(function (o) { return o.priority === "urgente"; }).length;
  $("osum").innerHTML = open.length ? "<strong>" + open.length + "</strong> à traiter" + (late ? ' · <span class="late">' + late + " en retard</span>" : "") + (urg ? " · " + urg + " urgente" + (urg > 1 ? "s" : "") : "") : "Aucune observation à traiter.";
  var list = all.filter(function (o) { return (!fb || o.bloc === fb) && (!fn || o.niveau === fn) && (fs === "all" || (fs === "open" ? o.status !== "levé" : o.status === "levé")); });
  list.sort(function (a, b) { return (a.priority === "urgente" ? 0 : 1) - (b.priority === "urgente" ? 0 : 1) || (a.due || "9").localeCompare(b.due || "9"); });
  var nxt = { "ouvert": "Passer en cours", "en cours": "Marquer levé", "levé": "Rouvrir" }, html = "";
  grp(list, function (o) { return o.bloc; }, function (o) { return o.niveau; }).forEach(function (g) {
    html += '<div class="grp">' + esc(g.b) + "</div>";
    g.ns.forEach(function (n) {
      html += '<div class="lvl">' + esc(n.n) + "</div>";
      n.items.forEach(function (o) {
        var ph = S.photos.concat(up).filter(function (p) { return p.note === o.id; });
        html += '<div class="note"><div class="meta"><span class="tag">' + esc(o.status) + "</span>" + (o.priority === "urgente" ? '<span class="tag urg">Urgente</span>' : "") + (o.due ? '<span class="' + (overdue(o) ? "late" : "") + '">avant le ' + esc(fmtShort(o.due)) + "</span>" : "") + '<button class="stbtn" data-ost="' + esc(o.id) + '">' + nxt[o.status] + '</button></div><p class="txt">' + esc(o.text) + '</p><div class="meta">' + (o.zone ? esc(o.zone) + " · " : "") + esc(o.company || "") + " · signalée le " + esc(fmtShort(o.day)) + (o.closed ? " · levée le " + esc(fmtShort(o.closed)) : "") + '<button class="del" data-odel="' + esc(o.id) + '">Supprimer</button></div>' + (ph.length ? '<div class="ph">' + thumbs(ph) + "</div>" : "") + "</div>";
      });
    });
  });
  $("olist").innerHTML = html || '<div class="empty">Aucune observation dans cette vue.</div>';
}
["fbloc", "fniv", "fstat"].forEach(function (id) { $(id).onchange = renderObs; });
$("olist").addEventListener("click", function (e) {
  var b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-p")) { openViewer(e); return; }
  var id = b.getAttribute("data-ost") || b.getAttribute("data-odel"); if (!id) return;
  var o = S.obs.filter(function (x) { return x.id === id; })[0]; if (!o) return;
  if (b.hasAttribute("data-ost")) {
    o.status = o.status === "ouvert" ? "en cours" : o.status === "en cours" ? "levé" : "ouvert"; o.closed = o.status === "levé" ? today() : "";
    persist(); pushObs(id); render(); return;
  }
  if (b.getAttribute("data-arm") !== "1") { b.setAttribute("data-arm", "1"); b.textContent = "Confirmer ?"; setTimeout(function () { b.setAttribute("data-arm", "0"); b.textContent = "Supprimer"; }, 3000); return; }
  o.deleted = true; up.filter(function (u) { return u.note === id; }).forEach(function (u) { idbDel(u.id); });
  up = up.filter(function (u) { return u.note !== id; }); S.photos = S.photos.filter(function (p) { return p.note !== id; });
  persist(); pushObs(id); render();
});

/* ---------- PV de réunion de chantier ---------- */
var pvInit = false;
function initPv() {
  if (pvInit) return; pvInit = true;
  var c = cfg(), f = "";
  if (c.lastPv) { var p = parseD(c.lastPv.date); p.setDate(p.getDate() + 1); f = iso(p); }
  $("pvDate").value = today(); $("pvNum").value = c.lastPv ? c.lastPv.num + 1 : 1; $("pvFrom").value = f; $("pvAtt").value = c.attendees;
}
function pvData() { return { date: $("pvDate").value || today(), num: $("pvNum").value || "", from: $("pvFrom").value, att: $("pvAtt").value, dec: $("pvDec").value, next: $("pvNext").value, photos: $("pvPhotos").checked }; }
var PVCSS = "body{font-family:Arial,Helvetica,sans-serif;font-size:12pt;color:#111;margin:24px}h1{font-size:17pt;text-align:center;margin:0 0 14px}h2{font-size:13pt;border-bottom:1px solid #333;margin:20px 0 6px;padding-bottom:2px}h3{font-size:12pt;margin:12px 0 2px}h3.s{margin-top:14px;color:#1f4f8f}.lv{margin:6px 0 0;font-weight:bold;color:#555}ul,ol{margin:2px 0 6px 18px;padding:0}li{margin:2px 0}table.hd{width:100%;border-collapse:collapse}table.hd td{border:1px solid #888;padding:4px 8px}table.hd td:first-child{width:32%;background:#eee;font-weight:bold}.im img{max-width:210px;max-height:160px;margin:4px 6px 0 0}.sig{display:flex;gap:40px;margin-top:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center}";
function pvHtml(o) {
  var c = cfg(), from = o.from || "", to = o.date;
  function inP(d) { return (!from || d >= from) && d <= to; }
  function lis(list, fn) { return "<ul>" + list.map(function (x) { return "<li>" + fn(x) + "</li>"; }).join("") + "</ul>"; }
  function grpHtml(list, fn) {
    return grp(list, function (x) { return x.bloc; }, function (x) { return x.niveau; }).map(function (g) {
      return "<h3>" + esc(g.b) + "</h3>" + g.ns.map(function (n) { return '<p class="lv">' + esc(n.n) + "</p>" + lis(n.items, fn); }).join("");
    }).join("");
  }
  var notes = S.notes.filter(function (n) { return inP(n.date); }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : 1; });
  var prog = grpHtml(notes, function (n) { return esc(fmtShort(n.date)) + " — <i>" + esc(n.cat) + "</i>" + (n.zone ? " (" + esc(n.zone) + ")" : "") + " : " + esc(n.text).replace(/\n/g, "<br>"); }) || "<p>Aucun travail noté sur la période.</p>";
  var jl = Object.keys(S.days).filter(inP).sort().map(function (d) {
    var jj = S.days[d].journal || {}, a = [];
    if (jj.meteo) a.push("Météo : " + esc(jj.meteo));
    if (jj.inbar) a.push("Effectif " + esc(c.company) + " : " + esc(jj.inbar));
    if (jj.other) a.push("Autres intervenants : " + esc(jj.other));
    if (jj.stoppage) a.push("<b>Arrêt de travail : " + esc(jj.stoppage) + "</b>");
    if (jj.material) a.push("Matériel : " + esc(jj.material));
    if (jj.deliveries) a.push("Livraisons : " + esc(jj.deliveries));
    if (jj.remarks) a.push("Remarques : " + esc(jj.remarks));
    return a.length ? "<li>" + esc(fmt(d)) + " — " + a.join(" · ") + "</li>" : "";
  }).join("");
  var obs = S.obs.filter(function (x) { return !x.deleted; });
  function oLine(x) {
    var ph = o.photos ? S.photos.filter(function (p) { return p.note === x.id; }).map(function (p) { return '<img src="/api/photo/' + p.id + '">'; }).join("") : "";
    return (x.priority === "urgente" ? "<b>[URGENT]</b> " : "") + esc(x.text) + (x.zone ? " (" + esc(x.zone) + ")" : "") + (x.status === "en cours" ? " — <i>en cours</i>" : "") + (x.due && x.status !== "levé" ? " — à lever avant le " + esc(fmtShort(x.due)) + (x.due < today() ? " <b>(en retard)</b>" : "") : "") + (ph ? '<div class="im">' + ph + "</div>" : "");
  }
  var sub = function (t, l) { return '<h3 class="s">' + t + " (" + l.length + ")</h3>" + (l.length ? grpHtml(l, oLine) : "<p>Néant.</p>"); };
  var nw = obs.filter(function (x) { return inP(x.day); }), lev = obs.filter(function (x) { return x.status === "levé" && x.closed && inP(x.closed); }), opn = obs.filter(function (x) { return x.status !== "levé"; });
  var att = o.att.split("\n").map(function (x) { return x.trim(); }).filter(Boolean), dec = o.dec.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
  var row = function (a, b) { return b ? "<tr><td>" + a + "</td><td>" + esc(b) + "</td></tr>" : ""; };
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>PV n° ' + esc(o.num) + "</title><style>" + PVCSS + "</style></head><body><h1>PROCÈS-VERBAL DE RÉUNION DE CHANTIER N° " + esc(o.num) + '</h1><table class="hd">' +
    row("Projet", c.project) + row("Maître d’ouvrage", c.promoter) + row("Entreprise réalisatrice", c.company) + row("Date de la réunion", fmt(o.date)) + row("Période couverte", (from ? "du " + fmtShort(from) + " " : "jusqu’") + "au " + fmtShort(to)) + row("Rédigé par", c.author) + "</table>" +
    "<h2>Présents</h2>" + (att.length ? lis(att, esc) : "<p>—</p>") +
    "<h2>1. Avancement des travaux par bloc et par niveau</h2>" + prog +
    "<h2>2. Journal de chantier</h2>" + (jl ? "<ul>" + jl + "</ul>" : "<p>Aucune donnée saisie sur la période.</p>") +
    "<h2>3. Observations et réserves</h2>" + sub("Nouvelles observations", nw) + sub("Levées sur la période", lev) + sub("Toutes les réserves restant à lever", opn) +
    "<h2>4. Points abordés et décisions</h2>" + (dec.length ? "<ol>" + dec.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" : "<p>—</p>") +
    "<h2>5. Prochaine réunion</h2><p>" + (o.next ? esc(fmt(o.next)) : "À fixer") + '</p><div class="sig"><div>Le maître d’œuvre / le représentant du maître d’ouvrage</div><div>' + esc(c.company) + "</div></div></body></html>";
}
$("pvPrint").onclick = function () {
  var w = null; try { w = window.open("", "_blank"); } catch (e) {}
  if (!w) { toast("Fenêtre bloquée : utilisez « Télécharger (Word) »"); return; }
  w.document.open(); w.document.write(pvHtml(pvData())); w.document.close();
  setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 800);
};
$("pvDoc").onclick = function () {
  var o = pvData(); o.photos = false;
  var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + pvHtml(o)], { type: "application/msword" })); a.download = "PV-" + o.num + ".doc";
  document.body.appendChild(a); a.click(); document.body.removeChild(a); toast("PV téléchargé (sans photos)");
};
$("pvSave").onclick = function () {
  var n = parseInt($("pvNum").value, 10); if (!(n > 0)) { toast("Numéro de PV invalide"); return; }
  S.settings = Object.assign({}, S.settings, { attendees: $("pvAtt").value, lastPv: { num: n, date: $("pvDate").value || today() } });
  saveSettings().then(function () { pvInit = false; initPv(); $("pvDec").value = ""; $("pvNext").value = ""; toast("PV n° " + n + " enregistré"); }, function () {});
};

/* ---------- démarrage ---------- */
setInterval(function () { var a = document.activeElement; if (a && (a.id === "tin" || a.id === "tout")) return; if (S.user) flush().then(refresh); }, 30000);
window.addEventListener("online", function () { if (S.user) flush().then(refresh); });
document.addEventListener("visibilitychange", function () { if (!document.hidden && S.user) flush().then(refresh); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(function () {});
var tab0 = "day"; try { tab0 = localStorage.getItem("carnet:tab") || "day"; } catch (e) {}
showTab(tab0); render(); boot();
})();
