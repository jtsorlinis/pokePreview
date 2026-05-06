import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { MetaDatasetSchema } from '../src/lib/schema';

const root = process.cwd();
const generatedPath = path.join(root, 'src/data/regma.generated.json');
const rawDir = path.join(root, 'src/data/raw/pokeapi');
const moveOptionsPath = path.join(root, 'src/data/regma-move-options.generated.json');

const versionGroups = new Set(['scarlet-violet']);

const baseName = (displayName: string): string =>
  displayName
    .replace(/^Mega /, '')
    .replace(/\s+\((Alolan|Galarian|Hisuian) Form\)/, '')
    .replace(/\s+\(Paldean Form (Combat|Blaze|Aqua) Breed\)/, '')
    .replace(/\s+\((Heat|Wash|Frost|Fan|Mow) Rotom\)/, ' Rotom')
    .replace(/\s+\((Male|Female)\)/, '')
    .replace(/\s+\((Medium|Small|Large|Jumbo) Variety\)/, '')
    .replace(/\s+\((Midday|Midnight|Dusk) Form\)/, '')
    .replace(/\s+\(Family of Four\)/, '')
    .trim();

const simpleSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/mr\./g, 'mr')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const exactSlugs: Record<string, string> = {
  'Raichu (Alolan Form)': 'raichu-alola',
  'Ninetales (Alolan Form)': 'ninetales-alola',
  'Arcanine (Hisuian Form)': 'arcanine-hisui',
  'Slowbro (Galarian Form)': 'slowbro-galar',
  'Tauros (Paldean Form Combat Breed)': 'tauros-paldea-combat-breed',
  'Tauros (Paldean Form Blaze Breed)': 'tauros-paldea-blaze-breed',
  'Tauros (Paldean Form Aqua Breed)': 'tauros-paldea-aqua-breed',
  'Typhlosion (Hisuian Form)': 'typhlosion-hisui',
  'Slowking (Galarian Form)': 'slowking-galar',
  'Rotom (Heat Rotom)': 'rotom-heat',
  'Rotom (Wash Rotom)': 'rotom-wash',
  'Rotom (Frost Rotom)': 'rotom-frost',
  'Rotom (Fan Rotom)': 'rotom-fan',
  'Rotom (Mow Rotom)': 'rotom-mow',
  'Samurott (Hisuian Form)': 'samurott-hisui',
  'Zoroark (Hisuian Form)': 'zoroark-hisui',
  'Stunfisk (Galarian Form)': 'stunfisk-galar',
  'Meowstic (Male)': 'meowstic-male',
  'Meowstic (Female)': 'meowstic-female',
  Aegislash: 'aegislash-shield',
  Mimikyu: 'mimikyu-disguised',
  Morpeko: 'morpeko-full-belly',
  Maushold: 'maushold-family-of-four',
  Palafin: 'palafin-zero',
  'Goodra (Hisuian Form)': 'goodra-hisui',
  'Gourgeist (Medium Variety)': 'gourgeist-average',
  'Gourgeist (Small Variety)': 'gourgeist-small',
  'Gourgeist (Large Variety)': 'gourgeist-large',
  'Gourgeist (Jumbo Variety)': 'gourgeist-super',
  'Avalugg (Hisuian Form)': 'avalugg-hisui',
  'Decidueye (Hisuian Form)': 'decidueye-hisui',
  'Lycanroc (Midday Form)': 'lycanroc-midday',
  'Lycanroc (Midnight Form)': 'lycanroc-midnight',
  'Lycanroc (Dusk Form)': 'lycanroc-dusk',
  'Basculegion (Male)': 'basculegion-male',
  'Basculegion (Female)': 'basculegion-female',
  'Mr. Rime': 'mr-rime',
  'Mega Charizard X': 'charizard-mega-x',
  'Mega Charizard Y': 'charizard-mega-y',
  'Mega Meowstic': 'meowstic-male'
};

const officialMegaSlugs = new Set([
  'abomasnow',
  'absol',
  'aerodactyl',
  'aggron',
  'alakazam',
  'altaria',
  'ampharos',
  'audino',
  'banette',
  'beedrill',
  'blastoise',
  'camerupt',
  'gallade',
  'garchomp',
  'gardevoir',
  'gengar',
  'glalie',
  'gyarados',
  'heracross',
  'houndoom',
  'kangaskhan',
  'lopunny',
  'lucario',
  'manectric',
  'medicham',
  'pinsir',
  'sableye',
  'scizor',
  'sharpedo',
  'slowbro',
  'steelix',
  'tyranitar',
  'venusaur'
]);

const nameOverrides: Record<string, string> = {
  'baby-doll-eyes': 'Baby-Doll Eyes',
  'double-edge': 'Double-Edge',
  'freeze-dry': 'Freeze-Dry',
  'lock-on': 'Lock-On',
  'multi-attack': 'Multi-Attack',
  'self-destruct': 'Self-Destruct',
  'soft-boiled': 'Soft-Boiled',
  'trick-or-treat': 'Trick-or-Treat',
  'u-turn': 'U-turn',
  'v-create': 'V-create',
  'will-o-wisp': 'Will-O-Wisp',
  'x-scissor': 'X-Scissor'
};

interface CachedMove {
  move?: {
    name?: string;
  };
  version_group_details?: Array<{
    version_group?: {
      name?: string;
    };
  }>;
}

interface CachedPokemon {
  moves?: CachedMove[];
}

const normalizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const preferredSlugs = (displayName: string): string[] => {
  if (exactSlugs[displayName]) return [exactSlugs[displayName]];

  const base = simpleSlug(baseName(displayName));
  if (displayName.startsWith('Mega ') && officialMegaSlugs.has(base)) {
    return [`${base}-mega`, base];
  }
  if (displayName.startsWith('Mega ')) {
    return [base];
  }
  return [simpleSlug(displayName), base];
};

const titleCaseMove = (slug: string): string =>
  nameOverrides[slug] ??
  slug
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const hasSupportedVersion = (move: CachedMove): boolean =>
  (move.version_group_details ?? []).some((detail) => versionGroups.has(detail.version_group?.name ?? ''));

const readCachedMoveNames = async (displayNames: string[], canonicalNames: Map<string, string>): Promise<string[]> => {
  const names = new Map<string, string>();
  const files = new Set(await readdir(rawDir).catch(() => []));
  const slugs = new Set(displayNames.flatMap(preferredSlugs).filter((slug) => files.has(`${slug}.json`)));

  for (const slug of slugs) {
    const file = `${slug}.json`;

    try {
      const pokemon = JSON.parse(await readFile(path.join(rawDir, file), 'utf8')) as CachedPokemon;
      for (const move of pokemon.moves ?? []) {
        const slug = move.move?.name;
        if (!slug || !hasSupportedVersion(move)) continue;

        const key = normalizeKey(slug);
        names.set(key, canonicalNames.get(key) ?? titleCaseMove(slug));
      }
    } catch {
      continue;
    }
  }

  return [...names.values()];
};

const uniqueSorted = (values: string[]): string[] => {
  const names = new Map<string, string>();
  values.forEach((value) => {
    const trimmed = value.trim();
    if (trimmed) names.set(normalizeKey(trimmed), trimmed);
  });
  return [...names.values()].sort((first, second) => first.localeCompare(second));
};

const main = async () => {
  const current = MetaDatasetSchema.parse(JSON.parse(await readFile(generatedPath, 'utf8')));
  const scoredMoves = current.moves.map((move) => move.name);
  const commonMoves = current.species.flatMap((species) => species.commonMoves);
  const canonicalNames = new Map([...scoredMoves, ...commonMoves].map((move) => [normalizeKey(move), move]));
  const cachedMoves = await readCachedMoveNames(
    current.species.map((species) => species.displayName),
    canonicalNames
  );
  const moves = uniqueSorted([...scoredMoves, ...commonMoves, ...cachedMoves]);

  await writeFile(
    moveOptionsPath,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        sourceNotes: [
          'Autocomplete move names are generated from cached public PokéAPI Scarlet/Violet learnsets for the Regulation M-A roster.',
          'The scorer only has rich metadata for moves in regma.generated.json; autocomplete entries may still be typed freely.'
        ],
        moves
      },
      null,
      2
    )}\n`
  );

  console.log(`Wrote ${moves.length} move autocomplete options to src/data/regma-move-options.generated.json.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
