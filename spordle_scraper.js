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
  const base = `${L.org}/schedule-stats-standings/${L.categoryId}?categoryId=${L.categoryId}&scheduleId=${L.scheduleId}`;
  const meta = { league: L.short, leagueName: L.name, division: L.division, region: L.region };
  const out = { games: [], standings: [], skaters: [], goalies: [] };

  // Standings: # | TEAM | GP | W | RW | OTW | SOW | T | L | RL | OTL | SOL | PTS
  try {
    const all = await tableRows(page, base + '&tab=standings');
    const hdr = (all[0] || []).map(h => h.toUpperCase());
    const ix = k => hdr.indexOf(k);      // some leagues show extra columns (GF, GA, ...), so look columns up by name
    for (const r of all.slice(1)) {
      if (r.length < 13) continue;
      out.standings.push({ ...meta, team: r[ix('TEAM')], gp: n(r[ix('GP')]), w: n(r[ix('W')]), otw: n(r[ix('OTW')]), sow: n(r[ix('SOW')]),
        t: n(r[ix('T')]), l: n(r[ix('L')]), otl: n(r[ix('OTL')]), sol: n(r[ix('SOL')]),
        gf: ix('GF') >= 0 ? n(r[ix('GF')]) : 0, ga: ix('GA') >= 0 ? n(r[ix('GA')]) : 0, pts: n(r[ix('PTS')]) });
    }
    console.log('  standings', out.standings.length);
  } catch (e) { console.error('  standings failed:', e.message); }

  // Skaters: # | NAME | TEAM | GP | G | A | P | PIM
  try {
    const rows = (await tableRows(page, base + '&tab=playerstats')).slice(1);
    for (const r of rows) {
      if (r.length < 8) continue;
      out.skaters.push({ league: L.short, name: cleanName(r[1]), team: r[2], pos: '', number: '',
        gp: n(r[3]), g: n(r[4]), a: n(r[5]), pts: n(r[6]), ppg: 0, shg: 0, pim: n(r[7]) });
    }
    console.log('  skaters', out.skaters.length);
  } catch (e) { console.error('  skaters failed:', e.message); }

  // Goalies: # | NAME | TEAM | GP | W | L | T | OTL | SO | GAA
  try {
    const rows = (await tableRows(page, base + '&tab=goaliestats')).slice(1);
    for (const r of rows) {
      if (r.length < 10) continue;
      out.goalies.push({ league: L.short, name: cleanName(r[1]), team: r[2], gp: n(r[3]), w: n(r[4]),
        l: n(r[5]), so: n(r[8]), ga: 0, mins: 0, gaa: n(r[9]), svpct: 0, shots: 0, saves: 0 });
    }
    console.log('  goalies', out.goalies.length);
  } catch (e) { console.error('  goalies failed:', e.message); }

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
      out.games.push({ id: `${L.id}-${m.id}`, gameNumber: String(m.id), date: m.date,
        time: (m.startTime || '').slice(11, 16), venue: '', ...meta,
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

  await page.close();
  return out;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const merged = { scrapedAt: new Date().toISOString(), source: 'spordle', leagues: [], games: [], standings: [], skaters: [], goalies: [] };
  for (const L of LEAGUES) {
    console.log('Scraping', L.name);
    const r = await scrapeLeague(browser, L);
    merged.leagues.push(L.id);
    for (const k of ['games', 'standings', 'skaters', 'goalies']) merged[k].push(...r[k]);
  }
  await browser.close();
  merged.skaters.sort((a, b) => b.pts - a.pts || b.g - a.g);
  merged.goalies.sort((a, b) => a.gaa - b.gaa);
  fs.writeFileSync('spordle.json', JSON.stringify(merged, null, 2));
  console.log(`Wrote spordle.json: ${merged.games.length} games, ${merged.standings.length} standings, ${merged.skaters.length} skaters, ${merged.goalies.length} goalies`);
  if (!merged.standings.length && !merged.skaters.length) process.exit(1);
})();
