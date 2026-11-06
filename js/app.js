/* Seilplan — app: GPS, passage A→B, weather windows across models, anchoring, places and activities nearby. */
(function () {
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const G = Geo;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<)\]]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const nowS = () => Math.floor(Date.now() / 1000);

  /* ---------------- state ---------------- */
  const DEF = { A: null, B: null, via: [], dep: null, src: 'ecmwf_ifs025', night: false, stay: 3, ank: null, nC: null, nR: 10, nSub: 'steder', seamarks: true, view: null,
    S: { speed: 6, len: 12, windMin: 5, windMax: 25, gustMax: 35, waveMax: 3.5, avoidBeat: true, utc: false, wake: false, langs: 'no,en', key: '', tm: '' } };
  let st;
  try { st = Object.assign({}, DEF, JSON.parse(localStorage.getItem('seilplan.v1') || '{}')); st.S = Object.assign({}, DEF.S, st.S || {}); } catch { st = structuredClone(DEF); }
  let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('seilplan.v1', JSON.stringify(st)); } catch {} }, 300); };

  let WXD = null, ANKD = null, SAMPLES = [], FIX = null, follow = false, pick = null, tab = 'pass', NEAR = [], ACT = [], EVENTS = [], nCat = 'alle', aCat = 'alle', openPoi = null;

  /* ---------------- formatting ---------------- */
  const WD = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'], MON = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
  const p2 = (n) => String(n).padStart(2, '0');
  function fmtT(s, day = true) { if (s == null) return '–'; const d = new Date(s * 1000), u = st.S.utc;
    const w = WD[u ? d.getUTCDay() : d.getDay()], hh = p2(u ? d.getUTCHours() : d.getHours()), mm = p2(u ? d.getUTCMinutes() : d.getMinutes());
    const dm = `${u ? d.getUTCDate() : d.getDate()}.${(u ? d.getUTCMonth() : d.getMonth()) + 1}`;
    return (day ? `${w} ${dm} ` : '') + `${hh}:${mm}` + (u ? 'Z' : ''); }
  function fmtDur(h) { if (!isFinite(h)) return '–'; const m = Math.round(h * 60); if (m >= 1440) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} t`; return `${Math.floor(m / 60)} t ${p2(m % 60)} m`; }
  const num = G.num, col = (s) => (s == null ? 'var(--line)' : s >= 75 ? 'var(--good)' : s >= 50 ? 'var(--ok)' : 'var(--bad)');
  const wcol = (ws) => (ws == null ? 'var(--muted)' : ws < st.S.windMin ? 'var(--muted)' : ws <= st.S.windMax ? 'var(--good)' : ws <= st.S.windMax + 8 ? 'var(--ok)' : 'var(--bad)');
  const sail = (twa) => (twa < 45 ? 'kryss' : twa < 70 ? 'bidevind' : twa < 110 ? 'halvvind' : twa < 150 ? 'slør' : 'lens');
  function arrow(wd, size, c, label) {
    const L = size * 0.62;
    return `<svg width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" aria-hidden="true"><g transform="rotate(${Math.round(wd)})"><line x1="0" y1="${-L / 2}" x2="0" y2="${L / 2 - 3}" stroke="${c}" stroke-width="${size > 30 ? 3 : 2}" stroke-linecap="round"/><path d="M0,${L / 2 + 3} l-${size > 30 ? 5 : 4},-8 h${size > 30 ? 10 : 8}z" fill="${c}"/></g>${label != null ? `<text x="0" y="${-size / 2 + 9}" text-anchor="middle" style="font:600 11px var(--f-num);fill:${c};paint-order:stroke;stroke:var(--card);stroke-width:3px">${label}</text>` : ''}</svg>`;
  }
  const srcName = (id) => (WX.SOURCES.find((s) => s.id === id) || {}).s || id;

  /* ---------------- map ---------------- */
  const map = new SeaMap($('#map'), st.view || { lat: 30, lon: -20, zoom: 3 });
  map.addTileLayer('osm', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { cls: 'base', maxZoom: 19 });
  map.addTileLayer('sea', 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { minZoom: 6, maxZoom: 18, visible: st.seamarks });
  map.on('move', () => { st.view = { lat: map.lat, lon: map.lon, zoom: map.zoom }; save(); });
  map.on('userpan', () => { if (follow) setFollow(false); });
  map.on('tap', onTap);
  $('#zin').onclick = () => { const [w, h] = map.size(); map.zoomAt(map.zoom + 1, w / 2, h / 2); };
  $('#zout').onclick = () => { const [w, h] = map.size(); map.zoomAt(map.zoom - 1, w / 2, h / 2); };
  $('#follow').onclick = () => setFollow(!follow);
  $('#seamarks').setAttribute('aria-pressed', st.seamarks);
  $('#seamarks').onclick = () => { st.seamarks = !st.seamarks; map.setLayerVisible('sea', st.seamarks); $('#seamarks').setAttribute('aria-pressed', st.seamarks); save(); };
  $('#fitroute').onclick = () => { const pts = routePts(); if (pts.length) map.fit(pts.map((p) => [p.lat, p.lon])); };
  function setFollow(v) { follow = v; $('#follow').setAttribute('aria-pressed', v); if (v && FIX) map.setView(FIX.lat, FIX.lon, Math.max(map.zoom, 11)); }

  function setPick(p, hint) {
    pick = p; map.el.classList.toggle('picking', !!p); const h = $('#maphint'); h.hidden = !p; if (p) h.textContent = hint;
    $$('[data-act="map"]').forEach((b) => b.setAttribute('aria-pressed', p === b.dataset.end));
    $('#addvia').setAttribute('aria-pressed', p === 'via'); $('#ankMap').setAttribute('aria-pressed', p === 'ank');
  }
  async function revName(lat, lon) {
    try { const j = await WX.getJSON(`https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&format=jsonv2&zoom=12&accept-language=nb,en`, 10000);
      const a = j.address || {}; return a.harbour || a.village || a.town || a.city || a.island || a.county || a.state || (j.name || '').split(',')[0] || null; } catch { return null; }
  }
  function onTap({ lat, lon }) {
    if (!pick) return;
    const p = { lat, lon, name: 'Punkt i kartet' }, which = pick; setPick(null);
    if (which === 'A' || which === 'B') { st[which] = p; routeChanged(); revName(lat, lon).then((n) => { if (n && st[which] === p) { p.name = n; routeChanged(true); } }); }
    else if (which === 'via') { insertVia(p); routeChanged(); }
    else if (which === 'ank') { setAnk(p); revName(lat, lon).then((n) => { if (n && st.ank === p) { p.name = n; renderAnk(); save(); } }); }
  }
  function insertVia(p) { // put the via point where it adds the least distance
    const pts = routePts(); if (pts.length < 2) { st.via.push(p); return; }
    let best = 0, bd = Infinity; for (let i = 1; i < pts.length; i++) { const d = G.dist(pts[i - 1], p) + G.dist(p, pts[i]) - G.dist(pts[i - 1], pts[i]); if (d < bd) { bd = d; best = i - 1; } }
    st.via.splice(best, 0, p);
  }

  /* ---------------- GPS ---------------- */
  const fixHist = [];
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords, f = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: pos.timestamp, sog: c.speed != null && !isNaN(c.speed) ? c.speed * 1.94384 : null, cog: c.heading != null && !isNaN(c.heading) ? c.heading : null };
      fixHist.push(f); while (fixHist.length && f.t - fixHist[0].t > 30000) fixHist.shift();
      const o = fixHist[0]; if ((f.sog == null || f.cog == null) && o && f.t - o.t > 8000) { const d = G.dist(o, f); if (f.sog == null) f.sog = d / ((f.t - o.t) / 3600000); if (f.cog == null && d > 0.01) f.cog = G.brg(o, f); }
      FIX = f; drawBoat(); if (follow) map.setView(f.lat, f.lon); updateTop();
    }, (e) => { $('#fix').textContent = e.code === 1 ? 'GPS ikke tillatt' : 'Ingen GPS'; $('#fix').className = 'fix bad'; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  } else $('#fix').textContent = 'GPS ikke tilgjengelig';
  function drawBoat() {
    if (!FIX) return; map.setMarker('boat', FIX.lat, FIX.lon, '<div class="mk-boat"></div>');
    if (FIX.cog != null && (FIX.sog ?? 0) > 0.5) map.setMarker('cog', FIX.lat, FIX.lon, `<div class="mk-cog" style="transform:translate(-50%,-100%) rotate(${FIX.cog}deg)"></div>`); else map.removeMarker('cog');
  }
  function updateTop() {
    if (FIX) { const age = (Date.now() - FIX.t) / 1000; $('#pos').textContent = G.pos(FIX.lat, FIX.lon);
      $('#fix').textContent = age > 60 ? `GPS tapt for ${Math.round(age / 60)} min` : `±${Math.round(FIX.acc)} m`; $('#fix').className = 'fix ' + (age > 60 ? 'bad' : 'ok');
      $('#sogcog').textContent = `SOG ${num(FIX.sog)} kn · COG ${FIX.cog != null ? p2(Math.round(FIX.cog)).padStart(3, '0') + '°' : '–'}`; }
    const on = navigator.onLine; $('#net').textContent = on ? 'Online' : 'Uten nett'; $('#net').className = 'pill' + (on ? '' : ' off');
    if (WXD) { const h = (Date.now() - WXD.fetchedAt) / 3600000; $('#age').textContent = `Varsel ${h < 1 ? Math.round(h * 60) + ' min' : Math.round(h) + ' t'} gammelt`; $('#age').className = 'pill' + (h > 12 ? ' stale' : ''); }
    else { $('#age').textContent = 'Ingen varsel'; $('#age').className = 'pill'; }
  }
  setInterval(updateTop, 5000); addEventListener('online', () => { updateTop(); scheduleFetch(); }); addEventListener('offline', updateTop);

  /* wake lock */
  let wl = null;
  async function wake() { try { if (st.S.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') wl = await navigator.wakeLock.request('screen'); else if (!st.S.wake && wl) { await wl.release(); wl = null; } } catch {} }
  document.addEventListener('visibilitychange', wake);

  /* night mode */
  function applyNight() { document.documentElement.toggleAttribute('data-night', st.night); $('#nightbtn').setAttribute('aria-pressed', st.night); document.querySelector('meta[name=theme-color]').content = st.night ? '#070606' : '#0f2230'; }
  $('#nightbtn').onclick = () => { st.night = !st.night; applyNight(); save(); };

  /* ---------------- route ---------------- */
  const routePts = () => [st.A, ...st.via, st.B].filter(Boolean);
  const routeKey = () => SAMPLES.map((s) => s.lat.toFixed(2) + ',' + s.lon.toFixed(2)).join(';');
  let fetchT;
  function routeChanged(nameOnly) {
    const pts = routePts(); SAMPLES = pts.length >= 2 ? G.samples(pts, 48) : [];
    drawRoute(); renderPass(); save();
    if (!nameOnly) { if (pts.length >= 2) map.fit(pts.map((p) => [p.lat, p.lon]), 60); scheduleFetch(); }
  }
  function scheduleFetch() { clearTimeout(fetchT); if (SAMPLES.length >= 2 && navigator.onLine && (!WXD || WXD.key !== routeKey())) fetchT = setTimeout(() => fetchRoute(false), 1200); }
  function drawRoute() {
    map.clearLines('r'); map.clearMarkers('end'); map.clearMarkers('via');
    const pts = routePts();
    if (pts.length >= 2) { const path = G.path(pts, 20);
      map.setLine('r0', path, { stroke: 'var(--card)', 'stroke-width': '7px', opacity: .8 });
      map.setLine('r1', path, { stroke: 'var(--accent)', 'stroke-width': '3px' }); }
    if (st.A) map.setMarker('endA', st.A.lat, st.A.lon, `<div class="mk-end">A</div><div class="mk-lbl">${esc(st.A.name)}</div>`);
    if (st.B) map.setMarker('endB', st.B.lat, st.B.lon, `<div class="mk-end b">B</div><div class="mk-lbl">${esc(st.B.name)}</div>`);
    st.via.forEach((v, i) => { map.setMarker('via' + i, v.lat, v.lon, `<div class="mk-via" title="Dra for å flytte"></div>`, { cls: 'clickable' }); bindDrag(i); });
  }
  function bindDrag(i) {
    const m = map.markers.get('via' + i); if (!m || m.el.dataset.bound) return; m.el.dataset.bound = 1;
    m.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); m.el.setPointerCapture(e.pointerId); m.el.dataset.drag = 1; });
    m.el.addEventListener('pointermove', (e) => { if (!m.el.dataset.drag) return; const r = map.el.getBoundingClientRect(), [lat, lon] = map.toLatLng(e.clientX - r.left, e.clientY - r.top);
      const idx = +m.el.dataset.i; st.via[idx] = { ...st.via[idx], lat, lon }; m.lat = lat; m.lon = lon; map._placeMarker(m);
      const path = G.path(routePts(), 20); map.setLine('r0', path, { stroke: 'var(--card)', 'stroke-width': '7px', opacity: .8 }); map.setLine('r1', path, { stroke: 'var(--accent)', 'stroke-width': '3px' }); });
    const up = () => { if (!m.el.dataset.drag) return; delete m.el.dataset.drag; routeChanged(true); scheduleFetch(); };
    m.el.addEventListener('pointerup', up); m.el.addEventListener('pointercancel', up);
    m.el.dataset.i = i;
  }

  /* endpoint controls */
  $$('.endbtns button').forEach((b) => b.onclick = () => {
    const e = b.dataset.end, a = b.dataset.act;
    if (a === 'gps') { if (!FIX) { $('#fetchmsg').textContent = 'Venter på GPS-posisjon.'; return; } st[e] = { lat: FIX.lat, lon: FIX.lon, name: 'Min posisjon' }; routeChanged(); }
    if (a === 'map') { if (pick === e) setPick(null); else setPick(e, e === 'A' ? 'Trykk i kartet der passasjen starter (A)' : 'Trykk i kartet der du skal (B)'); }
    if (a === 'search') { const s = $('#search' + e); s.hidden = !s.hidden; if (!s.hidden) $('#q' + e).focus(); }
  });
  ['A', 'B'].forEach((e) => { let t; $('#q' + e).addEventListener('input', (ev) => { clearTimeout(t); const q = ev.target.value.trim(); if (q.length < 3) { $('#res' + e).innerHTML = ''; return; }
    t = setTimeout(async () => { try { const j = await WX.getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&accept-language=nb,en`, 12000);
      $('#res' + e).innerHTML = j.map((r, i) => `<button data-i="${i}">${esc(r.display_name.split(',').slice(0, 2).join(','))}<small>${esc(r.display_name.split(',').slice(2).join(',').trim())}</small></button>`).join('') || '<button disabled>Ingen treff</button>';
      $$('#res' + e + ' button[data-i]').forEach((b) => b.onclick = () => { const r = j[+b.dataset.i]; st[e] = { lat: +r.lat, lon: +r.lon, name: r.display_name.split(',')[0] }; $('#search' + e).hidden = true; $('#q' + e).value = ''; $('#res' + e).innerHTML = ''; routeChanged(); }); }
    catch (err) { $('#res' + e).innerHTML = `<button disabled>${esc(err.message)}</button>`; } }, 500); }); });
  $('#addvia').onclick = () => (pick === 'via' ? setPick(null) : setPick('via', 'Trykk i kartet for å legge til et via-punkt'));
  $('#swap').onclick = () => { [st.A, st.B] = [st.B, st.A]; st.via.reverse(); routeChanged(); };
  $('#clearroute').onclick = () => { st.A = st.B = null; st.via = []; WXD = null; routeChanged(); };

  /* departure */
  const toLocal = (s) => { const d = new Date(s * 1000); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  function dep() { if (!st.dep) st.dep = Math.ceil(nowS() / 3600) * 3600; return st.dep; }
  $('#dep').addEventListener('change', (e) => { const d = new Date(e.target.value); if (!isNaN(d)) { st.dep = Math.floor(d.getTime() / 1000); renderPass(); save(); } });
  $('#depnow').onclick = () => { st.dep = Math.ceil(nowS() / 600) * 600; renderPass(); save(); };
  $('#speed').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0) { st.S.speed = v; renderPass(); save(); syncSettings(); } });

  /* ---------------- weather fetch ---------------- */
  $('#fetchwx').onclick = () => fetchRoute(true);
  async function fetchRoute(force) {
    if (SAMPLES.length < 2) { $('#fetchmsg').textContent = 'Velg A og B først.'; return; }
    const key = routeKey();
    if (!navigator.onLine) { $('#fetchmsg').textContent = WXD && WXD.key === key ? `Uten nett. Bruker varsel hentet ${fmtT(WXD.fetchedAt / 1000)}.` : 'Uten nett, og ingen lagret varsel for denne ruten.'; return; }
    if (!force && WXD && WXD.key === key && Date.now() - WXD.fetchedAt < 3 * 3600e3) return;
    const btn = $('#fetchwx'); btn.disabled = true; $('#fetchmsg').textContent = 'Henter varsler …';
    try {
      const d = await WX.fetchAll(SAMPLES, (i, n) => ($('#fetchmsg').textContent = `Henter varsler … ${i} av ${n}`)); d.key = key;
      if (!d.anyOk) { const why = Object.values(d.m).map((m) => m.err).filter(Boolean)[0]; $('#fetchmsg').textContent = `Fikk ikke hentet varsel: ${why}.`; return; }
      WXD = d; WX.kv.set('route', d);
      if (!(st.src === 'mean' || st.src === 'worst' || (d.m[st.src] && d.m[st.src].ok))) st.src = WX.MODELS.find((m) => d.m[m.id].ok).id;
      const failed = WX.MODELS.filter((m) => !d.m[m.id].ok).map((m) => m.s);
      $('#fetchmsg').textContent = `Hentet ${fmtT(d.fetchedAt / 1000)}.` + (failed.length ? ` Mangler: ${failed.join(', ')}.` : '') + (d.marine && !d.marine.ok ? ' Ingen bølgedata.' : '');
      renderAll();
    } finally { btn.disabled = false; updateTop(); }
  }

  /* ---------------- Passasje ---------------- */
  function renderPass() {
    const pts = routePts(), tot = G.total(pts), D = dep();
    ['A', 'B'].forEach((e) => { $('#name' + e).textContent = st[e] ? st[e].name : 'Ikke valgt'; $('#pos' + e).textContent = st[e] ? G.pos(st[e].lat, st[e].lon) : ''; });
    $('#vias').innerHTML = st.via.map((v, i) => `<div class="via">Via ${i + 1} <span>${G.pos(v.lat, v.lon)}</span><button data-i="${i}" aria-label="Fjern via-punkt">×</button></div>`).join('');
    $$('#vias button').forEach((b) => b.onclick = () => { st.via.splice(+b.dataset.i, 1); routeChanged(); });
    $('#dep').value = toLocal(D); $('#speed').value = st.S.speed;
    $('#sdist').textContent = tot ? `${tot < 100 ? num(tot) : Math.round(tot)} nm` : '–';
    $('#sdur').textContent = tot ? fmtDur(tot / st.S.speed) : '–';
    $('#arr').textContent = tot ? fmtT(D + (tot / st.S.speed) * 3600) : '–';
    $('#ssrc').textContent = WXD ? srcName(st.src) : '–';
    // cyclone seasons (works without a forecast)
    const hits = SAMPLES.length ? WX.seasonCheck(SAMPLES, D, st.S.speed) : [];
    const mrange = (m) => (m.length === 12 ? 'hele året' : `${MON[m[0] - 1]}–${MON[m[m.length - 1] - 1]}`);
    $('#season').innerHTML = hits.filter((h) => h.inSeason).map((h) => `<div class="card block warn"><h2>Syklonsesong${h.peak ? ' – toppsesong' : ''}</h2>
      <div>Ruten går gjennom <b>${esc(h.B.n)}</b> i ${[...h.months].map((m) => MON[m - 1]).join(' og ')}. Sesongen er ${mrange(h.B.m)}, med topp i ${h.B.peak.map((m) => MON[m - 1]).join(', ')}.</div>
      <div class="note">Følg varsler fra ${esc(h.B.src)}. Vurder å flytte passasjen utenfor sesongen eller ha en plan for nærmeste trygge havn.</div></div>`).join('')
      + (hits.some((h) => !h.inSeason) ? `<p class="note">Ruten går gjennom ${hits.filter((h) => !h.inSeason).map((h) => esc(h.B.n)).join(', ')}, men utenfor syklonsesongen.</p>` : '');
    const has = WXD && WXD.key === routeKey();
    $('#winsblock').hidden = $('#underveis').hidden = !has;
    if (!has) { $('#summary').innerHTML = SAMPLES.length ? `<p class="note">${navigator.onLine ? 'Trykk «Hent værvarsel for ruten» for å se vind, bølger og beste avreise.' : 'Uten nett. Hent varsel når du har forbindelse.'}</p>` : '<p class="note">Velg hvor du starter (A) og hvor du skal (B).</p>'; map.clearMarkers('w'); return; }
    const ev = WX.evalPassage(WXD, st.src, SAMPLES, D, st.S), hz = WX.horizon(WXD, st.src);
    const first = (f) => ev.ex.find((x) => x.flags.includes(f));
    const fl = [];
    if (first('wind')) { const x = first('wind'); fl.push(`Vind ${Math.round(x.w.ws)} kn ${fmtT(x.t)} ved ${G.pos(SAMPLES[x.k].lat, SAMPLES[x.k].lon)}`); }
    if (first('gust')) { const x = first('gust'); fl.push(`Kast ${Math.round(x.w.wg)} kn ${fmtT(x.t)}`); }
    if (first('wave')) { const x = first('wave'); fl.push(`Bølger ${num(x.w.wave)} m ${fmtT(x.t)}`); }
    if (ev.beat > 0.3 && st.S.avoidBeat) fl.push(`Kryss på ${Math.round(ev.beat * 100)} % av strekningen`);
    const cov = ev.coverage < 0.999 ? `<li>Varselet dekker ${Math.round(ev.coverage * 100)} % av passasjen (til ${fmtT(hz)}). Resten må vurderes underveis. Hent nytt varsel med jevne mellomrom.</li>` : '';
    $('#summary').innerHTML = `<div class="card sum ${ev.ex.length ? 'warn' : ''}">
      <span class="score" style="background:${col(ev.score)}">${ev.score ?? '–'}</span>
      <div><div class="t">${fmtT(D)} → ${fmtT(ev.arr)}</div><div class="d">${esc(WX.SOURCES.find((s) => s.id === st.src).n)} · ${ev.ex.length ? 'Over grensene dine' : 'Innenfor grensene dine'}</div></div>
      <div class="kv"><div><span>Maks vind</span><b>${Math.round(ev.maxWs)} kn</b></div><div><span>Maks kast</span><b>${Math.round(ev.maxWg)} kn</b></div><div><span>Maks bølger</span><b>${ev.maxWave ? num(ev.maxWave) + ' m' : '–'}</b></div></div>
      <ul class="flags">${fl.map((f) => `<li>${esc(f)}</li>`).join('') || (ev.coverage > 0 ? '<li class="okk">Ingen grenser overskredet der varselet dekker.</li>' : '')}${cov}</ul></div>`;
    // windows
    const W = WX.windows(WXD, st.src, SAMPLES, st.S, nowS());
    const tl = $('#tl'); tl.innerHTML = '';
    W.all.forEach((e) => { const i = document.createElement('i'); const s = e.score * Math.min(1, e.coverage + 0.1);
      i.style.height = Math.max(5, s) + '%'; i.style.background = col(e.score); i.style.opacity = e.coverage >= 0.9 ? 1 : 0.45; if (Math.abs(e.dep - D) < 5400) i.className = 'sel';
      i.title = `${fmtT(e.dep)}: ${e.score} (dekker ${Math.round(e.coverage * 100)} %)`; i.onclick = () => { st.dep = e.dep; renderPass(); renderVaer(); save(); }; tl.appendChild(i); });
    $('#tlx').innerHTML = W.all.length ? `<span>${fmtT(W.all[0].dep)}</span><span>${fmtT(W.all[W.all.length - 1].dep)}</span>` : '';
    $('#wins').innerHTML = W.pick.map((e, ix) => `<button class="win${Math.abs(e.dep - D) < 5400 ? ' sel' : ''}" data-d="${e.dep}"><span class="score sm" style="background:${col(e.score)}">${e.score}</span>
      <span class="t">${ix === 0 ? 'Best: ' : ''}${fmtT(e.dep)}</span><span class="d">Fram ${fmtT(e.arr)} · maks ${Math.round(e.maxWs)} kn, kast ${Math.round(e.maxWg)}${e.maxWave ? ', bølger ' + num(e.maxWave) + ' m' : ''}</span>
      <span class="d">${e.coverage < 0.9 ? `Varselet dekker ${Math.round(e.coverage * 100)} % av turen` : 'Varselet dekker hele turen'}</span></button>`).join('') || '<p class="note">Fant ingen avreise innenfor varselet.</p>';
    $$('#wins .win').forEach((b) => b.onclick = () => { st.dep = +b.dataset.d; renderPass(); renderVaer(); save(); });
    // point by point
    $('#legtab').innerHTML = `<thead><tr><th>Tid</th><th>Posisjon</th><th>Kurs</th><th>Vind</th><th>Kast</th><th>Seilvinkel</th><th>Bølger</th><th>Dønning</th><th>Strøm</th></tr></thead><tbody>` +
      ev.per.map((p) => p.w ? `<tr class="${p.flags.length ? 'flag' : ''}"><td>${fmtT(p.t)}</td><td>${G.pos(p.s.lat, p.s.lon)}</td><td>${p2(Math.round(p.s.brg)).padStart(3, '0')}°</td>
        <td>${Math.round(p.w.ws)} kn ${G.dir16(p.w.wd)}</td><td>${Math.round(p.w.wg)}</td><td>${sail(p.twa)}</td><td>${p.w.wave != null ? num(p.w.wave) + ' m' + (p.w.wper ? ' / ' + Math.round(p.w.wper) + ' s' : '') : '–'}</td>
        <td>${p.w.swell != null ? num(p.w.swell) + ' m ' + G.dir8(p.w.sdir) : '–'}</td><td>${p.w.cur != null ? num(p.w.cur) + ' kn ' + G.dir8(p.w.cdir) : '–'}</td></tr>`
        : `<tr><td>${fmtT(p.t)}</td><td>${G.pos(p.s.lat, p.s.lon)}</td><td colspan="7" style="color:var(--muted)">Utenfor varselet</td></tr>`).join('') + '</tbody>';
    drawWind(ev);
  }
  let lastEv = null, lastZ = null;
  function drawWind(ev) {
    lastEv = ev; lastZ = map.zoom; map.clearMarkers('w'); if (!ev || !(tab === 'pass' || tab === 'vaer')) return;
    const drawn = []; // keep arrows at least ~60 px apart on screen so they stay readable at any zoom
    ev.per.forEach((p, k) => { if (!p.w) return; const [x, y] = map.toPoint(p.s.lat, p.s.lon); if (drawn.some(([a, b]) => Math.hypot(a - x, b - y) < 60)) return; drawn.push([x, y]);
      map.setMarker('w' + k, p.s.lat, p.s.lon, `<div class="mk-wind">${arrow(p.w.wd, 44, wcol(p.w.ws), Math.round(p.w.ws))}</div>`); });
  }
  let redrawT; map.on('move', () => { if (lastEv && map.zoom !== lastZ) { clearTimeout(redrawT); redrawT = setTimeout(() => drawWind(lastEv), 150); } });

  /* ---------------- Vær (models) ---------------- */
  function renderVaer() {
    const ch = $('#srcchips'); ch.innerHTML = '';
    WX.SOURCES.forEach((s) => { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', st.src === s.id);
      const M = WXD && WXD.m[s.id], failed = M && !M.ok; b.disabled = !!failed || (!WXD && false); if (failed) b.title = M.err;
      b.innerHTML = (s.c ? `<i style="background:${s.c}"></i>` : '') + esc(s.s) + (failed ? ' <small>(mangler)</small>' : '');
      b.onclick = () => { st.src = s.id; save(); renderAll(); }; ch.appendChild(b); });
    const has = WXD && WXD.key === routeKey();
    if (!has) { $('#agree').innerHTML = '<div class="agree">Hent værvarsel for ruten under Passasje for å sammenligne modellene.</div>'; $('#cmpsvg').innerHTML = ''; $('#srctab').innerHTML = ''; $('#cmplegend').innerHTML = ''; $('#cmpnote').textContent = ''; return; }
    const D = dep(), etas = SAMPLES.map((s) => D + (s.cum / st.S.speed) * 3600);
    // disagreement along the passage at the planned departure
    const sp = SAMPLES.map((s, k) => WX.spread(WXD, k, etas[k])), C = []; let cur = null;
    sp.forEach((x, k) => { const bad = x && (x.max - x.min >= 8 || x.dd >= 45); if (bad) { if (!cur) { cur = { a: k, b: k, pk: k, pv: 0 }; C.push(cur); } cur.b = k; const v = x.max - x.min + x.dd / 8; if (v > cur.pv) { cur.pv = v; cur.pk = k; } } else cur = null; });
    const desc = (c) => { const x = sp[c.pk], ws = x.all.map((a) => a.w.ws).sort((a, b) => a - b), med = ws[Math.floor(ws.length / 2)];
      let o = x.all[0], ov = -1; x.all.forEach((a) => { const v = Math.abs(a.w.ws - med) + Math.abs(G.sdiff(x.md, a.w.wd)) / 8; if (v > ov) { ov = v; o = a; } });
      const rest = x.all.filter((a) => a !== o), rmin = Math.min(...rest.map((r) => r.w.ws)), rmax = Math.max(...rest.map((r) => r.w.ws));
      return `<li><b>${fmtT(etas[c.a])}${c.b > c.a ? '–' + fmtT(etas[c.b]) : ''}:</b> ${Math.round(x.min)}–${Math.round(x.max)} kn. ${esc(o.m.s)} skiller seg mest ut med ${Math.round(o.w.ws)} kn fra ${G.dir8(o.w.wd)}, de andre ${Math.round(rmin)}–${Math.round(rmax)} kn fra ${G.dir8(G.circMean(rest.map((r) => r.w.wd)))}.</li>`; };
    const nOk = WX.MODELS.filter((m) => WXD.m[m.id].ok).length;
    $('#agree').innerHTML = `<div class="agree">${nOk < 2 ? 'Bare én modell er tilgjengelig, så det er ingenting å sammenligne.' : C.length
      ? `<span class="st"><i style="background:var(--ok)"></i>Modellene er uenige på ${C.length} del${C.length > 1 ? 'er' : ''} av passasjen</span><ul>${C.slice(0, 4).map(desc).join('')}</ul><span class="note">Velg «Mest vind» for å planlegge forsiktig, og hent nytt varsel nærmere avreise.</span>`
      : '<span class="st"><i style="background:var(--good)"></i>Modellene er stort sett enige for denne avreisen</span>'}</div>`;
    drawCmp(etas, C);
    // table
    const rows = WX.SOURCES.filter((s) => s.id === 'mean' || s.id === 'worst' || WXD.m[s.id].ok).map((s) => {
      const e = WX.evalPassage(WXD, s.id, SAMPLES, D, st.S), w = WX.windows(WXD, s.id, SAMPLES, st.S, nowS()).pick[0], hz = WX.horizon(WXD, s.id);
      return `<tr class="click ${s.id === st.src ? 'sel' : ''}" data-id="${s.id}"><td><span class="pn">${s.c ? `<i style="background:${s.c}"></i>` : ''}${esc(s.s)}</span></td>
        <td><span class="score sm" style="background:${col(e.score)};width:30px;height:30px;font-size:12px;display:inline-grid">${e.score ?? '–'}</span></td><td>${Math.round(e.maxWs)} kn</td><td>${Math.round(e.maxWg)} kn</td>
        <td>${Math.round(e.coverage * 100)} %</td><td>${w ? fmtT(w.dep) : '–'}</td><td>${fmtT(hz)}</td></tr>`; });
    $('#srctab').innerHTML = `<thead><tr><th>Kilde</th><th>Score</th><th>Maks vind</th><th>Maks kast</th><th>Dekker</th><th>Beste avreise</th><th>Varsel til</th></tr></thead><tbody>${rows.join('')}</tbody>`;
    $$('#srctab tbody tr').forEach((r) => r.onclick = () => { st.src = r.dataset.id; save(); renderAll(); });
  }
  function drawCmp(etas, C) {
    const svg = $('#cmpsvg'), NS = 'http://www.w3.org/2000/svg'; svg.innerHTML = '';
    const W = 420, H = 190, l = 28, r = 8, t = 10, b = 22, D = etas[0], hmax = Math.max(1, (etas[etas.length - 1] - D) / 3600);
    const series = WX.MODELS.filter((m) => WXD.m[m.id].ok).map((m) => ({ m, v: SAMPLES.map((s, k) => { const w = WX.at(WXD, m.id, k, etas[k]); return w ? w.ws : null; }) }));
    const mx = Math.max(10, Math.ceil(Math.max(...series.flatMap((s) => s.v.filter((x) => x != null))) / 5) * 5);
    const X = (k) => l + ((etas[k] - D) / 3600 / hmax) * (W - l - r), Y = (v) => t + (1 - v / mx) * (H - t - b);
    const E = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
    C.forEach((c) => E('rect', { x: X(c.a), y: t, width: Math.max(3, X(c.b) - X(c.a)), height: H - t - b, fill: 'var(--ok)', opacity: 0.16 }));
    for (let v = 0; v <= mx; v += mx > 30 ? 10 : 5) { E('line', { x1: l, x2: W - r, y1: Y(v), y2: Y(v), stroke: 'var(--line)', 'stroke-width': v ? 0.6 : 1 }); E('text', { x: l - 4, y: Y(v) + 3, 'text-anchor': 'end' }).textContent = v; }
    E('line', { x1: l, x2: W - r, y1: Y(st.S.windMax), y2: Y(st.S.windMax), stroke: 'var(--bad)', 'stroke-width': 1, 'stroke-dasharray': '4 3' });
    E('text', { x: W - r, y: Y(st.S.windMax) - 3, 'text-anchor': 'end', style: 'fill:var(--bad)' }).textContent = `din grense ${st.S.windMax} kn`;
    const ticks = [6, 12, 24, 48, 72, 96, 168].find((c) => hmax / c <= 7) || 336; for (let h = 0; h <= hmax; h += ticks) { const x = l + (h / hmax) * (W - l - r); E('text', { x, y: H - 6, 'text-anchor': h ? 'middle' : 'start' }).textContent = h ? `+${h < 48 ? h + ' t' : Math.round(h / 24) + ' d'}` : 'avreise'; }
    const ord = [...series].sort((a, b) => (a.m.id === st.src) - (b.m.id === st.src));
    ord.forEach((s) => { let d = '', pen = false; s.v.forEach((v, k) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
      const on = s.m.id === st.src; E('path', { d, fill: 'none', stroke: 'var(--card)', 'stroke-width': on ? 5 : 3.5, 'stroke-linejoin': 'round' });
      E('path', { d, fill: 'none', stroke: s.m.c, 'stroke-width': on ? 3 : 1.75, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }); });
    if (st.src === 'mean' || st.src === 'worst') { let d = '', pen = false; SAMPLES.forEach((s, k) => { const w = WX.at(WXD, st.src, k, etas[k]); if (!w) { pen = false; return; } d += (pen ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(w.ws).toFixed(1); pen = true; });
      E('path', { d, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2.5, 'stroke-dasharray': '5 3' }); }
    $('#cmplegend').innerHTML = series.map((s) => `<span><i style="background:${s.m.c}"></i>${esc(s.m.s)}</span>`).join('') + (C.length ? '<span><i style="background:var(--ok);opacity:.45;height:8px"></i>Uenighet</span>' : '');
    $('#cmpnote').textContent = `Vinden der båten er til hver tid, med avreise ${fmtT(D)} og ${num(st.S.speed)} kn snittfart. Linjene stopper der modellens varsel slutter.`;
    const cross = E('line', { y1: t, y2: H - b, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0 }), hit = E('rect', { x: l, y: 0, width: W - l - r, height: H, fill: 'transparent' });
    const tip = $('#cmptip'), box = $('#cmpchart');
    const mv = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse());
      let k = 0, bd = 1e9; SAMPLES.forEach((s, i) => { const d = Math.abs(X(i) - q.x); if (d < bd) { bd = d; k = i; } });
      cross.setAttribute('x1', X(k)); cross.setAttribute('x2', X(k)); cross.setAttribute('opacity', 0.5); tip.hidden = false;
      tip.innerHTML = `<b>${fmtT(etas[k])}</b>` + series.map((s) => { const w = WX.at(WXD, s.m.id, k, etas[k]); return `<span><i style="background:${s.m.c}"></i>${esc(s.m.s).padEnd(5, ' ')} ${w ? `${String(Math.round(w.ws)).padStart(2, ' ')} kn ${G.dir8(w.wd)}` : '–'}</span>`; }).join('');
      const bw = box.clientWidth, px = (X(k) / W) * bw; tip.style.left = Math.min(bw - tip.offsetWidth, Math.max(0, px + (px > bw / 2 ? -tip.offsetWidth - 10 : 10))) + 'px'; };
    hit.addEventListener('pointermove', mv); hit.addEventListener('pointerdown', mv); hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('opacity', 0); });
  }

  /* ---------------- Ankring ---------------- */
  [1, 2, 3, 5, 7].forEach((d) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = d + (d === 1 ? ' døgn' : ' døgn'); b.dataset.d = d; b.onclick = () => { st.stay = d; save(); renderAnk(); }; $('#staychips').appendChild(b); });
  $('#ankB').onclick = () => { if (st.B) setAnk({ ...st.B }); else $('#ankplace').textContent = 'Velg et mål (B) under Passasje først.'; };
  $('#ankGps').onclick = () => { if (FIX) { const p = { lat: FIX.lat, lon: FIX.lon, name: 'Her jeg er' }; setAnk(p); revName(p.lat, p.lon).then((n) => { if (n && st.ank === p) { p.name = n; renderAnk(); } }); } else $('#ankplace').textContent = 'Venter på GPS-posisjon.'; };
  $('#ankMap').onclick = () => (pick === 'ank' ? setPick(null) : setPick('ank', 'Trykk i kartet der du vil ankre'));
  $('#depth').addEventListener('input', renderChain);
  async function setAnk(p) { st.ank = p; save(); ANKD = null; renderAnk(); await fetchAnk(); }
  async function fetchAnk() {
    if (!st.ank) return; const key = st.ank.lat.toFixed(3) + ',' + st.ank.lon.toFixed(3);
    if (!navigator.onLine) { const c = await WX.kv.get('ank'); if (c && c.key === key) ANKD = c; renderAnk(); return; }
    $('#ankout').innerHTML = '<p class="note">Henter varsel for stedet …</p>';
    const d = await WX.fetchAll([st.ank]); d.key = key; if (d.anyOk) { ANKD = d; WX.kv.set('ank', d); } else $('#ankout').innerHTML = `<p class="note">Fikk ikke hentet varsel: ${esc(Object.values(d.m)[0].err)}</p>`;
    renderAnk();
  }
  let ANKSUM = null;
  function renderAnk() {
    $$('#staychips .chip').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.d === st.stay));
    if (!st.ank) { $('#ankplace').textContent = 'Velg hvor du vil ankre.'; map.removeMarker('ank'); return; }
    $('#ankplace').innerHTML = `<b>${esc(st.ank.name)}</b><span>${G.pos(st.ank.lat, st.ank.lon)}</span>`;
    map.setMarker('ank', st.ank.lat, st.ank.lon, '<div class="mk-anchor">⚓</div>');
    if (!ANKD) { renderChain(); return; }
    const src = ANKD.m[st.src] && ANKD.m[st.src].ok ? st.src : st.src === 'mean' || st.src === 'worst' ? st.src : WX.MODELS.find((m) => ANKD.m[m.id].ok).id;
    const t0 = Math.floor(nowS() / 3600) * 3600, hrs = st.stay * 24, ser = [];
    for (let h = 0; h <= hrs; h++) { const w = WX.at(ANKD, src, 0, t0 + h * 3600); if (w) ser.push({ t: t0 + h * 3600, ...w }); }
    if (!ser.length) { $('#ankout').innerHTML = '<p class="note">Varselet dekker ikke denne perioden.</p>'; return; }
    const now = ser[0], strong = ser.reduce((m, a) => (a.wg > m.wg ? a : m));
    // directions that matter: hours with wind ≥ 10 kn, weighted by speed
    const sect = new Array(8).fill(0), sectMax = new Array(8).fill(0); ser.forEach((w) => { if (w.ws < 10) return; const i = Math.round(w.wd / 45) % 8; sect[i] += w.ws; sectMax[i] = Math.max(sectMax[i], w.ws); });
    const tot = sect.reduce((a, b) => a + b, 0), need = sect.map((v, i) => [i, v]).filter(([, v]) => tot && v / tot >= 0.08).map(([i]) => i), names = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
    const open = names.filter((_, i) => !need.includes(i) && !need.includes((i + 1) % 8) && !need.includes((i + 7) % 8));
    // shifts: smoothed direction changes ≥ 60° with some wind
    const shifts = []; let last = null;
    for (let i = 0; i < ser.length; i += 3) { const wins = ser.slice(i, i + 6); if (wins.length < 3) break; const d = G.circMean(wins.map((w) => w.wd)), s = wins.reduce((a, w) => a + w.ws, 0) / wins.length;
      if (s < 7) continue; if (!last) { last = { d, t: wins[0].t, s }; continue; } if (Math.abs(G.sdiff(last.d, d)) >= 60) { shifts.push({ from: last.d, to: d, t: wins[0].t, s0: last.s, s1: s }); last = { d, t: wins[0].t, s }; } }
    const sp = [0, 24, 48].filter((h) => h <= hrs).map((h) => WX.spread(ANKD, 0, t0 + h * 3600)).filter(Boolean);
    const dis = sp.some((x) => x.max - x.min >= 8 || x.dd >= 45);
    // rose
    const mxs = Math.max(1, ...sect), rose = names.map((n, i) => { const a = (i * 45 - 90) * Math.PI / 180, r = 18 + (sect[i] / mxs) * 52;
      const a0 = a - 0.33, a1 = a + 0.33, P = (ang, rr) => `${75 + Math.cos(ang) * rr},${75 + Math.sin(ang) * rr}`;
      return `<path d="M75,75 L${P(a0, r)} A${r},${r} 0 0 1 ${P(a1, r)}Z" fill="${sect[i] ? (sectMax[i] > st.S.windMax ? 'var(--bad)' : sectMax[i] > 18 ? 'var(--ok)' : 'var(--gps)') : 'transparent'}" opacity=".8"/>
        <text x="${75 + Math.cos(a) * 68}" y="${75 + Math.sin(a) * 68 + 4}" text-anchor="middle">${n}</text>`; }).join('');
    const strip = ser.filter((_, i) => i % 3 === 0).map((w) => { const d = new Date(w.t * 1000), hh = st.S.utc ? d.getUTCHours() : d.getHours();
      return `<div class="${hh < 3 ? 'day' : ''}" title="${fmtT(w.t)}: ${Math.round(w.ws)} kn fra ${G.dir16(w.wd)}"><span>${hh < 3 ? WD[st.S.utc ? d.getUTCDay() : d.getDay()] : p2(hh)}</span>${arrow(w.wd, 16, wcol(w.ws))}<b>${Math.round(w.ws)}</b></div>`; }).join('');
    ANKSUM = { src, ser, need: need.map((i) => names[i]), open, shifts, strong, dis, sp };
    $('#ankout').innerHTML = `<div class="card sum"><span class="score" style="background:${wcol(now.ws)}">${Math.round(now.ws)}</span>
        <div><div class="t">Nå ${Math.round(now.ws)} kn fra ${G.dir16(now.wd)}</div><div class="d">Kast ${Math.round(now.wg)} kn${now.wave != null ? ` · bølger ${num(now.wave)} m` : ''} · ${esc(srcName(src))}</div></div></div>
      <section class="block card"><h2>Vind de neste ${st.stay} døgnene</h2><div class="strip">${strip}</div></section>
      <section class="block card"><h2>Hvor trenger du le?</h2><div class="rose"><svg viewBox="0 0 150 150" role="img" aria-label="Vindrose for oppholdet">${rose}<circle cx="75" cy="75" r="3" fill="var(--ink)"/></svg>
        <div class="block"><div><b>Le for vind fra:</b> ${need.length ? need.map((i) => names[i]).join(', ') : 'lite vind over 10 kn'}</div>
        <div><b>Åpningen kan vende mot:</b> ${open.length ? open.join(', ') : 'ingen retning er trygg hele tiden – vurder havn eller flytt underveis'}</div>
        <div><b>Sterkest:</b> ${fmtT(strong.t)}, ${Math.round(strong.ws)} kn fra ${G.dir16(strong.wd)}, kast ${Math.round(strong.wg)} kn</div></div></div></section>
      <section class="block card ${shifts.length ? 'cav' : ''}"><h2>Snur vinden?</h2>${shifts.length ? `<ul class="flags">${shifts.map((s) => `<li>${fmtT(s.t)}: fra ${G.dir8(s.from)} til ${G.dir8(s.to)} (${Math.round(s.s0)} → ${Math.round(s.s1)} kn)</li>`).join('')}</ul><p class="note">Sjekk at ankringsplassen også har le for den nye retningen, eller planlegg å flytte før dreiningen.</p>` : `<div>Ingen store dreininger. Vinden holder seg rundt ${G.dir8(G.circMean(ser.map((w) => w.wd), ser.map((w) => w.ws)))}.</div>`}</section>
      ${dis ? '<p class="note">⚠ Modellene er uenige om vinden her. Se fanen Vær og velg «Mest vind» for et forsiktig anslag.</p>' : ''}`;
    renderChain();
  }
  function renderChain() {
    const depth = +$('#depth').value || 0, maxWs = ANKSUM ? Math.max(...ANKSUM.ser.map((w) => w.ws)) : null;
    if (!depth) { $('#chain').textContent = ''; return; }
    const ratio = maxWs == null ? 5 : maxWs < 15 ? 5 : maxWs < 25 ? 7 : 8, chain = Math.ceil((depth + 1.5) * ratio), swing = Math.round(Math.sqrt(Math.max(0, chain ** 2 - depth ** 2)) + st.S.len);
    $('#chain').textContent = `${chain} m kjetting (${ratio}:1)${maxWs != null ? ` for inntil ${Math.round(maxWs)} kn` : ''} · svairadius ca. ${swing} m${maxWs > 30 ? ' · vurder havn' : ''}`;
  }
  $('#findank').onclick = () => { if (!st.ank) return; st.nC = { lat: st.ank.lat, lon: st.ank.lon, name: st.ank.name }; nCat = 'ankring'; st.nSub = 'steder'; setTab('naer'); searchNear(); };

  /* AI via the user's own Anthropic key */
  async function claude(prompt, opts = {}) {
    const body = { model: 'claude-sonnet-5-5', max_tokens: opts.max || 900, messages: [{ role: 'user', content: prompt }] };
    if (opts.web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': st.S.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null); if (!r.ok) throw new Error((j && j.error && j.error.message) || 'HTTP ' + r.status);
    return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  }
  function renderAI(el, text) { el.innerHTML = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => /^#+\s|^\*\*.*\*\*$/.test(l) ? `<strong>${esc(l.replace(/[#*]/g, '').trim())}</strong>` : `<p>${linkify(l.replace(/^\s*[-*]\s+/, '• ').replace(/\*\*/g, ''))}</p>`).join(''); }
  $('#aibtn').onclick = async () => {
    const out = $('#aiout'); if (!st.S.key) { out.textContent = 'Legg inn en Anthropic API-nøkkel under ⚙ først.'; return; }
    if (!ANKSUM) { out.textContent = 'Velg et sted og hent varsel først.'; return; }
    if (!navigator.onLine) { out.textContent = 'AI-råd krever nett.'; return; }
    const lines = ANKSUM.ser.filter((_, i) => i % 3 === 0).map((w) => { const s = WX.spread(ANKD, 0, w.t); return `${fmtT(w.t)}: ${Math.round(w.ws)} kn fra ${Math.round(w.wd)}° (${G.dir16(w.wd)}), kast ${Math.round(w.wg)}${w.wave != null ? ', bølger ' + num(w.wave) + ' m' : ''}${s ? ` (modellene: ${Math.round(s.min)}–${Math.round(s.max)} kn)` : ''}`; });
    const anks = NEAR.filter((p) => p.cat === 'ankring' || p.cat === 'havn').slice(0, 12).map((p) => `- ${p.name || p.kind} (${p.kind}), ${num(G.dist(st.ank, p))} nm ${G.dir8(G.brg(st.ank, p))}`);
    const prompt = `Du er en erfaren langtursseiler. Gi praktiske råd om ankring på norsk bokmål med 24-timers tid, maks 220 ord, under overskriftene: Vurdering, Slik ankrer du, Når du bør flytte deg.
Sted: ${st.ank.name}, ${G.pos(st.ank.lat, st.ank.lon)}. Opphold: ${st.stay} døgn. Båt: ${st.S.len} m. Dybde: ${$('#depth').value} m.
Varsel (${srcName(ANKSUM.src)}) hver 3. time, med spenn mellom værmodeller i parentes:
${lines.join('\n')}
Beregnet: trenger le for ${ANKSUM.need.join(', ') || '–'}; åpning kan vende mot ${ANKSUM.open.join(', ') || 'ingen'}.
${anks.length ? 'Kjente havner/ankringsplasser i nærheten:\n' + anks.join('\n') : ''}
Vær tydelig på usikkerhet når modellene spriker. Ikke finn på steder.`;
    $('#aibtn').disabled = true; out.textContent = 'Tenker …';
    try { renderAI(out, await claude(prompt)); } catch (e) { out.textContent = 'Fikk ikke AI-råd: ' + e.message; } finally { $('#aibtn').disabled = false; }
  };

  /* ---------------- I nærheten ---------------- */
  [5, 10, 25, 50].forEach((r) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = r + ' km'; b.dataset.r = r; b.onclick = () => { st.nR = r; save(); renderNearChips(); if (st.nC) searchNear(); }; $('#radchips').appendChild(b); });
  function renderNearChips() { $$('#radchips .chip').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.r === st.nR)); }
  $('#nGps').onclick = () => { if (!FIX) { $('#nplace').textContent = 'Venter på GPS-posisjon.'; return; } st.nC = { lat: FIX.lat, lon: FIX.lon, name: 'Rundt meg' }; searchAllNear(); };
  $('#nMap').onclick = () => { st.nC = { lat: map.lat, lon: map.lon, name: 'Rundt kartets midte' }; searchAllNear(); };
  $$('.segb').forEach((b) => b.onclick = () => { st.nSub = b.dataset.sub; save(); renderNear(); if (st.nSub === 'akt' && st.nC && !ACT.length) searchAct(); });
  function searchAllNear() { save(); searchNear(); if (st.nSub === 'akt') searchAct(); else ACT = []; revName(st.nC.lat, st.nC.lon).then((n) => { if (n) { st.nC.place = n; save(); renderNear(); } }); }
  async function searchNear() {
    if (!st.nC) return; const c = st.nC; $('#nlist').innerHTML = '<p class="note">Søker …</p>'; renderNearHead();
    if (!navigator.onLine) { const cached = await WX.kv.get('near'); if (cached && G.dist(cached.c, c) < 1) { NEAR = cached.items; renderNear(); } else $('#nlist').innerHTML = '<p class="note">Uten nett, og ingen lagrede steder her.</p>'; return; }
    const langs = st.S.langs.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const [o, w] = await Promise.allSettled([Nearby.osm(c.lat, c.lon, st.nR), Nearby.wiki(c.lat, c.lon, langs)]);
    NEAR = [...(o.status === 'fulfilled' ? o.value : []), ...(w.status === 'fulfilled' ? w.value : [])];
    NEAR.forEach((p) => (p.d = G.dist(c, p))); NEAR.sort((a, b) => a.d - b.d);
    if (o.status === 'rejected') $('#nplace').insertAdjacentHTML('beforeend', `<span class="note"> OpenStreetMap svarte ikke: ${esc(o.reason.message)}</span>`);
    WX.kv.set('near', { c, items: NEAR }); renderNear();
  }
  async function searchAct() {
    if (!st.nC) return; const c = st.nC; $('#actlist').innerHTML = '<p class="note">Søker …</p>';
    try { ACT = await Nearby.activities(c.lat, c.lon, st.nR); ACT.forEach((p) => (p.d = G.dist(c, p))); ACT.sort((a, b) => a.d - b.d); }
    catch (e) { ACT = []; $('#actlist').innerHTML = `<p class="note">Fikk ikke hentet aktiviteter: ${esc(e.message)}</p>`; return; }
    renderNear();
  }
  function renderNearHead() { const c = st.nC; $('#nplace').innerHTML = c ? `<b>${esc(c.place || c.name)}</b><span>${G.pos(c.lat, c.lon)} · ${st.nR} km</span>` : 'Velg om du vil søke rundt deg eller rundt kartets midte.'; }
  function poiCard(p, catDefs) {
    const cd = catDefs[p.cat], open = openPoi === p.id, brg = st.nC ? G.dir8(G.brg(st.nC, p)) : '';
    let more = '';
    if (open) { const d = p.tags ? Nearby.details(p.tags) : [];
      more = `<div class="more">${d.length ? `<dl>${d.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Nettside' ? `<a href="${esc(/^https?:/.test(v) ? v : 'https://' + v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)}</dd>`).join('')}</dl>` : ''}
        ${p.src === 'Wikipedia' ? `<div class="wsum" id="ws-${esc(p.id)}">Henter fra Wikipedia …</div>` : ''}
        <div class="row"><button class="btn sm" data-a="show">Vis i kart</button><button class="btn sm" data-a="goal">Sett som mål</button>${p.cat === 'ankring' || p.cat === 'havn' ? '<button class="btn sm" data-a="ank">Ankring her</button>' : ''}</div>
        <span class="note">Kilde: ${esc(p.src)}</span></div>`; }
    return `<div class="poi${open ? ' open' : ''}" data-id="${esc(p.id)}" role="button" tabindex="0"><span class="dot" style="background:${cd.c}"></span>
      <span><span class="k">${esc(p.kind)}</span><br><span class="n">${esc(p.name || p.kind)}</span></span><span class="dist">${num(p.d)} nm<br>${brg}</span>${more}</div>`;
  }
  function bindPois(container, list) {
    $$(container + ' .poi').forEach((el) => {
      const p = list.find((x) => x.id === el.dataset.id);
      el.onclick = (e) => { const a = e.target.closest('[data-a]');
        if (a) { e.stopPropagation(); if (a.dataset.a === 'show') { map.setView(p.lat, p.lon, Math.max(map.zoom, 14)); highlight(p); }
          if (a.dataset.a === 'goal') { st.B = { lat: p.lat, lon: p.lon, name: p.name || p.kind }; routeChanged(); setTab('pass'); }
          if (a.dataset.a === 'ank') { setTab('ank'); setAnk({ lat: p.lat, lon: p.lon, name: p.name || p.kind }); } return; }
        if (e.target.closest('a')) return;
        openPoi = openPoi === p.id ? null : p.id; renderNear(); highlight(p);
        if (openPoi && p.src === 'Wikipedia') Nearby.summary(p).then((s) => { const w = document.getElementById('ws-' + p.id); if (w) w.innerHTML = `${esc(s.text)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">Les mer</a>` : ''}`; }).catch(() => { const w = document.getElementById('ws-' + p.id); if (w) w.textContent = 'Fikk ikke hentet sammendrag.'; }); };
    });
  }
  function highlight(p) { map.clearMarkers('sel'); map.setMarker('sel', p.lat, p.lon, '<div class="mk-poi sel" style="background:var(--accent)"></div>'); }
  function renderNear() {
    renderNearChips(); renderNearHead();
    $$('.segb').forEach((b) => b.setAttribute('aria-selected', b.dataset.sub === st.nSub)); $('#sub-steder').hidden = st.nSub !== 'steder'; $('#sub-akt').hidden = st.nSub !== 'akt';
    // places
    const cc = $('#catchips'); cc.innerHTML = '';
    [['alle', 'Alle'], ...Object.entries(Nearby.CATS).map(([k, v]) => [k, v.n])].forEach(([k, n]) => { const cnt = k === 'alle' ? NEAR.length : NEAR.filter((p) => p.cat === k).length;
      const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', nCat === k); b.innerHTML = (k !== 'alle' ? `<i style="background:${Nearby.CATS[k].c}"></i>` : '') + esc(n) + (st.nC ? ` <small>${cnt}</small>` : '');
      b.onclick = () => { nCat = k; renderNear(); }; cc.appendChild(b); });
    const list = NEAR.filter((p) => nCat === 'alle' || p.cat === nCat).slice(0, 80);
    $('#nlist').innerHTML = st.nC ? (list.map((p) => poiCard(p, Nearby.CATS)).join('') || '<p class="note">Ingen treff i denne kategorien. Prøv større radius.</p>') : '';
    bindPois('#nlist', list);
    // activities
    const ac = $('#actchips'); ac.innerHTML = '';
    [['alle', 'Alle'], ...Object.entries(Nearby.ACATS).map(([k, v]) => [k, v.n])].forEach(([k, n]) => { const cnt = k === 'alle' ? ACT.length : ACT.filter((p) => p.cat === k).length;
      const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', aCat === k); b.innerHTML = (k !== 'alle' ? `<i style="background:${Nearby.ACATS[k].c}"></i>` : '') + esc(n) + (ACT.length ? ` <small>${cnt}</small>` : '');
      b.onclick = () => { aCat = k; renderNear(); }; ac.appendChild(b); });
    const al = ACT.filter((p) => aCat === 'alle' || p.cat === aCat).slice(0, 60);
    $('#actlist').innerHTML = st.nC ? (al.map((p) => poiCard(p, Nearby.ACATS)).join('') || '<p class="note">Fant ingen utleie eller turoperatører i OpenStreetMap her. Prøv større radius eller lenkene under.</p>') : '<p class="note">Velg «Rundt meg» eller «Rundt kartets midte».</p>';
    bindPois('#actlist', al);
    renderEvents(); renderBookLinks(); drawPoiMarkers();
  }
  function drawPoiMarkers() {
    map.clearMarkers('poi'); if (tab !== 'naer') return;
    const L = st.nSub === 'akt' ? ACT.filter((p) => aCat === 'alle' || p.cat === aCat).map((p) => [p, Nearby.ACATS]) : NEAR.filter((p) => nCat === 'alle' || p.cat === nCat).map((p) => [p, Nearby.CATS]);
    L.slice(0, 150).forEach(([p, C]) => map.setMarker('poi' + p.id, p.lat, p.lon, `<div class="mk-poi" style="background:${C[p.cat].c}"></div>`, { cls: 'clickable', title: p.name || p.kind, onClick: () => { openPoi = p.id; renderNear(); const el = document.querySelector(`.poi[data-id="${CSS.escape(p.id)}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); } }));
  }
  /* events */
  const isoDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  function evDates() { const f = $('#evFrom').value, t = $('#evTo').value; return [f ? new Date(f + 'T00:00') : new Date(), t ? new Date(t + 'T23:59') : new Date(Date.now() + 7 * 864e5)]; }
  (function initDates() { const arr = st.B && SAMPLES.length ? new Date((dep() + (SAMPLES[SAMPLES.length - 1].cum / st.S.speed) * 3600) * 1000) : new Date();
    const start = arr > new Date() ? arr : new Date(); $('#evFrom').value = isoDate(start); $('#evTo').value = isoDate(new Date(start.getTime() + 7 * 864e5)); })();
  function renderEvents() {
    $('#evlist').innerHTML = EVENTS.length ? EVENTS.map((e) => `<div class="ev"><span class="dt">${esc(e.date ? e.date.slice(8, 10) + '.' + e.date.slice(5, 7) : '')}<br>${esc((e.time || '').slice(0, 5))}</span>
      <div><div class="n">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a>` : esc(e.name)}</div><div class="m">${esc([e.kind, e.genre, e.venue].filter(Boolean).join(' · '))}</div></div></div>`).join('')
      : `<p class="note">${st.nC ? 'Søk med AI eller hent fra Ticketmaster for å se arrangementer i perioden.' : 'Velg område først.'}</p>`;
    $('#evTm').hidden = !st.S.tm; $('#evAi').disabled = !st.nC;
  }
  $('#evTm').onclick = async () => {
    if (!st.nC || !st.S.tm) return; const [f, t] = evDates(); $('#evlist').innerHTML = '<p class="note">Henter …</p>';
    try { EVENTS = await Nearby.ticketmaster(st.S.tm, st.nC.lat, st.nC.lon, Math.max(25, st.nR), f, t); renderEvents(); if (!EVENTS.length) $('#evlist').innerHTML = '<p class="note">Ticketmaster har ingen arrangementer her i perioden.</p>'; }
    catch (e) { $('#evlist').innerHTML = `<p class="note">Ticketmaster svarte ikke: ${esc(e.message)}</p>`; }
  };
  $('#evAi').onclick = async () => {
    const out = $('#evai'); if (!st.nC) return;
    if (!st.S.key) { out.innerHTML = '<p class="note">Legg inn en Anthropic API-nøkkel under ⚙ for AI-søk. Du kan også bruke lenkene under.</p>'; return; }
    if (!navigator.onLine) { out.textContent = 'AI-søk krever nett.'; return; }
    const [f, t] = evDates(), place = st.nC.place || G.pos(st.nC.lat, st.nC.lon);
    const prompt = `Søk på nettet etter arrangementer, festivaler, markeder, konserter og lokale feiringer, og etter utflukter og turer man kan melde seg på (for eksempel båtturer, dykking, leie av vannscooter eller ATV, guidede turer) i og rundt ${place} (${st.nC.lat.toFixed(3)}, ${st.nC.lon.toFixed(3)}), innenfor ${st.nR} km, i perioden ${isoDate(f)} til ${isoDate(t)}.
Svar på norsk bokmål. Lag to overskrifter: Arrangementer og Turer og utleie. Under hver: én linje per treff med dato (DD.MM), navn, sted, én kort setning og lenke. Ta bare med ting du fant kilder for, og skriv «Fant ingen» hvis det ikke finnes noe.`;
    $('#evAi').disabled = true; out.textContent = 'Søker på nettet …';
    try { renderAI(out, await claude(prompt, { web: true, max: 1400 })); } catch (e) { out.textContent = 'AI-søket feilet: ' + e.message; } finally { $('#evAi').disabled = false; }
  };
  function renderBookLinks() {
    const c = st.nC; if (!c) { $('#booklinks').innerHTML = '<span class="note">Velg område først.</span>'; return; }
    const q = encodeURIComponent(c.place || `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`), [f, t] = evDates();
    const L = [['GetYourGuide', `https://www.getyourguide.com/s/?q=${q}&date_from=${isoDate(f)}&date_to=${isoDate(t)}`], ['Viator', `https://www.viator.com/searchResults/all?text=${q}`],
      ['Airbnb Opplevelser', `https://www.airbnb.com/s/${q}/experiences?checkin=${isoDate(f)}&checkout=${isoDate(t)}`], ['Google: arrangementer', `https://www.google.com/search?q=${q}+events+festival+${isoDate(f).slice(0, 7)}`],
      ['Google: vannscooter og ATV', `https://www.google.com/search?q=${q}+jet+ski+rental+OR+atv+rental+OR+quad+tour`], ['Tripadvisor', `https://www.tripadvisor.com/Search?q=${q}`]];
    $('#booklinks').innerHTML = L.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join('');
  }
  ['evFrom', 'evTo'].forEach((id) => $('#' + id).addEventListener('change', () => { EVENTS = []; renderNear(); }));

  /* ---------------- settings ---------------- */
  const SET = { sSpeed: 'speed', sLen: 'len', sWmin: 'windMin', sWmax: 'windMax', sGmax: 'gustMax', sHmax: 'waveMax', sBeat: 'avoidBeat', sUtc: 'utc', sWake: 'wake', sLangs: 'langs', sKey: 'key', sTm: 'tm' };
  function syncSettings() { for (const [id, k] of Object.entries(SET)) { const el = $('#' + id); if (el.type === 'checkbox') el.checked = !!st.S[k]; else el.value = st.S[k] ?? ''; } }
  for (const [id, k] of Object.entries(SET)) $('#' + id).addEventListener('change', (e) => {
    const el = e.target; st.S[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim(); save();
    if (k === 'wake') wake(); renderAll();
  });
  $('#clearcache').onclick = async () => { try { await caches.delete('seilplan-tiles'); $('#cacheinfo').textContent = 'Kartfliser slettet.'; } catch { $('#cacheinfo').textContent = 'Kunne ikke slette.'; } };

  /* ---------------- tabs ---------------- */
  function setTab(t) {
    tab = t; $$('.tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t)); $$('.view').forEach((v) => (v.hidden = v.id !== 'v-' + t));
    if (t !== 'naer') { map.clearMarkers('poi'); map.clearMarkers('sel'); }
    if (t === 'ank' && st.ank && !ANKD) fetchAnk();
    renderAll();
  }
  $$('.tab').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  function renderAll() { renderPass(); if (tab === 'vaer') renderVaer(); if (tab === 'ank') renderAnk(); if (tab === 'naer') renderNear(); updateTop(); }

  /* ---------------- start ---------------- */
  applyNight(); syncSettings(); wake();
  SAMPLES = routePts().length >= 2 ? G.samples(routePts(), 48) : [];
  drawRoute(); renderPass(); updateTop();
  if (!st.view && routePts().length >= 2) map.fit(routePts().map((p) => [p.lat, p.lon]), 60);
  WX.kv.get('route').then((d) => { if (d && d.key === routeKey()) { WXD = d; renderAll(); $('#fetchmsg').textContent = `Lagret varsel fra ${fmtT(d.fetchedAt / 1000)}.`; } scheduleFetch(); });
  WX.kv.get('ank').then((d) => { if (d && st.ank && d.key === st.ank.lat.toFixed(3) + ',' + st.ank.lon.toFixed(3)) { ANKD = d; if (tab === 'ank') renderAnk(); } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__seilplan = { st, map, get WXD() { return WXD; } };
})();
