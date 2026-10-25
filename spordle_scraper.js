/**
 * ASN Spordle scraper (Puppeteer) - NB U13 AAA Male
 * Output: spordle.json  { scrapedAt, source, leagues, games[], standings[], skaters[], goalies[] }
 * Same field names as grayjay.json / ryna.json.
 *
 * Run:  npm i puppeteer   then   node spordle_scraper.js
 * Add more Spordle leagues by adding entries to LEAGUES.
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const LEAGUES = [{
  id: 'nb-u13-aaa', short: 'NBU13AAA', name: 'NB U13 AAA Hockey League',
  division: 'U13 Male', region: 'NB',
  org: 'https://page.spordle.com/new-brunswick-aaa-hockey-league',
  categoryId: 'ba267b3e-9734-478c-a9e2-4890895cfc46', scheduleId: '199439',
}, {
  id: 'nb-female-u13-aaa', short: 'NBFU13AAA', name: 'NB Female U13 AAA Hockey League',
  division: 'U13 Female', region: 'NB',
  org: 'https://page.spordle.com/nbfaaal',
  categoryId: '5c22f127-48db-4620-b98a-e545bd664239', scheduleId: '200367',
}, {
  id: 'nb-female-u15-aaa', short: 'NBFU15AAA', name: 'NB Female U15 AAA Hockey League',
  division: 'U15 Female', region: 'NB',
  org: 'https://page.spordle.com/nbfaaal',
  categoryId: '381ccc08-8a5e-4634-9c41-a0d915268fed', scheduleId: '200366',
}, {
  id: 'pei-u15-aaa', short: 'PEIU15AAA', name: 'PEI U15 AAA Hockey League',
  division: 'U15 Male', region: 'PEI',
  org: 'https://page.spordle.com/pei-hockey-league',
  categoryId: '0b7dd40b-e3bf-4b03-8a2a-9c7060714a64', scheduleId: '201175',
}, {
  id: 'pei-u13-aaa', short: 'PEIU13AAA', name: 'PEI U13 AAA Hockey League',
  division: 'U13 Male', region: 'PEI',
  org: 'https://page.spordle.com/pei-hockey-league',
  categoryId: 'ba267b3e-9734-478c-a9e2-4890895cfc46', scheduleId: '201769',
}];

const MON = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};

// Spordle start times are UTC ("...T21:30:00.000Z"); the league pages show Atlantic time, so convert.
function atlanticParts(iso, fallbackDate) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return { date: fallbackDate, time: '' };
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Halifax', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

async function tableRows(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  for (let i = 0; i < 12 && /security checkpoint/i.test(await page.title()); i++) await sleep(2000);
  if (/security checkpoint/i.test(await page.title())) throw new Error('Blocked by Vercel security checkpoint');
  await page.waitForSelector('table tr td', { timeout: 20000 });
  await sleep(1000);
  return page.evaluate(() => [...document.querySelectorAll('table')][0]
    ? [...document.querySelector('table').querySelectorAll('tr')].map(r => [...r.children].map(c => c.innerText.trim().replace(/\s+/g, ' ')))
    : []);
}
// Spordle shows names as "H HUGO GAGNON" (initial + full name): drop the leading initial.
const cleanName = s => s.replace(/^\p{Lu}\s+(?=\S+\s+\S)/u, '').trim();

async function scrapeLeague(browser, L) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  // Spordle's own page code fetches stats with its own session headers. We note those headers (inside the page) so the
  // page can fetch other leagues' stats the same way. Nothing leaves the page.
  await page.evaluateOnNewDocument(() => {
    window.__sp = {};
    const so = XMLHttpRequest.prototype.setRequestHeader, op = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return op.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (/pub-api\.play\.spordle/.test(this.__u || '')) window.__sp[k] = v; return so.apply(this, arguments); };
    const of = window.fetch;
    window.fetch = function (i, o) { try { const u = (i && i.url) || String(i); const H = (o && o.headers) || (i && i.headers);
      if (/pub-api\.play\.spordle/.test(u) && H) { if (H.forEach && !Array.isArray(H)) H.forEach((v, k) => window.__sp[k] = v); else Object.assign(window.__sp, H); } } catch (e) {} return of.apply(this, arguments); };
  });
  const base = `${L.org}/schedule-stats-standings/${L.categoryId}?categoryId=${L.categoryId}&scheduleId=${L.scheduleId}`;
  const meta = { league: L.short, leagueName: L.name, division: L.division, region: L.region };
  const out = { games: [], standings: [], skaters: [], goalies: [] };

  // Games: the league home page scoreboard (upcoming from page data, finals from the cards)
  try {
    await page.goto(L.org, { waitUntil: 'networkidle2', timeout: 60000 });
    if (/security checkpoint/i.test(await page.title())) throw new Error('Blocked by Vercel security checkpoint');
    const data = await page.evaluate(() => ({
      matches: (window.__NEXT_DATA__ && window.__NEXT_DATA__.props.pageProps.scoreboardMatches) || [],
      text: document.body.innerText,
    }));
    const year = new Date().getFullYear();
    // Upcoming / scheduled
    for (const m of data.matches) {
      if (m.scheduleId != L.scheduleId) continue;
      const hs = (m.teamStats || []).find(t => t.teamId === m.homeTeamId);
      const as = (m.teamStats || []).find(t => t.teamId === m.awayTeamId);
      const scored = hs && as && hs.goals != null;
      const local = atlanticParts(m.startTime, m.date);
      out.games.push({ id: `${L.id}-${m.id}`, gameNumber: String(m.id), date: local.date,
        time: local.time, venue: '', ...meta,
        awayTeam: m.awayTeam.shortName, homeTeam: m.homeTeam.shortName,
        awayScore: scored ? as.goals : null, homeScore: scored ? hs.goals : null,
        status: scored ? 'final' : 'scheduled' });
    }
    // Finals shown as cards:  DAY \n 10 \n OCT \n FINAL \n U13 AAA \n AWAY \n n \n HOME \n n
    const re = /\n(\d{1,2})\s*\n([A-Z]{3})\s*\nFINAL\s*\n([^\n]*U1\d[^\n]*)\n+([^\n]+)\n+(\d+)\n+([^\n]+)\n+(\d+)/g;
    let m;
    while ((m = re.exec(data.text))) {
      const date = `${year}-${String(MON[m[2]] || 0).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      out.games.push({ id: `${L.id}-${date}-${m[4]}-${m[6]}`.replace(/\s+/g, '_'), gameNumber: '', date,
        time: '', venue: '', ...meta, awayTeam: m[4].trim(), homeTeam: m[6].trim(),
        awayScore: +m[5], homeScore: +m[7], status: 'final' });
    }
    console.log('  games', out.games.length);
  } catch (e) { console.error('  games failed:', e.message); }


  // Standings / skaters / goalies: asked from inside Spordle's own home page (the stats pages are behind the security check)
  try {
    if (!(await page.evaluate(() => Object.keys(window.__sp || {}).length))) { await sleep(5000); }
    const API = 'https://pub-api.play.spordle.com/api/sp/schedules/' + L.scheduleId;
    const raw = await page.evaluate(async (API) => {
      const H = Object.assign({}, window.__sp || {});
      if (!H.Authorization && !H.authorization) return { error: 'page did not expose its session' };
      const get = async (path, f) => { const r = await fetch(API + path + '?filter=' + encodeURIComponent(JSON.stringify(f)), { headers: H });
        return r.ok ? r.json() : { __err: r.status }; };
      return {
        team: await get('/teamStats', { where: { team: { name: { neq: 'TBA' } } }, include: ['team', 'group'] }),
        skater: await get('/skaterStats', { include: ['participant', 'team'], order: 'ranking ASC' }),
        goalie: await get('/goalieStats', { include: ['participant', 'team'], order: 'ranking ASC' }),
      };
    }, API);
    if (raw.error) throw new Error(raw.error);
    const nm = r => (r.participant && (r.participant.fullName || `${r.participant.firstName || ''} ${r.participant.lastName || ''}`.trim())) || '';
    const tm = r => (r.team && (r.team.shortName || r.team.name)) || '';
    if (Array.isArray(raw.team)) {
      raw.team.sort((x, y) => (n(x.ranking) || 999) - (n(y.ranking) || 999));
      for (const r of raw.team) out.standings.push({ ...meta, team: tm(r), gp: n(r.gamesPlayed), w: n(r.wins), otw: n(r.otw), sow: n(r.sow),
        t: n(r.ties), l: n(r.losses), otl: n(r.otl), sol: n(r.sol), gf: n(r.goalFor), ga: n(r.goalAgainst), pts: n(r.points) });
    } else console.error('  standings failed: HTTP', raw.team.__err);
    if (Array.isArray(raw.skater)) {
      for (const r of raw.skater) out.skaters.push({ league: L.short, name: nm(r), team: tm(r), pos: Array.isArray(r.positions) ? r.positions.join('/') : '',
        number: String(r.number || ''), gp: n(r.gamesPlayed), g: n(r.goals), a: n(r.assists), pts: n(r.points), ppg: n(r.powerplayGoals), shg: n(r.shorthandedGoals), pim: n(r.pim) });
    } else console.error('  skaters failed: HTTP', raw.skater.__err);
    if (Array.isArray(raw.goalie)) {
      for (const r of raw.goalie) { const shots = n(r.shots), ga = n(r.goalAgainst); if (n(r.gamesPlayed) < 1) continue;
        out.goalies.push({ league: L.short, name: nm(r), team: tm(r), gp: n(r.gamesPlayed), w: n(r.wins), l: n(r.losses), so: n(r.shutouts),
          ga, mins: n(r.minutesPlayed), gaa: n(r.gaa), svpct: n(r.savePercentage), shots, saves: shots > 0 ? Math.max(0, shots - ga) : 0 }); }
    } else console.error('  goalies failed: HTTP', raw.goalie.__err);
    console.log('  standings', out.standings.length, 'skaters', out.skaters.length, 'goalies', out.goalies.length);
  } catch (e) { console.error('  stats failed:', e.message); }

  await page.close();
  return out;
}

const LIVE_URL = 'https://atlanticsportsnetwork.ca/asn/data/spordle.json';
(async () => {
  // Last good copy on the site: used for any league/table that could not be read this time (e.g. security checkpoint)
  let prev = null;
  try { const r = await fetch(LIVE_URL, { headers: { 'Cache-Control': 'no-cache' } }); if (r.ok) prev = await r.json(); } catch (e) { console.log('(no previous file)', e.message); }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const merged = { scrapedAt: new Date().toISOString(), source: 'spordle', leagues: [], games: [], standings: [], skaters: [], goalies: [] };
  let fresh = 0;
  for (const L of LEAGUES) {
    console.log('Scraping', L.name);
    const r = await scrapeLeague(browser, L);
    merged.leagues.push(L.id);
    for (const k of ['games', 'standings', 'skaters', 'goalies']) {
      let rows = r[k];
      if (!rows.length && prev && Array.isArray(prev[k])) {
        rows = prev[k].filter(x => (k === 'games' ? x.league : x.league) === L.short);
        if (rows.length) console.log(`  kept previous ${k} (${rows.length})`);
      } else if (rows.length) fresh++;
      merged[k].push(...rows);
    }
  }
  await browser.close();
  merged.skaters.sort((a, b) => b.pts - a.pts || b.g - a.g);
  merged.goalies.sort((a, b) => a.gaa - b.gaa);
  console.log(`Result: ${merged.games.length} games, ${merged.standings.length} standings, ${merged.skaters.length} skaters, ${merged.goalies.length} goalies (${fresh} fresh tables)`);
  if (!fresh) { console.error('Nothing fresh was read - not uploading'); process.exit(1); }
  fs.writeFileSync('spordle.json', JSON.stringify(merged, null, 2));
})();
