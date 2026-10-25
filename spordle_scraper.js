/**
 * ASN Spordle scraper (Puppeteer) - NB U13 AAA Male
 * Output: spordle_games.json  { scrapedAt, source, leagues, games[], standings[], skaters[], goalies[] }
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
  fs.writeFileSync('spordle_games.json', JSON.stringify(merged, null, 2));
  console.log(`Wrote spordle_games.json: ${merged.games.length} games, ${merged.standings.length} standings, ${merged.skaters.length} skaters, ${merged.goalies.length} goalies`);
  if (!merged.games.length) process.exit(1);
})();
