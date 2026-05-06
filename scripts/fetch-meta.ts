import * as cheerio from 'cheerio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import generatedData from '../src/data/regma.generated.json';
import { MetaDatasetSchema, MetaOverlayDatasetSchema } from '../src/lib/schema';
import type { MetaDataset, MetaOverlayDataset, MetaSpecies } from '../src/lib/types';

const root = process.cwd();
const rawDir = path.join(root, 'src/data/raw/meta');
const overlayPath = path.join(root, 'src/data/regma-meta.generated.json');

const CHAMPIONS_META_URL = 'https://championsmeta.io/meta';
const CHAMPIONS_BASE_URL = 'https://championsmeta.io';
const THE_GAME_HAUS_STATS_URL =
  'https://thegamehaus.com/pokemon-champions/full-list-of-pokemon-champions-stats-regulation-m-a/2026/04/11/';

type OverlaySpecies = MetaOverlayDataset['species'][number];
type OverlayPair = MetaOverlayDataset['pairs'][number];

interface NameResolver {
  byKey: Map<string, string>;
  legalNames: Set<string>;
}

interface UsageRow {
  displayName: string;
  slug: string;
  usageRank?: number;
  usage?: number;
  winRate?: number;
  sampleSize?: number;
}

interface PercentItem {
  name: string;
  percent: number;
  href?: string;
}

const normalizeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '');

const cleanText = (value: string): string => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const titleCase = (value: string): string =>
  cleanText(value)
    .split(/([\s-]+)/)
    .map((part) => {
      if (/^[\s-]+$/.test(part)) return part;
      if (/^(hp|atk|def|spd)$/i.test(part)) return part.toUpperCase();
      if (/^(of|and|the)$/i.test(part)) return part.toLowerCase();
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join('');

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundRate = (value: number): number => Math.round(value * 10000) / 10000;

const toRate = (percent: string): number | undefined => {
  const value = Number(percent.replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? clamp(value / 100, 0, 1) : undefined;
};

const numeric = (value: string): number | undefined => {
  const cleaned = value.replace(/[^\d.]/g, '');
  if (!/\d/.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const uniqueStrings = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const cleaned = cleanText(value ?? '');
    const key = normalizeKey(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });
  return result;
};

const cacheFileFor = (name: string): string => path.join(rawDir, name.replace(/[^a-z0-9.-]+/gi, '-'));

const fetchCached = async (url: string, cacheName: string): Promise<string | null> => {
  const cacheFile = cacheFileFor(cacheName);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'pokemon-champions-advisor/0.3 public-meta-refresh'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    await writeFile(cacheFile, text);
    return text;
  } catch (error) {
    try {
      return await readFile(cacheFile, 'utf8');
    } catch {
      console.warn(`No fresh or cached response for ${url}: ${String(error)}`);
      return null;
    }
  }
};

const registerAlias = (resolver: NameResolver, alias: string, displayName: string, overwrite = true) => {
  if (!resolver.legalNames.has(displayName)) return;
  const key = normalizeKey(alias);
  if (!key || (!overwrite && resolver.byKey.has(key))) return;
  resolver.byKey.set(key, displayName);
};

const buildNameResolver = (dataset: MetaDataset): NameResolver => {
  const legalNames = new Set(dataset.species.map((species) => species.displayName));
  const resolver: NameResolver = { byKey: new Map(), legalNames };

  dataset.species.forEach((species) => {
    registerAlias(resolver, species.displayName, species.displayName);
    registerAlias(resolver, species.species, species.displayName);
    registerAlias(resolver, species.displayName.replace(/\s+\([^)]*\)/g, ''), species.displayName, false);
  });

  const aliases: Record<string, string> = {
    'Alolan Raichu': 'Raichu (Alolan Form)',
    'Raichu-Alola': 'Raichu (Alolan Form)',
    'Alolan Ninetales': 'Ninetales (Alolan Form)',
    'Alolan-Ninetales': 'Ninetales (Alolan Form)',
    'Hisuian Arcanine': 'Arcanine (Hisuian Form)',
    'Hisuian-Arcanine': 'Arcanine (Hisuian Form)',
    'Galarian Slowbro': 'Slowbro (Galarian Form)',
    'Galarian-Slowbro': 'Slowbro (Galarian Form)',
    'Galarian Slowking': 'Slowking (Galarian Form)',
    'Galarian-Slowking': 'Slowking (Galarian Form)',
    'Hisuian Typhlosion': 'Typhlosion (Hisuian Form)',
    'Hisuian-Typhlosion': 'Typhlosion (Hisuian Form)',
    'Hisuian Samurott': 'Samurott (Hisuian Form)',
    'Hisuian-Samurott': 'Samurott (Hisuian Form)',
    'Hisuian Zoroark': 'Zoroark (Hisuian Form)',
    'Hisuian-Zoroark': 'Zoroark (Hisuian Form)',
    'Galarian Stunfisk': 'Stunfisk (Galarian Form)',
    'Galarian-Stunfisk': 'Stunfisk (Galarian Form)',
    'Hisuian Goodra': 'Goodra (Hisuian Form)',
    'Hisuian-Goodra': 'Goodra (Hisuian Form)',
    'Hisuian Avalugg': 'Avalugg (Hisuian Form)',
    'Hisuian-Avalugg': 'Avalugg (Hisuian Form)',
    'Hisuian Decidueye': 'Decidueye (Hisuian Form)',
    'Hisuian-Decidueye': 'Decidueye (Hisuian Form)',
    'Wash Rotom': 'Rotom (Wash Rotom)',
    'Wash-Rotom': 'Rotom (Wash Rotom)',
    'Rotom Wash': 'Rotom (Wash Rotom)',
    'Heat Rotom': 'Rotom (Heat Rotom)',
    'Heat-Rotom': 'Rotom (Heat Rotom)',
    'Rotom Heat': 'Rotom (Heat Rotom)',
    'Frost Rotom': 'Rotom (Frost Rotom)',
    'Frost-Rotom': 'Rotom (Frost Rotom)',
    'Fan Rotom': 'Rotom (Fan Rotom)',
    'Fan-Rotom': 'Rotom (Fan Rotom)',
    'Mow Rotom': 'Rotom (Mow Rotom)',
    'Mow-Rotom': 'Rotom (Mow Rotom)',
    'Basculegion': 'Basculegion (Male)',
    'Basculegion Male': 'Basculegion (Male)',
    'Basculegion Female': 'Basculegion (Female)',
    'Meowstic Male': 'Meowstic (Male)',
    'Meowstic Female': 'Meowstic (Female)',
    'Aegislash Blade': 'Aegislash',
    'Aegislash (Blade)': 'Aegislash',
    'Aegislash Shield': 'Aegislash',
    'Aegislash (Shield)': 'Aegislash',
    'Eternal Floette': 'Floette',
    'Floette Eternal': 'Floette',
    'Eternal Flower Floette': 'Floette',
    'Eternal-Flower-Floette': 'Floette',
    'Kommo O': 'Kommo-o',
    'Kommo-O': 'Kommo-o',
    'Mr Rime': 'Mr. Rime',
    'Mr. Rime': 'Mr. Rime',
    'Mega Charizard-X': 'Mega Charizard X',
    'Mega Charizard-Y': 'Mega Charizard Y',
    'Mega Glimmora': 'Mega Glimmora'
  };

  Object.entries(aliases).forEach(([alias, displayName]) => registerAlias(resolver, alias, displayName));
  return resolver;
};

const resolveName = (rawName: string, resolver: NameResolver): string | undefined => {
  const cleaned = cleanText(decodeURIComponent(rawName).replace(/[|]/g, ' ').replace(/[_]+/g, ' '));
  const candidates = uniqueStrings([
    cleaned,
    cleaned.replace(/-/g, ' '),
    cleaned.replace(/\s+/g, '-'),
    titleCase(cleaned.replace(/-/g, ' '))
  ]);

  for (const candidate of candidates) {
    const direct = resolver.byKey.get(normalizeKey(candidate));
    if (direct) return direct;
  }

  const regional = cleaned.match(/^(Alolan|Galarian|Hisuian)[-\s]+(.+)$/i);
  if (regional) {
    const candidate = `${titleCase(regional[2])} (${titleCase(regional[1])} Form)`;
    const direct = resolver.byKey.get(normalizeKey(candidate));
    if (direct) return direct;
  }

  const rotom = cleaned.match(/^(Heat|Wash|Frost|Fan|Mow)[-\s]+Rotom$/i);
  if (rotom) {
    const candidate = `Rotom (${titleCase(rotom[1])} Rotom)`;
    const direct = resolver.byKey.get(normalizeKey(candidate));
    if (direct) return direct;
  }

  return undefined;
};

const parseUsageDashboard = (html: string, resolver: NameResolver) => {
  const $ = cheerio.load(html);
  const bodyText = cleanText($('body').text());
  const countMatch = bodyText.match(/Based on\s+([\d,]+)\s+teams\s+across\s+([\d,]+)\s+tournaments/i);
  const teamCount = countMatch ? Number(countMatch[1].replace(/,/g, '')) : undefined;
  const tournamentCount = countMatch ? Number(countMatch[2].replace(/,/g, '')) : undefined;

  const rows: UsageRow[] = [];
  $('tbody tr').each((_, row) => {
    const cells = $(row)
      .find('td')
      .map((__, cell) => cleanText($(cell).text()))
      .get();
    if (cells.length < 5) return;

    const displayName = resolveName(cells[1], resolver);
    const usageWinMatch = cells.slice(4).join(' ').match(/([\d.]+)%\s*([\d.]+)%\s*WR/i);
    const links = $(row)
      .find('a[href^="/pokemon/"]')
      .map((__, link) => cleanText($(link).attr('href') ?? '').replace(/^\/pokemon\//, '').replace(/\/$/, ''))
      .get();
    if (!displayName || !usageWinMatch || !links[0]) return;

    const usage = toRate(usageWinMatch[1]);
    const winRate = toRate(usageWinMatch[2]);
    rows.push({
      displayName,
      slug: links[0],
      usageRank: numeric(cells[0]),
      usage,
      winRate,
      sampleSize: usage && teamCount ? Math.round(usage * teamCount) : undefined
    });
  });

  return { rows, teamCount, tournamentCount };
};

const parsePercentItem = (rawText: string, href?: string): PercentItem | null => {
  const text = cleanText(rawText);
  const match = text.match(/^(.+?)([\d.]+)%$/);
  if (!match) return null;
  const percent = toRate(match[2]);
  if (percent === undefined) return null;
  return { name: cleanText(match[1]), percent, href };
};

const sectionItems = ($: cheerio.CheerioAPI, title: string): PercentItem[] => {
  const heading = $('h3')
    .filter((_, element) => normalizeKey($(element).text()) === normalizeKey(title))
    .first();
  if (!heading.length) return [];

  const items: PercentItem[] = [];
  heading.nextAll().each((_, element) => {
    const tagName = String((element as { tagName?: string }).tagName ?? '').toLowerCase();
    if (/^h[1-4]$/.test(tagName)) return false;
    $(element)
      .find('li')
      .each((__, item) => {
        const href = $(item).find('a[href^="/pokemon/"]').attr('href');
        const parsed = parsePercentItem($(item).text(), href);
        if (parsed) items.push(parsed);
      });
    return undefined;
  });

  return items;
};

const roleTagsFromPublicSet = (moves: string[], abilities: string[]): string[] => {
  const moveKeys = moves.map(normalizeKey);
  const abilityKeys = abilities.map(normalizeKey);
  const tags: string[] = [];

  if (moveKeys.includes('fakeout')) tags.push('fake-out', 'support');
  if (moveKeys.includes('tailwind')) tags.push('tailwind', 'speed-control', 'support');
  if (moveKeys.includes('trickroom')) tags.push('trick-room', 'speed-control', 'support');
  if (moveKeys.includes('wideguard')) tags.push('wide-guard', 'support');
  if (moveKeys.some((move) => ['followme', 'ragepowder'].includes(move))) tags.push('redirection', 'support');
  if (moveKeys.some((move) => ['icywind', 'electroweb', 'scaryface'].includes(move))) tags.push('speed-control');
  if (moveKeys.some((move) => ['mortalspin', 'toxicspikes', 'stealthrock', 'spikes'].includes(move))) tags.push('hazard');
  if (moveKeys.some((move) => ['rockslide', 'heatwave', 'muddywater', 'hypervoice', 'dazzlinggleam', 'eruption'].includes(move))) {
    tags.push('spread');
  }
  if (moveKeys.some((move) => ['suckerpunch', 'bulletpunch', 'iceshard', 'aquajet', 'extremespeed'].includes(move))) {
    tags.push('priority');
  }
  if (moveKeys.some((move) => ['partingshot', 'uturn', 'voltswitch', 'flipturn'].includes(move))) tags.push('pivot');
  if (abilityKeys.includes('intimidate')) tags.push('intimidate', 'pivot', 'support');
  if (abilityKeys.includes('prankster')) tags.push('support', 'speed-control');
  if (abilityKeys.includes('toxicdebris')) tags.push('hazard');

  return uniqueStrings(tags);
};

const parseSpeciesPage = async (
  row: UsageRow,
  resolver: NameResolver,
  teamCount?: number
): Promise<{ species: OverlaySpecies; pairs: OverlayPair[] }> => {
  const html = await fetchCached(`${CHAMPIONS_BASE_URL}/pokemon/${row.slug}`, `championsmeta-pokemon-${row.slug}.html`);
  const $ = cheerio.load(html ?? '');
  const bodyText = cleanText($('body').text());

  const summaryMatch = bodyText.match(/([\d.]+)%\s*Usage Rate.*?([\d.]+)%\s*Win Rate\s*([\d,]+)\s*of\s*([\d,]+)\s*teams/i);
  const rankMatch = bodyText.match(/#\s*(\d+)\s*Usage Rank/i);
  const leadMatch = bodyText.match(/([\d.]+)%\s*Lead Rate/i);
  const moves = sectionItems($, 'Moves').map((item) => item.name);
  const abilities = sectionItems($, 'Abilities').map((item) => item.name);
  const teammates = sectionItems($, 'Teammates');
  const usage = summaryMatch ? toRate(summaryMatch[1]) : row.usage;
  const winRate = summaryMatch ? toRate(summaryMatch[2]) : row.winRate;
  const sampleSize = summaryMatch ? Number(summaryMatch[3].replace(/,/g, '')) : row.sampleSize;
  const leadRate = leadMatch ? toRate(leadMatch[1]) : undefined;
  const roleTags = roleTagsFromPublicSet(moves, abilities);

  const pairs = teammates
    .map((teammate) => {
      const rawTeammateName = teammate.href?.replace(/^\/pokemon\//, '').replace(/\/$/, '') ?? teammate.name;
      const teammateName = resolveName(rawTeammateName, resolver) ?? resolveName(teammate.name, resolver);
      if (!teammateName || !usage) return null;
      const frequency = roundRate(clamp(usage * teammate.percent, 0, 1));
      const pair: OverlayPair = {
        members: [row.displayName, teammateName] as [string, string],
        frequency
      };
      if (teamCount) pair.sampleSize = Math.round(teamCount * frequency);
      return pair;
    })
    .filter((pair): pair is OverlayPair => pair !== null);

  return {
    species: {
      species: row.displayName,
      displayName: row.displayName,
      usage,
      usageRank: rankMatch ? Number(rankMatch[1]) : row.usageRank,
      winRate,
      sampleSize,
      leadRate,
      commonMoves: uniqueStrings(moves).slice(0, 8),
      abilities: uniqueStrings(abilities),
      roleTags
    },
    pairs
  };
};

const parseGameHausStats = async (resolver: NameResolver): Promise<Map<string, MetaSpecies['baseStats']>> => {
  const html = await fetchCached(THE_GAME_HAUS_STATS_URL, 'thegamehaus-regma-stats.html');
  const statsByName = new Map<string, MetaSpecies['baseStats']>();
  if (!html) return statsByName;

  const $ = cheerio.load(html);
  $('table tr').each((_, row) => {
    const cells = $(row)
      .find('td')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);
    if (cells.length < 8) return;

    const numericTail: number[] = [];
    let index = cells.length - 1;
    while (index >= 0) {
      const value = numeric(cells[index]);
      if (value === undefined) break;
      numericTail.unshift(value);
      index -= 1;
    }
    if (numericTail.length < 7) return;

    const rawName = cleanText(cells.slice(0, cells.length - numericTail.length).join(' '));
    const displayName = resolveName(rawName, resolver);
    if (!displayName) return;

    const [hp, attack, defense, specialAttack, specialDefense, speed, total] = numericTail;
    const resolvedName =
      rawName === 'Charizard' && total === 809 && resolver.legalNames.has('Mega Charizard Y')
        ? 'Mega Charizard Y'
        : resolveName(rawName, resolver);
    if (!resolvedName) return;

    statsByName.set(resolvedName, { hp, attack, defense, specialAttack, specialDefense, speed });
  });

  return statsByName;
};

const mergeOverlaySpecies = (first: OverlaySpecies, second: OverlaySpecies): OverlaySpecies => ({
  ...first,
  ...second,
  commonMoves: uniqueStrings([...(second.commonMoves ?? []), ...(first.commonMoves ?? [])]),
  abilities: uniqueStrings([...(first.abilities ?? []), ...(second.abilities ?? [])]),
  roleTags: uniqueStrings([...(first.roleTags ?? []), ...(second.roleTags ?? [])])
});

const mergePairs = (pairs: OverlayPair[]): OverlayPair[] => {
  const pairByKey = new Map<string, OverlayPair>();
  pairs.forEach((pair) => {
    const key = [normalizeKey(pair.members[0]), normalizeKey(pair.members[1])].sort().join('|');
    const existing = pairByKey.get(key);
    pairByKey.set(key, {
      members: pair.members,
      frequency: Math.max(existing?.frequency ?? 0, pair.frequency),
      winRate: pair.winRate ?? existing?.winRate,
      sampleSize: Math.max(existing?.sampleSize ?? 0, pair.sampleSize ?? 0) || existing?.sampleSize || pair.sampleSize
    });
  });
  return Array.from(pairByKey.values()).sort((first, second) => second.frequency - first.frequency);
};

const main = async () => {
  await mkdir(rawDir, { recursive: true });
  const baseDataset = MetaDatasetSchema.parse(generatedData);
  const resolver = buildNameResolver(baseDataset);
  const dashboardHtml = await fetchCached(CHAMPIONS_META_URL, 'championsmeta-meta.html');
  const usage = dashboardHtml ? parseUsageDashboard(dashboardHtml, resolver) : { rows: [], teamCount: undefined, tournamentCount: undefined };
  const statsByName = await parseGameHausStats(resolver);
  const speciesByName = new Map<string, OverlaySpecies>();
  const pairs: OverlayPair[] = [];

  usage.rows.forEach((row) => {
    speciesByName.set(row.displayName, {
      species: row.displayName,
      displayName: row.displayName,
      usage: row.usage,
      usageRank: row.usageRank,
      winRate: row.winRate,
      sampleSize: row.sampleSize
    });
  });

  for (const row of usage.rows.slice(0, 100)) {
    const parsed = await parseSpeciesPage(row, resolver, usage.teamCount);
    const existing = speciesByName.get(row.displayName);
    speciesByName.set(row.displayName, existing ? mergeOverlaySpecies(existing, parsed.species) : parsed.species);
    pairs.push(...parsed.pairs);
  }

  statsByName.forEach((baseStats, displayName) => {
    const existing = speciesByName.get(displayName);
    const species = existing ?? { species: displayName, displayName };
    speciesByName.set(displayName, { ...species, baseStats });
  });

  const overlay = MetaOverlayDatasetSchema.parse({
    format: 'Pokemon Champions Doubles Regulation M-A Public Meta Overlay',
    updatedAt: new Date().toISOString(),
    sourceNotes: [
      `Usage, win-rate, moves, abilities, and teammate data are parsed from ${CHAMPIONS_META_URL}.`,
      `Champions-specific visible stat tables are parsed from ${THE_GAME_HAUS_STATS_URL}.`,
      'All sources are public, non-authenticated pages; raw HTML responses are cached in src/data/raw/meta for reproducible refreshes.'
    ],
    teamCount: usage.teamCount,
    tournamentCount: usage.tournamentCount,
    species: Array.from(speciesByName.values()).sort((first, second) => (second.usage ?? 0) - (first.usage ?? 0)),
    pairs: mergePairs(pairs)
  });

  await writeFile(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
  console.log(
    `Wrote public meta overlay for ${overlay.species.length} species and ${overlay.pairs.length} pairs from ${
      overlay.teamCount ?? 0
    } teams.`
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
