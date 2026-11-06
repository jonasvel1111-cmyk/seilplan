/* Seilplan — places near you, worldwide: OpenStreetMap (Overpass) and Wikipedia. */
(function () {
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const CATS = {
    havn: { n: 'Havn og marina', c: 'var(--c-havn)' },
    ankring: { n: 'Ankring', c: 'var(--c-ank)' },
    drivstoff: { n: 'Drivstoff', c: 'var(--c-fuel)' },
    butikk: { n: 'Butikk', c: 'var(--c-shop)' },
    sev: { n: 'Severdighet', c: 'var(--c-sev)' },
    hist: { n: 'Historie', c: 'var(--c-hist)' },
  };
  function q(lat, lon, r) {
    const a = `(around:${r},${lat.toFixed(4)},${lon.toFixed(4)})`;
    return `[out:json][timeout:25];(
nwr${a}[leisure=marina];nwr${a}[harbour];nwr${a}["seamark:type"~"^(harbour|anchorage|anchor_berth|mooring)$"];
nwr${a}[amenity=fuel];nwr${a}[waterway=fuel];
nwr${a}[shop~"^(supermarket|convenience|chandler|boat|hardware|bakery|greengrocer)$"];
nwr${a}[tourism~"^(attraction|viewpoint|museum)$"];nwr${a}[historic~"^(castle|fort|monument|ruins|shipwreck|lighthouse|archaeological_site|memorial|battlefield|wreck)$"];
);out center tags 400;`;
  }
  const LABEL = { marina: 'Marina', harbour: 'Havn', anchorage: 'Ankringsplass', anchor_berth: 'Ankringsplass', mooring: 'Bøye/fortøyning', fuel: 'Drivstoff',
    supermarket: 'Dagligvare', convenience: 'Nærbutikk', chandler: 'Båtutstyr', boat: 'Båtbutikk', hardware: 'Jernvare', bakery: 'Bakeri', greengrocer: 'Frukt og grønt',
    attraction: 'Severdighet', viewpoint: 'Utsiktspunkt', museum: 'Museum', castle: 'Borg/slott', fort: 'Fort', monument: 'Monument', ruins: 'Ruin', shipwreck: 'Skipsvrak', wreck: 'Vrak',
    lighthouse: 'Fyr', archaeological_site: 'Fornminne', memorial: 'Minnesmerke', battlefield: 'Slagmark' };
  function classify(t) {
    const st = t['seamark:type'];
    if (st === 'anchorage' || st === 'anchor_berth') return ['ankring', LABEL[st]];
    if (t.leisure === 'marina' || t.harbour || st === 'harbour' || st === 'mooring') return ['havn', LABEL[t.leisure] || LABEL[st] || 'Havn'];
    if (t.waterway === 'fuel') return ['drivstoff', 'Båtdrivstoff'];
    if (t.amenity === 'fuel') return ['drivstoff', t['fuel:diesel'] === 'yes' ? 'Drivstoff (diesel)' : 'Drivstoff'];
    if (t.shop) return ['butikk', LABEL[t.shop] || 'Butikk'];
    if (t.historic) return ['hist', LABEL[t.historic] || 'Historisk sted'];
    if (t.tourism) return ['sev', LABEL[t.tourism] || 'Severdighet'];
    return null;
  }
  async function osm(lat, lon, rKm) {
    let last;
    for (const url of OVERPASS) {
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q(lat, lon, rKm * 1000)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        return j.elements.map((e) => { const t = e.tags || {}, c = classify(t); if (!c) return null; const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (la == null) return null;
          return { id: 'osm' + e.type[0] + e.id, cat: c[0], kind: c[1], lat: la, lon: lo, name: t.name || t['name:en'] || t['seamark:name'] || '', tags: t, src: 'OpenStreetMap' }; }).filter(Boolean);
      } catch (e) { last = e; }
    }
    throw new Error(last && last.name === 'AbortError' ? 'Tidsavbrudd' : last && last.message === 'Failed to fetch' ? 'Ingen forbindelse' : (last && last.message) || 'Feil');
  }
  async function wiki(lat, lon, langs) {
    const out = [];
    for (const lang of langs) {
      try {
        const j = await WX.getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat.toFixed(4)}%7C${lon.toFixed(4)}&gsradius=10000&gslimit=25&format=json&origin=*`, 15000);
        (j.query?.geosearch || []).forEach((g) => out.push({ id: `wp-${lang}-${g.pageid}`, cat: 'hist', kind: `Wikipedia (${lang})`, lat: g.lat, lon: g.lon, name: g.title, lang, src: 'Wikipedia' }));
      } catch {}
    }
    return out;
  }
  async function summary(p) {
    const j = await WX.getJSON(`https://${p.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.name.replace(/ /g, '_'))}`, 15000);
    return { text: j.extract || '', url: j.content_urls?.mobile?.page || j.content_urls?.desktop?.page };
  }
  /* useful details from OSM tags */
  function details(t) {
    const d = [];
    const ch = t['seamark:harbour:communication_channel'] || t['communication:vhf'] || t['vhf'] || t['seamark:communication:channel'];
    if (ch) d.push(['VHF', ch]);
    if (t.opening_hours) d.push(['Åpent', t.opening_hours]);
    const fuels = ['diesel', 'octane_95', 'octane_98', 'lpg'].filter((f) => t['fuel:' + f] === 'yes').map((f) => ({ diesel: 'Diesel', octane_95: 'Bensin 95', octane_98: 'Bensin 98', lpg: 'Gass' }[f]));
    if (fuels.length) d.push(['Drivstoff', fuels.join(', ')]);
    if (t.capacity) d.push(['Plasser', t.capacity]);
    if (t.depth || t['seamark:anchorage:depth']) d.push(['Dybde', (t.depth || t['seamark:anchorage:depth']) + ' m']);
    if (t.phone || t['contact:phone']) d.push(['Telefon', t.phone || t['contact:phone']]);
    if (t.website || t['contact:website']) d.push(['Nettside', t.website || t['contact:website']]);
    if (t.description) d.push(['Om', t.description]);
    return d;
  }
  /* ---- activities: rentals (jet ski, ATV, boats, bikes), tours and guides, experiences ---- */
  const ACATS = {
    utleie: { n: 'Utleie', c: 'var(--c-shop)' },
    turer: { n: 'Turer og guider', c: 'var(--c-havn)' },
    opplev: { n: 'Opplevelser', c: 'var(--c-sev)' },
  };
  function qa(lat, lon, r) {
    const a = `(around:${r},${lat.toFixed(4)},${lon.toFixed(4)})`;
    return `[out:json][timeout:25];(
nwr${a}[amenity~"^(boat_rental|dive_centre|bicycle_rental|car_rental|motorcycle_rental|kick-scooter_rental)$"];
nwr${a}[shop~"^(rental|atv|scuba_diving|travel_agency|surf|motorcycle_rental|water_sports)$"];
nwr${a}[rental];nwr${a}[office~"^(guide|travel_agent|tourism)$"];nwr${a}[tourism=information][information=office];
nwr${a}[sport~"surfing|kitesurfing|windsurfing|scuba_diving|canoe|kayak|sailing|wakeboarding"][~"^(amenity|shop|leisure|club)$"~"."];
nwr${a}[leisure~"^(water_park|horse_riding|adult_gaming_centre)$"];nwr${a}[tourism~"^(theme_park|zoo|aquarium)$"];
);out center tags 300;`;
  }
  function aclass(t) {
    const all = [t.rental, t.name, t.description, t['boat_rental'], t.sport].filter(Boolean).join(' ').toLowerCase();
    if (/jet.?ski|jetski|vannscooter|waverunner|seadoo|sea-doo|personal_watercraft/.test(all)) return ['utleie', 'Vannscooter-utleie'];
    if (t.shop === 'atv' || /\batv\b|quad|firehjul/.test(all)) return ['utleie', 'ATV-utleie (firehjuling)'];
    if (t.amenity === 'boat_rental') return ['utleie', 'Båtutleie'];
    if (t.amenity === 'bicycle_rental') return ['utleie', 'Sykkelutleie'];
    if (t.amenity === 'car_rental') return ['utleie', 'Bilutleie'];
    if (t.amenity === 'motorcycle_rental' || t.shop === 'motorcycle_rental') return ['utleie', 'Scooter og MC-utleie'];
    if (t.amenity === 'kick-scooter_rental') return ['utleie', 'Elsparkesykkel'];
    if (t.amenity === 'dive_centre' || t.shop === 'scuba_diving' || /scuba_diving/.test(all)) return ['turer', 'Dykkesenter'];
    if (/kitesurf|windsurf|surfing|wakeboard/.test(all) || t.shop === 'surf') return ['turer', 'Surf og kite'];
    if (/canoe|kayak/.test(all)) return ['turer', 'Kajakk og kano'];
    if (t.office === 'guide') return ['turer', 'Guide og turer'];
    if (t.office === 'travel_agent' || t.shop === 'travel_agency' || t.office === 'tourism') return ['turer', 'Turoperatør'];
    if (t.tourism === 'information') return ['turer', 'Turistinformasjon'];
    if (t.shop === 'rental' || t.rental) return ['utleie', 'Utleie'];
    if (t.leisure === 'water_park') return ['opplev', 'Badeland'];
    if (t.leisure === 'horse_riding') return ['opplev', 'Ridning'];
    if (t.tourism === 'theme_park') return ['opplev', 'Fornøyelsespark'];
    if (t.tourism === 'zoo') return ['opplev', 'Dyrepark'];
    if (t.tourism === 'aquarium') return ['opplev', 'Akvarium'];
    if (/sailing/.test(all)) return ['turer', 'Seiling'];
    return null;
  }
  async function overpass(query) {
    let last;
    for (const url of OVERPASS) {
      try { const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).elements; }
      catch (e) { last = e; }
    }
    throw new Error(last && last.name === 'AbortError' ? 'Tidsavbrudd' : last && last.message === 'Failed to fetch' ? 'Ingen forbindelse' : (last && last.message) || 'Feil');
  }
  async function activities(lat, lon, rKm) {
    const els = await overpass(qa(lat, lon, rKm * 1000));
    return els.map((e) => { const t = e.tags || {}, c = aclass(t); if (!c) return null; const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (la == null) return null;
      return { id: 'act' + e.type[0] + e.id, cat: c[0], kind: c[1], lat: la, lon: lo, name: t.name || t['name:en'] || '', tags: t, src: 'OpenStreetMap' }; }).filter(Boolean);
  }
  /* events from Ticketmaster (needs a free key from developer.ticketmaster.com) */
  async function ticketmaster(key, lat, lon, rKm, from, to) {
    const iso = (d) => new Date(d).toISOString().slice(0, 19) + 'Z';
    const j = await WX.getJSON(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(key)}&latlong=${lat.toFixed(4)},${lon.toFixed(4)}&radius=${Math.round(rKm)}&unit=km&startDateTime=${iso(from)}&endDateTime=${iso(to)}&size=60&sort=date,asc&locale=*`, 20000);
    return (j._embedded?.events || []).map((e) => { const v = e._embedded?.venues?.[0] || {};
      return { id: 'tm' + e.id, name: e.name, date: e.dates?.start?.localDate, time: e.dates?.start?.localTime, url: e.url, kind: e.classifications?.[0]?.segment?.name || 'Arrangement',
        genre: e.classifications?.[0]?.genre?.name, venue: [v.name, v.city?.name].filter(Boolean).join(', '), lat: v.location ? +v.location.latitude : null, lon: v.location ? +v.location.longitude : null }; });
  }
  window.Nearby = { CATS, osm, wiki, summary, details, ACATS, activities, ticketmaster };
})();
