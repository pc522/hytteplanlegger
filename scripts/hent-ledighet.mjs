// Henter ledighet for DNT-hytter fra hyttebestilling.dnt.no og skriver data/ledighet.json.
// Kjøres daglig av GitHub Actions. Skriver ingenting hvis for mye feiler, slik at forrige fil blir stående.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://hyttebestilling.dnt.no';
const UT = 'data/ledighet.json';
const cfg = JSON.parse(fs.readFileSync('config/omrader.json', 'utf8'));

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Fredag–søndag for de neste helgene. Er det fredag i dag, tas inneværende helg med. */
export function helger(antall, naa = new Date()) {
  const oslo = new Date(naa.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const d = new Date(oslo.getFullYear(), oslo.getMonth(), oslo.getDate());
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const ut = [];
  for (let i = 0; i < antall; i++) {
    const fra = new Date(d); fra.setDate(d.getDate() + 7 * i);
    const til = new Date(fra); til.setDate(fra.getDate() + 2);
    ut.push({ from: iso(fra), to: iso(til) });
  }
  return ut;
}

/** Fra svaret fra cabin-availability til én rad, eller null hvis ingen ledige senger. */
export function tilRad(hytte, data) {
  const arr = Array.isArray(data?.availability) ? data.availability : [];
  const free = arr.reduce((s, x) => s + (Number(x) || 0), 0);
  if (free <= 0) return null;
  const max = Number(data?.maxTotalUnitsThatCanBeAvailable);
  const total = Number.isFinite(max) && max >= free ? max : null;
  const grupper = (data?.priceGroups || [])
    .map((g) => ({ navn: g.name || '', verdi: Number(g.template?.price_value) }))
    .filter((g) => g.verdi > 0);
  const voksen = grupper.filter((g) => /voksen/i.test(g.navn) && /ikke.?medlem/i.test(g.navn));
  const valg = voksen.length ? voksen : grupper;
  const price = valg.length ? Math.round(Math.min(...valg.map((g) => g.verdi))) : null;
  return { id: 'c' + hytte.id, name: hytte.name, area: hytte.area, areaId: hytte.areaId, county: hytte.county, free, total, price };
}

const nettleser = await chromium.launch();
const ctx = await nettleser.newContext({ locale: 'nb-NO', timezoneId: 'Europe/Oslo' });
const side = await ctx.newPage();
const uke0 = helger(1)[0];
const startUrl = `${BASE}/kart?value=1223&type=area&fromDate=${uke0.from}&toDate=${uke0.to}&numberOfGuests=1&adults=1`;
let klar = false;
for (let forsok = 1; forsok <= 4 && !klar; forsok++) {
  try {
    const svar = await side.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log(`Forsøk ${forsok}: HTTP ${svar ? svar.status() : '?'}`);
    await side.waitForFunction(() => (window.__next_f || []).some((x) => x && typeof x[1] === 'string' && x[1].includes('"type":"cabin"')), null, { timeout: 90000 });
    klar = true;
  } catch (e) {
    const tittel = await side.title().catch(() => '?');
    const tekst = await side.evaluate(() => document.body.innerText.slice(0, 300).replace(/\s+/g, ' ')).catch(() => '?');
    console.log(`Forsøk ${forsok} feilet: ${e.message.split('\n')[0]} | tittel: "${tittel}" | side: "${tekst}"`);
    if (forsok < 4) await new Promise((r) => setTimeout(r, 20000 * forsok));
  }
}
if (!klar) { console.error('Fikk ikke hyttelisten fra portalen. Avbryter uten å skrive fil.'); process.exit(1); }

// Hele hyttelisten ligger innebygd i siden (Next.js-data).
const alle = await side.evaluate(() => {
  const all = (window.__next_f || []).map((x) => (x && x[1]) || '').join('');
  const ut = []; const sett = new Set(); let idx = 0;
  while ((idx = all.indexOf('{"label":"', idx)) >= 0) {
    let dybde = 0, j = idx, iStr = false;
    for (; j < all.length; j++) {
      const c = all[j];
      if (iStr) { if (c === '\\') j++; else if (c === '"') iStr = false; }
      else if (c === '"') iStr = true;
      else if (c === '{') dybde++;
      else if (c === '}') { dybde--; if (dybde === 0) break; }
    }
    try {
      const o = JSON.parse(all.slice(idx, j + 1));
      if (o.type === 'cabin' && !sett.has(o.value)) {
        sett.add(o.value);
        ut.push({ id: o.value, name: o.label, areas: (o.areas || []).map((a) => ({ id: a.id, name: a.name })), county: ((o.counties || [])[0] || {}).name || '' });
      }
    } catch (e) { /* hopp over */ }
    idx = j + 1;
  }
  return ut;
});
if (alle.length < 300) { console.error(`Fant bare ${alle.length} hytter i siden. Avbryter uten å skrive fil.`); process.exit(1); }

const fylkeSett = new Set(cfg.fylker);
const omradeRe = new RegExp(cfg.omradeRegex, 'i');
const navnRe = new RegExp(cfg.navnRegex, 'i');
const valgte = alle
  .filter((h) => fylkeSett.has(h.county) || h.areas.some((a) => omradeRe.test(a.name)) || navnRe.test(h.name))
  .map((h) => {
    const a = h.areas.find((x) => !/^papirkart/i.test(x.name) && !/^østlandet/i.test(x.name)) || h.areas[0] || {};
    return { id: h.id, name: h.name, area: a.name || h.county, areaId: a.id || null, county: h.county };
  });
console.log(`${alle.length} hytter i portalen, ${valgte.length} valgt.`);

const ukene = helger(cfg.antallHelger);
const uker = []; let kall = 0, feil = 0;
const ikkeBookbare = new Set();
let forsteUke = true;
for (const uke of ukene) {
  const aktive = valgte.filter((h) => !ikkeBookbare.has(h.id));
  const svar = await side.evaluate(async ({ hytter, fra, til }) => {
    const sov = (ms) => new Promise((res) => setTimeout(res, ms));
    const status = {};
    async function hent(h) {
      for (let forsok = 0; forsok < 3; forsok++) {
        try {
          const r = await fetch(`/api/booking/cabin-availability?cabinId=${h.id}&fromDate=${fra}&toDate=${til}`);
          status[r.status] = (status[r.status] || 0) + 1;
          if (r.ok) return { id: h.id, ok: true, data: (await r.json()).data || null };
          if (r.status === 404) break;
          const ventSek = Number(r.headers.get('retry-after'));
          await sov(ventSek > 0 ? Math.min(ventSek, 30) * 1000 : 1000 * 2 ** forsok);
        } catch (e) { status.nettfeil = (status.nettfeil || 0) + 1; await sov(1000 * 2 ** forsok); }
      }
      return { id: h.id, ok: false, data: null };
    }
    const ut = []; let neste = 0;
    async function jobb() { while (neste < hytter.length) { const h = hytter[neste++]; ut.push(await hent(h)); await sov(150); } }
    await Promise.all(Array.from({ length: 3 }, jobb));
    return { ut, status };
  }, { hytter: aktive, fra: uke.from, til: uke.to });
  console.log(`  statuskoder: ${JSON.stringify(svar.status)}`);
  const rader = [];
  if (forsteUke) {
    const ok = svar.ut.filter((x) => x.ok).length;
    svar.ut.filter((x) => !x.ok).forEach((x) => ikkeBookbare.add(x.id));
    console.log(`  første helg: ${ok} av ${aktive.length} hytter svarte, ${ikkeBookbare.size} hoppes over (ikke bookbare i portalen)`);
    if (ok < aktive.length * 0.4) { console.error('For få hytter svarte i første helg. Avbryter uten å skrive fil.'); process.exit(1); }
    svar.ut.forEach((x) => { if (!x.ok) x.hoppOver = true; });
    forsteUke = false;
  }
  for (const s of svar.ut) {
    if (s.hoppOver) continue;
    kall++;
    if (!s.ok) { feil++; continue; }
    const rad = tilRad(valgte.find((h) => h.id === s.id), s.data);
    if (rad) rader.push(rad);
  }
  rader.sort((a, b) => (a.county + a.area + a.name).localeCompare(b.county + b.area + b.name, 'nb'));
  uker.push({ from: uke.from, to: uke.to, rows: rader });
  console.log(`${uke.from}: ${rader.length} hytter med ledige senger`);
}
await nettleser.close();

if (kall === 0 || feil / kall > 0.15) { console.error(`For mange feil (${feil} av ${kall}). Avbryter uten å skrive fil.`); process.exit(1); }
if (uker.every((u) => u.rows.length === 0)) { console.error('Ingen ledighet funnet i noen helg. Avbryter uten å skrive fil.'); process.exit(1); }

const naa = new Date();
const lesbar = naa.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' kl.');
fs.writeFileSync(UT, JSON.stringify({ fetched: lesbar, hentet: naa.toISOString(), omrader: cfg.beskrivelse, kilde: 'hyttebestilling.dnt.no', hytter: valgte.map((h) => ({ id: 'c' + h.id, name: h.name, area: h.area, county: h.county, bookbar: !ikkeBookbare.has(h.id) })), weeks: uker }, null, 1) + '\n');
console.log(`Skrev ${UT}. ${kall} kall, ${feil} feil.`);
