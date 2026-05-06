import * as cheerio from 'cheerio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import generatedData from '../src/data/regma.generated.json';
import { MetaDatasetSchema, MetaOverlayDatasetSchema } from '../src/lib/schema';
import type { MetaDataset, MetaOverlayDataset, MetaSpecies, PublicTeam, PublicTeamSet } from '../src/lib/types';

const root = process.cwd();
const rawDir = path.join(root, 'src/data/raw/meta');
const overlayPath = path.join(root, 'src/data/regma-meta.generated.json');

const CHAMPIONS_META_URL = 'https://championsmeta.io/meta';
const CHAMPIONS_TEAMS_URL = 'https://championsmeta.io/teams';
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
    'Arcanine Hisui': 'Arcanine (Hisuian Form)',
    'Arcanine-Hisui': 'Arcanine (Hisuian Form)',
    'Galarian Slowbro': 'Slowbro (Galarian Form)',
    'Galarian-Slowbro': 'Slowbro (Galarian Form)',
    'Slowbro Galar': 'Slowbro (Galarian Form)',
    'Slowbro-Galar': 'Slowbro (Galarian Form)',
    'Galarian Slowking': 'Slowking (Galarian Form)',
    'Galarian-Slowking': 'Slowking (Galarian Form)',
    'Slowking Galar': 'Slowking (Galarian Form)',
    'Slowking-Galar': 'Slowking (Galarian Form)',
    'Hisuian Typhlosion': 'Typhlosion (Hisuian Form)',
    'Hisuian-Typhlosion': 'Typhlosion (Hisuian Form)',
    'Typhlosion Hisui': 'Typhlosion (Hisuian Form)',
    'Typhlosion-Hisui': 'Typhlosion (Hisuian Form)',
    'Hisuian Samurott': 'Samurott (Hisuian Form)',
    'Hisuian-Samurott': 'Samurott (Hisuian Form)',
    'Samurott Hisui': 'Samurott (Hisuian Form)',
    'Samurott-Hisui': 'Samurott (Hisuian Form)',
    'Hisuian Zoroark': 'Zoroark (Hisuian Form)',
    'Hisuian-Zoroark': 'Zoroark (Hisuian Form)',
    'Zoroark Hisui': 'Zoroark (Hisuian Form)',
    'Zoroark-Hisui': 'Zoroark (Hisuian Form)',
    'Galarian Stunfisk': 'Stunfisk (Galarian Form)',
    'Galarian-Stunfisk': 'Stunfisk (Galarian Form)',
    'Stunfisk Galar': 'Stunfisk (Galarian Form)',
    'Stunfisk-Galar': 'Stunfisk (Galarian Form)',
    'Hisuian Goodra': 'Goodra (Hisuian Form)',
    'Hisuian-Goodra': 'Goodra (Hisuian Form)',
    'Goodra Hisui': 'Goodra (Hisuian Form)',
    'Goodra-Hisui': 'Goodra (Hisuian Form)',
    'Hisuian Avalugg': 'Avalugg (Hisuian Form)',
    'Hisuian-Avalugg': 'Avalugg (Hisuian Form)',
    'Avalugg Hisui': 'Avalugg (Hisuian Form)',
    'Avalugg-Hisui': 'Avalugg (Hisuian Form)',
    'Hisuian Decidueye': 'Decidueye (Hisuian Form)',
    'Hisuian-Decidueye': 'Decidueye (Hisuian Form)',
    'Decidueye Hisui': 'Decidueye (Hisuian Form)',
    'Decidueye-Hisui': 'Decidueye (Hisuian Form)',
    'Raichu Alola': 'Raichu (Alolan Form)',
    'Ninetales Alola': 'Ninetales (Alolan Form)',
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

  const megaSuffix = cleaned.match(/^(.+?)[-\s]+mega(?:[-\s]+([xy]))?$/i);
  if (megaSuffix) {
    const candidate = `Mega ${titleCase(megaSuffix[1])}${megaSuffix[2] ? ` ${megaSuffix[2].toUpperCase()}` : ''}`;
    const direct = resolver.byKey.get(normalizeKey(candidate));
    if (direct) return direct;
  }

  const megaPrefix = cleaned.match(/^mega[-\s]+(.+?)(?:[-\s]+([xy]))?$/i);
  if (megaPrefix) {
    const candidate = `Mega ${titleCase(megaPrefix[1])}${megaPrefix[2] ? ` ${megaPrefix[2].toUpperCase()}` : ''}`;
    const direct = resolver.byKey.get(normalizeKey(candidate));
    if (direct) return direct;
  }

  return undefined;
};

const extractJsonObject = (text: string, startIndex: number): string | null => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }

  return null;
};

const memberKeyFor = (members: string[]): string =>
  members
    .map((member) => normalizeKey(member.replace(/^Mega\s+/, '')))
    .sort()
    .join('|');

const publicSetFromRaw = (rawSet: unknown, resolver: NameResolver): PublicTeamSet | null => {
  const set = rawSet as { pokemon?: unknown; item?: unknown; ability?: unknown; moves?: unknown };
  if (typeof set.pokemon !== 'string') return null;

  const species = resolveName(set.pokemon, resolver);
  if (!species) return null;

  const moves = Array.isArray(set.moves)
    ? set.moves.filter((move): move is string => typeof move === 'string').map(cleanText).filter(Boolean).slice(0, 4)
    : [];

  return {
    species,
    item: typeof set.item === 'string' ? cleanText(set.item) : undefined,
    ability: typeof set.ability === 'string' ? cleanText(set.ability) : undefined,
    moves
  };
};

const parseEmbeddedTeams = (html: string, resolver: NameResolver): PublicTeam[] => {
  const text = html.replace(/\\"/g, '"');
  const teams = new Map<string, PublicTeam>();
  const starts = Array.from(text.matchAll(/"team":\{/g), (match) => (match.index ?? 0) + '"team":'.length);

  starts.forEach((start) => {
    const json = extractJsonObject(text, start);
    if (!json) return;

    try {
      const rawTeam = JSON.parse(json) as {
        id?: unknown;
        placement?: unknown;
        pokemon?: unknown;
        teamSheet?: unknown;
        record?: unknown;
        archetypes?: unknown;
      };
      if (typeof rawTeam.id !== 'string' || !Array.isArray(rawTeam.pokemon)) return;

      const members = uniqueStrings(
        rawTeam.pokemon
          .filter((pokemon): pokemon is string => typeof pokemon === 'string')
          .map((pokemon) => resolveName(pokemon, resolver))
      );
      if (members.length < 4) return;

      const teamSheet = Array.isArray(rawTeam.teamSheet)
        ? rawTeam.teamSheet.map((set) => publicSetFromRaw(set, resolver)).filter((set): set is PublicTeamSet => Boolean(set))
        : undefined;
      const rank = typeof rawTeam.placement === 'number' ? rawTeam.placement : undefined;
      const archetypes = Array.isArray(rawTeam.archetypes)
        ? rawTeam.archetypes.filter((archetype): archetype is string => typeof archetype === 'string').map(titleCase)
        : [];
      const title = `Public team #${rank ?? teams.size + 1}`;

      teams.set(rawTeam.id, {
        id: rawTeam.id,
        title,
        source: 'tournament',
        rank,
        record: typeof rawTeam.record === 'string' ? rawTeam.record : undefined,
        archetypes: uniqueStrings([...archetypes, ...deriveArchetypes(title, members)]),
        members: members.slice(0, 6),
        teamSheet: teamSheet?.length ? teamSheet : undefined
      });
    } catch {
      // React flight chunks can contain unrelated object shapes; ignore parse misses.
    }
  });

  return Array.from(teams.values());
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

const roleTagsFromPublicSet = (moves: string[], abilities: string[], items: string[]): string[] => {
  const moveKeys = moves.map(normalizeKey);
  const abilityKeys = abilities.map(normalizeKey);
  const itemKeys = items.map(normalizeKey);
  const tags: string[] = [];

  if (moveKeys.includes('fakeout')) tags.push('fake-out', 'support');
  if (moveKeys.includes('tailwind')) tags.push('tailwind', 'speed-control', 'support');
  if (moveKeys.includes('trickroom')) tags.push('trick-room', 'speed-control', 'support');
  if (moveKeys.includes('wideguard')) tags.push('wide-guard', 'support');
  if (moveKeys.some((move) => ['followme', 'ragepowder'].includes(move))) tags.push('redirection', 'support');
  if (moveKeys.some((move) => ['icywind', 'electroweb', 'scaryface'].includes(move))) tags.push('speed-control');
  if (moveKeys.some((move) => ['mortalspin', 'toxicspikes', 'stealthrock', 'spikes'].includes(move))) tags.push('hazard');
  if (moveKeys.includes('perishsong')) tags.push('perish');
  if (moveKeys.some((move) => ['encore', 'disable', 'taunt'].includes(move))) tags.push('disruption');
  if (moveKeys.some((move) => ['rockslide', 'heatwave', 'muddywater', 'hypervoice', 'dazzlinggleam', 'eruption'].includes(move))) {
    tags.push('spread');
  }
  if (moveKeys.some((move) => ['suckerpunch', 'bulletpunch', 'iceshard', 'aquajet', 'extremespeed'].includes(move))) {
    tags.push('priority');
  }
  if (moveKeys.some((move) => ['partingshot', 'uturn', 'voltswitch', 'flipturn'].includes(move))) tags.push('pivot');
  if (moveKeys.some((move) => ['lastrespects', 'supremeoverlord'].includes(move))) tags.push('late-game');
  if (abilityKeys.includes('shadowtag')) tags.push('trap');
  if (abilityKeys.includes('intimidate')) tags.push('intimidate', 'pivot', 'support');
  if (abilityKeys.includes('prankster')) tags.push('support', 'speed-control');
  if (abilityKeys.includes('toxicdebris')) tags.push('hazard');
  if (itemKeys.some((item) => ['focussash', 'mentalherb', 'whiteherb'].includes(item))) tags.push('lead-pressure');

  return uniqueStrings(tags);
};

const deriveArchetypes = (title: string, members: string[]): string[] => {
  const text = normalizeKey(`${title} ${members.join(' ')}`);
  const archetypes: string[] = [];

  if (/(pelipper|politoed|archaludon|basculegion|rain)/.test(text)) archetypes.push('Rain');
  if (/(charizard|ninetales|venusaur|torkoal|typhlosion|sun|drought)/.test(text)) archetypes.push('Sun');
  if (/(tyranitar|excadrill|hippowdon|sand)/.test(text)) archetypes.push('Sand');
  if (/(alolanninetales|froslass|snow|abomasnow)/.test(text)) archetypes.push('Snow');
  if (/(whimsicott|talonflame|aerodactyl|tailwind)/.test(text)) archetypes.push('Tailwind');
  if (/(farigiraf|sinistcha|hatterene|aromatisse|slowbro|slowking|trickroom)/.test(text)) archetypes.push('Trick Room');
  if (/(glimmora|toxicspikes|hazard)/.test(text)) archetypes.push('Hazard');
  if ((/gengar/.test(text) && /politoed/.test(text)) || /(perishsong|shadowtag)/.test(text)) archetypes.push('Perish Trap');

  return uniqueStrings(archetypes);
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
  const items = sectionItems($, 'Items').map((item) => item.name);
  const abilities = sectionItems($, 'Abilities').map((item) => item.name);
  const teammates = sectionItems($, 'Teammates');
  const usage = summaryMatch ? toRate(summaryMatch[1]) : row.usage;
  const winRate = summaryMatch ? toRate(summaryMatch[2]) : row.winRate;
  const sampleSize = summaryMatch ? Number(summaryMatch[3].replace(/,/g, '')) : row.sampleSize;
  const leadRate = leadMatch ? toRate(leadMatch[1]) : undefined;
  const roleTags = roleTagsFromPublicSet(moves, abilities, items);

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
      commonItems: uniqueStrings(items).slice(0, 6),
      abilities: uniqueStrings(abilities),
      roleTags
    },
    pairs
  };
};

const parsePublicTeams = async (resolver: NameResolver): Promise<PublicTeam[]> => {
  const html = await fetchCached(CHAMPIONS_TEAMS_URL, 'championsmeta-teams.html');
  if (!html) return [];

  const $ = cheerio.load(html);
  const teams: PublicTeam[] = [];
  const seen = new Set<string>();
  const embeddedTeams = parseEmbeddedTeams(html, resolver);
  const embeddedById = new Map(embeddedTeams.map((team) => [team.id, team]));
  const embeddedByMembers = new Map(embeddedTeams.map((team) => [memberKeyFor(team.members), team]));

  $('*').each((_, element) => {
    const container = $(element);
    const images = container.find('img');
    const text = cleanText(container.text());
    if (images.length !== 6 || text.length === 0) return;

    const childTeamContainers = container.children().filter((__, child) => {
      const childElement = $(child);
      return childElement.find('img').length === 6 && cleanText(childElement.text()).length > 0;
    });
    if (childTeamContainers.length > 0) return;

    const members = uniqueStrings(
      images
        .map((__, image) => resolveName($(image).attr('alt') ?? '', resolver))
        .get()
    );
    if (members.length < 4) return;

    const teamLink = container.find('a[href^="/teams/"]').first();
    const href = teamLink.attr('href');
    const isCommunity = Boolean(href);
    const source: PublicTeam['source'] = isCommunity ? 'community' : 'tournament';
    const titleFromHeading = cleanText(container.find('h3').first().text());
    const rankRecordMatch = text.match(/^(\d)(\d{1,2}-\d+-\d+)/);
    const rank = isCommunity ? numeric(text.match(/#\s*(\d+)/)?.[1] ?? '') : rankRecordMatch ? Number(rankRecordMatch[1]) : undefined;
    const record = rankRecordMatch?.[2];

    let event: string | undefined;
    if (!isCommunity) {
      let eventContainer = container.parent();
      for (let index = 0; index < 5 && eventContainer.find('img').length < 30; index += 1) {
        eventContainer = eventContainer.parent();
      }
      event = cleanText(eventContainer.find('h3').first().text()) || undefined;
    }

    const title = isCommunity ? titleFromHeading || `Community team ${teams.length + 1}` : `${event ?? 'Tournament team'} #${rank ?? teams.length + 1}`;
    const id = href?.split('/').pop() ?? `tournament-${normalizeKey(event ?? 'event')}-${rank ?? teams.length + 1}-${teams.length + 1}`;
    const embedded = embeddedById.get(id) ?? embeddedByMembers.get(memberKeyFor(members));
    const key = `${source}:${id}:${members.map(normalizeKey).join('|')}`;
    if (seen.has(key)) return;
    seen.add(key);

    teams.push({
      id,
      title,
      source,
      event,
      rank,
      record: record ?? embedded?.record,
      archetypes: uniqueStrings([...(embedded?.archetypes ?? []), ...deriveArchetypes(`${title} ${text}`, members)]),
      members: members.slice(0, 6),
      teamSheet: embedded?.teamSheet
    });
  });

  const seenIds = new Set(teams.map((team) => team.id));
  const seenMemberKeys = new Set(teams.map((team) => memberKeyFor(team.members)));
  embeddedTeams.forEach((team) => {
    if (seenIds.has(team.id) || seenMemberKeys.has(memberKeyFor(team.members))) return;
    teams.push(team);
  });

  return teams;
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
  const publicTeams = await parsePublicTeams(resolver);
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
      `Public community and tournament team sheets are parsed from ${CHAMPIONS_TEAMS_URL}.`,
      `Champions-specific visible stat tables are parsed from ${THE_GAME_HAUS_STATS_URL}.`,
      'All sources are public, non-authenticated pages; raw HTML responses are cached in src/data/raw/meta for reproducible refreshes.'
    ],
    teamCount: usage.teamCount,
    tournamentCount: usage.tournamentCount,
    species: Array.from(speciesByName.values()).sort((first, second) => (second.usage ?? 0) - (first.usage ?? 0)),
    pairs: mergePairs(pairs),
    publicTeams
  });

  await writeFile(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
  console.log(
    `Wrote public meta overlay for ${overlay.species.length} species, ${overlay.pairs.length} pairs, and ${overlay.publicTeams?.length ?? 0} public teams from ${
      overlay.teamCount ?? 0
    } teams.`
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
