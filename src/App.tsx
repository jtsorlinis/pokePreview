import { ChangeEvent, KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Download,
  Gauge,
  ListChecks,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Swords,
  Trash2,
  Upload,
  Users,
  Wand2
} from 'lucide-react';
import { abilityOptions, findSpecies, indexedData, moveOptions, normalizeKey, opponentSpeciesOptions, previewSpecies, speciesOptions } from './lib/data';
import { filledEntries } from './lib/candidates';
import { inferOpponentPreview } from './lib/opponentInference';
import { recommendPlans } from './lib/scoring';
import { createBlankOpponentTeam, createBlankTeam, exportTeamJson, importTeamJson, loadSavedTeam, saveTeam } from './lib/storage';
import { sampleOpponentTeam, samplePlayerTeam } from './lib/sampleTeams';
import { BLANK_ENTRY, type OpponentInference, type PokemonEntry, type Recommendation } from './lib/types';

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const entryLabel = (pokemon: PokemonEntry): string => pokemon.species || 'Empty slot';

const AUTOCOMPLETE_LIMIT = 10;

const autocompleteMatches = (options: string[], value: string): string[] => {
  const query = normalizeKey(value);
  if (!query) return options.slice(0, AUTOCOMPLETE_LIMIT);

  const startsWith: string[] = [];
  const includes: string[] = [];

  options.forEach((option) => {
    const key = normalizeKey(option);
    if (key.startsWith(query)) {
      startsWith.push(option);
    } else if (key.includes(query)) {
      includes.push(option);
    }
  });

  return [...startsWith, ...includes].slice(0, AUTOCOMPLETE_LIMIT);
};

const mergePlayerEntryWithSpecies = (entry: PokemonEntry, speciesName: string): PokemonEntry => {
  const meta = findSpecies(speciesName);
  return {
    ...entry,
    species: speciesName,
    types: meta?.types ?? [],
    ability: entry.ability || meta?.abilities[0] || '',
    moves: meta ? [...meta.commonMoves.slice(0, 4), '', '', '', ''].slice(0, 4) : entry.moves
  };
};

const mergeOpponentEntryWithSpecies = (entry: PokemonEntry, speciesName: string): PokemonEntry => {
  const meta = previewSpecies(speciesName);
  return {
    ...entry,
    species: meta?.displayName ?? speciesName,
    types: meta?.types ?? [],
    ability: '',
    moves: ['', '', '', ''],
    speedStat: null,
    notes: ''
  };
};

const normalizeTeamLength = (team: PokemonEntry[], prefix: string): PokemonEntry[] =>
  Array.from({ length: 6 }, (_, index) => team[index] ?? BLANK_ENTRY(`${prefix}-${index + 1}`)).map((entry, index) => ({
    ...entry,
    id: entry.id || `${prefix}-${index + 1}`,
    item: undefined,
    teraType: undefined,
    types: findSpecies(entry.species)?.types ?? entry.types,
    moves: [...entry.moves, '', '', '', ''].slice(0, 4)
  }));

interface EntryEditorProps {
  entry: PokemonEntry;
  index: number;
  mode: 'player' | 'opponent';
  onChange: (next: PokemonEntry) => void;
  onClear: () => void;
}

function PokemonSprite({ entry }: { entry: PokemonEntry }) {
  const meta = findSpecies(entry.species);
  const initials = entry.species
    .split(/\s|-/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="spriteFrame" aria-hidden="true">
      {meta?.sprite ? <img src={meta.sprite} alt="" loading="lazy" /> : <span>{initials || '?'}</span>}
    </div>
  );
}

function InferredTypes({ entry }: { entry: PokemonEntry }) {
  const types = findSpecies(entry.species)?.types ?? entry.types;

  return (
    <div className="field inferredTypes">
      <span>Types</span>
      <div
        className={`typeChips ${types.length ? '' : 'isEmpty'}`}
        aria-label={types.length ? `Inferred types: ${types.join(' and ')}` : 'Types inferred from species'}
        data-testid="inferred-types"
      >
        {types.length ? (
          types.map((type) => (
            <b className="typeChip" key={type}>
              {type}
            </b>
          ))
        ) : (
          <em>Inferred from species</em>
        )}
      </div>
    </div>
  );
}

interface AutocompleteInputProps {
  ariaLabel: string;
  options: string[];
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

function AutocompleteInput({ ariaLabel, options, placeholder, value, onChange }: AutocompleteInputProps) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`.replace(/:/g, '');
  const optionBaseId = `${generatedId}-option`.replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => autocompleteMatches(options, value), [options, value]);
  const boundedActiveIndex = matches.length ? Math.min(activeIndex, matches.length - 1) : 0;
  const activeOption = matches[boundedActiveIndex];
  const showDropdown = open && matches.length > 0;

  const commitOption = (option: string) => {
    onChange(option);
    setOpen(false);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (matches.length ? Math.min(current + 1, matches.length - 1) : 0));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (matches.length ? Math.max(current - 1, 0) : 0));
      return;
    }

    if (event.key === 'Enter' && showDropdown && activeOption) {
      event.preventDefault();
      commitOption(activeOption);
      return;
    }

    if (event.key === 'Tab' && showDropdown && activeOption && value.trim() && activeOption !== value) {
      commitOption(activeOption);
      return;
    }

    if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="autocompleteControl">
      <input
        aria-activedescendant={showDropdown ? `${optionBaseId}-${boundedActiveIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={showDropdown}
        aria-label={ariaLabel}
        role="combobox"
        value={value}
        placeholder={placeholder}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {showDropdown ? (
        <div className="autocompleteDropdown" id={listboxId} role="listbox">
          {matches.map((option, optionIndex) => (
            <button
              aria-selected={optionIndex === boundedActiveIndex}
              className={optionIndex === boundedActiveIndex ? 'isActive' : ''}
              id={`${optionBaseId}-${optionIndex}`}
              key={option}
              onMouseDown={(event) => {
                event.preventDefault();
                commitOption(option);
              }}
              role="option"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EntryEditor({ entry, index, mode, onChange, onClear }: EntryEditorProps) {
  const meta = findSpecies(entry.species);
  const isPlayer = mode === 'player';

  const updateMove = (moveIndex: number, value: string) => {
    const nextMoves = [...entry.moves, '', '', '', ''].slice(0, 4);
    nextMoves[moveIndex] = value;
    onChange({ ...entry, moves: nextMoves });
  };

  return (
    <article className={`pokemonRow ${entry.species ? 'isFilled' : ''}`}>
      <div className="slotNumber">{index + 1}</div>
      <PokemonSprite entry={entry} />
      <div className="entryMain">
        <div className="entryTopline">
          <label className="field speciesField">
            <span>Species</span>
            <AutocompleteInput
              ariaLabel="Species"
              value={entry.species}
              options={speciesOptions}
              placeholder={isPlayer ? 'Choose your Pokémon' : 'Opponent Pokémon'}
              onChange={(value) => onChange(mergePlayerEntryWithSpecies(entry, value))}
            />
          </label>
          <label className="field smallField">
            <span>Speed</span>
            <input
              type="number"
              min="0"
              value={entry.speedStat ?? ''}
              placeholder={meta ? String(meta.baseStats.speed) : 'Stat'}
              onChange={(event) =>
                onChange({
                  ...entry,
                  speedStat: event.target.value === '' ? null : Number(event.target.value)
                })
              }
            />
          </label>
          <button className="iconButton quiet" type="button" tabIndex={-1} onClick={onClear} title="Clear slot" aria-label="Clear slot">
            <Trash2 size={16} />
          </button>
        </div>

        <div className="entryGrid">
          <InferredTypes entry={entry} />
          <label className="field">
            <span>Ability</span>
            <AutocompleteInput
              ariaLabel="Ability"
              value={entry.ability ?? ''}
              options={abilityOptions}
              placeholder={meta?.abilities[0] ?? 'Ability'}
              onChange={(value) => onChange({ ...entry, ability: value })}
            />
          </label>
        </div>

        <div className="movesGrid">
          {entry.moves.map((move, moveIndex) => (
            <label className="field" key={`${entry.id}-move-${moveIndex}`}>
              <span>{isPlayer ? `Move ${moveIndex + 1}` : `Known move ${moveIndex + 1}`}</span>
              <AutocompleteInput ariaLabel={isPlayer ? `Move ${moveIndex + 1}` : `Known move ${moveIndex + 1}`} value={move} options={moveOptions} placeholder="Move" onChange={(value) => updateMove(moveIndex, value)} />
            </label>
          ))}
        </div>

        {isPlayer ? (
          <label className="field notesField">
            <span>Notes</span>
            <input value={entry.notes ?? ''} placeholder="Role, calc note, matchup plan" onChange={(event) => onChange({ ...entry, notes: event.target.value })} />
          </label>
        ) : null}
      </div>
    </article>
  );
}

function OpponentNameEditor({
  entry,
  index,
  onChange,
  onClear
}: {
  entry: PokemonEntry;
  index: number;
  onChange: (next: PokemonEntry) => void;
  onClear: () => void;
}) {
  return (
    <article className={`opponentNameRow ${entry.species ? 'isFilled' : ''}`}>
      <div className="slotNumber">{index + 1}</div>
      <PokemonSprite entry={entry} />
      <label className="field">
        <span>Species</span>
        <AutocompleteInput
          ariaLabel="Species"
          value={entry.species}
          options={opponentSpeciesOptions}
          placeholder="Opponent Pokémon"
          onChange={(value) => onChange(mergeOpponentEntryWithSpecies(entry, value))}
        />
      </label>
      <button className="iconButton quiet" type="button" tabIndex={-1} onClick={onClear} title="Clear slot" aria-label="Clear slot">
        <Trash2 size={16} />
      </button>
    </article>
  );
}

function RecommendationRow({
  recommendation,
  rank,
  selected,
  onSelect
}: {
  recommendation: Recommendation;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`recommendationRow ${selected ? 'isSelected' : ''}`} type="button" onClick={onSelect}>
      <span className="rank">{rank}</span>
      <span className="planNames">
        <strong>{recommendation.leads.map(entryLabel).join(' + ')}</strong>
        <small>Back: {recommendation.backs.map(entryLabel).join(' + ')}</small>
      </span>
      <span className="scorePill">{recommendation.score.toFixed(1)}</span>
      <span className="confidence">{formatPercent(recommendation.confidence)}</span>
    </button>
  );
}

function BreakdownBar({ label, value, max }: { label: string; value: number; max: number }) {
  const width = `${Math.round((Math.max(value, 0) / max) * 100)}%`;
  return (
    <div className="breakdownRow">
      <span>{label}</span>
      <div className="meter">
        <i style={{ width }} />
      </div>
      <strong>{value.toFixed(1)}</strong>
    </div>
  );
}

function DetailPanel({ recommendation }: { recommendation?: Recommendation }) {
  if (!recommendation) {
    return (
      <section className="detailPanel emptyState" data-testid="empty-detail">
        <Wand2 size={22} />
        <h2>Awaiting preview</h2>
        <p>Save at least four Pokémon on your side and enter the opposing preview.</p>
      </section>
    );
  }

  return (
    <section className="detailPanel" data-testid="recommendation-detail">
      <div className="detailHeader">
        <div>
          <p className="eyebrow">Selected plan</p>
          <h2>{recommendation.leads.map(entryLabel).join(' + ')}</h2>
          <p>Back: {recommendation.backs.map(entryLabel).join(' + ')}</p>
        </div>
        <div className="scoreBlock">
          <strong>{recommendation.score.toFixed(1)}</strong>
          <span>{formatPercent(recommendation.confidence)} confidence</span>
        </div>
      </div>

      <div className="tagRail">
        {recommendation.tags.length ? recommendation.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>Balanced</span>}
      </div>

      <div className="reasonList">
        {recommendation.reasons.map((reason) => (
          <div className={`reasonItem ${reason.tone}`} key={`${reason.label}-${reason.detail}`}>
            <strong>{reason.label}</strong>
            <p>{reason.detail}</p>
          </div>
        ))}
      </div>

      {recommendation.warnings.length > 0 ? (
        <div className="warningBox">
          <AlertTriangle size={18} />
          <div>
            {recommendation.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="breakdown">
        <BreakdownBar label="Offense" value={recommendation.breakdown.offense} max={28} />
        <BreakdownBar label="Defense" value={recommendation.breakdown.defense} max={24} />
        <BreakdownBar label="Speed" value={recommendation.breakdown.speed} max={18} />
        <BreakdownBar label="Lead" value={recommendation.breakdown.lead} max={18} />
        <BreakdownBar label="Roles" value={recommendation.breakdown.roles} max={17} />
        <BreakdownBar label="Meta" value={recommendation.breakdown.meta} max={10} />
      </div>
    </section>
  );
}

function OpponentIntelPanel({ inference, active }: { inference: OpponentInference; active: boolean }) {
  if (!active) {
    return (
      <section className="intelPanel emptyIntel" data-testid="opponent-intel-empty">
        <BarChart3 size={18} />
        <h2>Preview intel</h2>
        <p>Enter opponent names to infer likely sets, leads, and public-team matches.</p>
      </section>
    );
  }

  return (
    <section className="intelPanel" data-testid="opponent-intel">
      <div className="sectionHeader compactHeader">
        <div>
          <p className="eyebrow">Opponent read</p>
          <h2>Preview intel</h2>
        </div>
        <span className="confidenceChip">{formatPercent(inference.confidence)}</span>
      </div>

      {inference.archetypes.length > 0 ? (
        <div className="tagRail compactTags">
          {inference.archetypes.map((archetype) => (
            <span key={archetype}>{archetype}</span>
          ))}
        </div>
      ) : null}

      <div className="intelGrid">
        <div className="intelBlock">
          <strong>Public lead priors</strong>
          <div className="miniList">
            {inference.likelyLeadPairs.slice(0, 3).map((pair) => (
              <div className="setGuess" key={pair.members.join('-')}>
                <span>{pair.members.join(' + ')}</span>
                <small>{formatPercent(pair.probability)} public prior · {pair.reasons.slice(0, 2).join(', ')}</small>
                <small>
                  {pair.evidence.publicPairSamples
                    ? `Public pair sample: ${pair.evidence.publicPairSamples.toLocaleString()}`
                    : 'Public pair sample: low or unavailable'}
                </small>
              </div>
            ))}
          </div>
        </div>

        <div className="intelBlock">
          <strong>Likely sets</strong>
          <div className="miniList">
            {inference.setGuesses.slice(0, 4).map((guess) => (
              <div className="setGuess" key={guess.species}>
                <span>{guess.species}</span>
                <small>{guess.items.length ? `Items: ${guess.items.slice(0, 2).join(', ')}` : 'Items: low public sample'}</small>
                <small>{guess.moves.length ? `Moves: ${guess.moves.slice(0, 3).join(', ')}` : 'Moves: low public sample'}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="intelBlock">
          <strong>Similar teams</strong>
          <div className="miniList">
            {inference.similarTeams.slice(0, 3).map((team) => (
              <div className="setGuess" key={team.id}>
                <span>{team.title}</span>
                <small>
                  {team.source === 'tournament' ? team.event ?? 'Tournament' : 'Community'} · overlap {team.overlap.length}/6
                </small>
              </div>
            ))}
          </div>
        </div>

        {inference.formGuesses.some((guess) => guess.forms.length > 1) ? (
          <div className="intelBlock">
            <strong>Mega reads</strong>
            <div className="miniList">
              {inference.formGuesses
                .filter((guess) => guess.forms.length > 1)
                .slice(0, 3)
                .map((guess) => (
                  <div className="setGuess" key={guess.previewSpecies}>
                    <span>{guess.previewSpecies}</span>
                    <small>
                      {guess.forms
                        .slice(0, 2)
                        .map((form) => `${form.species} ${formatPercent(form.probability)}`)
                        .join(' · ')}
                    </small>
                  </div>
                ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function App() {
  const initialLoad = useMemo(() => loadSavedTeam(), []);
  const [team, setTeam] = useState<PokemonEntry[]>(() => normalizeTeamLength(initialLoad.team, 'team'));
  const [opponents, setOpponents] = useState<PokemonEntry[]>(() => createBlankOpponentTeam());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'setup' | 'battle'>('setup');
  const [notice, setNotice] = useState(initialLoad.error ?? '');
  const importInputRef = useRef<HTMLInputElement>(null);

  const playerCount = filledEntries(team).length;
  const opponentCount = filledEntries(opponents).length;
  const recommendations = useMemo(() => recommendPlans(team, opponents), [team, opponents]);
  const opponentIntel = useMemo(() => inferOpponentPreview(opponents), [opponents]);
  const topRecommendations = useMemo(() => recommendations.slice(0, 8), [recommendations]);
  const selectedRecommendation = topRecommendations[selectedIndex] ?? topRecommendations[0];
  const canShowRecommendations = playerCount >= 4 && opponentCount >= 1;

  const setTeamEntry = (index: number, entry: PokemonEntry) => {
    setTeam((current) => current.map((item, itemIndex) => (itemIndex === index ? entry : item)));
    setSelectedIndex(0);
  };

  const setOpponentEntry = (index: number, entry: PokemonEntry) => {
    setOpponents((current) => current.map((item, itemIndex) => (itemIndex === index ? entry : item)));
    setSelectedIndex(0);
  };

  const handleSave = () => {
    saveTeam(normalizeTeamLength(team, 'team'));
    setNotice('Team saved locally.');
  };

  const handleSaveAndBattle = () => {
    saveTeam(normalizeTeamLength(team, 'team'));
    setNotice('Team saved locally.');
    setActiveTab('battle');
  };

  const handleExport = () => {
    const payload = exportTeamJson(normalizeTeamLength(team, 'team'));
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pokemon-champions-team.json';
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Team exported.');
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imported = normalizeTeamLength(importTeamJson(await file.text()), 'team');
      setTeam(imported);
      saveTeam(imported);
      setNotice('Team imported and saved.');
    } catch {
      setNotice('Import failed. The file was not a valid advisor team export.');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Regulation M-A Doubles</p>
          <h1>Team Preview Advisor</h1>
        </div>
      </header>

      <nav className="tabBar" aria-label="Advisor workflow">
        <button type="button" className={activeTab === 'setup' ? 'isActive' : ''} aria-pressed={activeTab === 'setup'} onClick={() => setActiveTab('setup')}>
          <ListChecks size={17} />
          Setup team
        </button>
        <button type="button" className={activeTab === 'battle' ? 'isActive' : ''} aria-pressed={activeTab === 'battle'} onClick={() => setActiveTab('battle')}>
          <Swords size={17} />
          Battle preview
        </button>
      </nav>

      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}

      <section className="summaryBand" aria-label="Advisor status">
        <div>
          <Users size={18} />
          <span>Your team</span>
          <strong>{playerCount}/6</strong>
        </div>
        <div>
          <Swords size={18} />
          <span>Opponent preview</span>
          <strong>{opponentCount}/6</strong>
        </div>
        <div>
          <BarChart3 size={18} />
          <span>Candidate plans</span>
          <strong>{recommendations.length}</strong>
        </div>
        <div>
          <Gauge size={18} />
          <span>Data version</span>
          <strong>{new Date(indexedData.updatedAt).toLocaleDateString()}</strong>
        </div>
      </section>

      <input ref={importInputRef} className="hiddenInput" type="file" accept="application/json,.json" onChange={handleImport} />

      {activeTab === 'setup' ? (
        <div className="setupWorkspace" data-testid="setup-tab">
          <section className="teamColumn">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Saved roster</p>
                <h2>Your six</h2>
              </div>
              <div className="inlineActions">
                <button type="button" className="iconTextButton" onClick={() => setTeam(normalizeTeamLength(samplePlayerTeam, 'team'))}>
                  <Sparkles size={15} />
                  Load sample
                </button>
                <button type="button" className="iconTextButton" onClick={() => setTeam(createBlankTeam())}>
                  <RefreshCw size={15} />
                  Reset
                </button>
              </div>
            </div>

            <div className="setupActions">
              <button type="button" className="secondaryButton" onClick={handleExport}>
                <Download size={16} />
                Export
              </button>
              <button type="button" className="secondaryButton" onClick={() => importInputRef.current?.click()}>
                <Upload size={16} />
                Import
              </button>
              <button type="button" className="secondaryButton" onClick={handleSave}>
                <Save size={16} />
                Save team
              </button>
              <button type="button" className="primaryButton" onClick={handleSaveAndBattle}>
                <Swords size={16} />
                Save and battle
              </button>
            </div>

            <div className="entryStack setupTeamGrid">
              {team.map((entry, index) => (
                <EntryEditor
                  key={entry.id}
                  entry={entry}
                  index={index}
                  mode="player"
                  onChange={(next) => setTeamEntry(index, next)}
                  onClear={() => setTeamEntry(index, BLANK_ENTRY(`team-${index + 1}`))}
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="battleWorkspace" data-testid="battle-tab">
          <section className="battleTeamStrip" aria-label="Saved team for this match">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Saved team</p>
                <h2>Your six</h2>
              </div>
              <button type="button" className="iconTextButton" onClick={() => setActiveTab('setup')}>
                <ClipboardList size={15} />
                Edit
              </button>
            </div>
            <div className="teamPreviewStrip">
              {team.map((entry) => (
                <div className={`teamPreviewSlot ${entry.species ? 'isFilled' : ''}`} key={entry.id}>
                  <PokemonSprite entry={entry} />
                  <span>{entryLabel(entry)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="battleColumns">
            <section className="teamColumn opponentColumn">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">Match preview</p>
                  <h2>Opponent six</h2>
                </div>
                <div className="inlineActions">
                  <button type="button" className="iconTextButton" onClick={() => setOpponents(normalizeTeamLength(sampleOpponentTeam, 'opponent'))}>
                    <Sparkles size={15} />
                    Common
                  </button>
                  <button type="button" className="iconTextButton" onClick={() => setOpponents(createBlankOpponentTeam())}>
                    <Trash2 size={15} />
                    Clear
                  </button>
                </div>
              </div>
              <div className="entryStack compact opponentNameGrid">
                {opponents.map((entry, index) => (
                  <OpponentNameEditor
                    key={entry.id}
                    entry={entry}
                    index={index}
                    onChange={(next) => setOpponentEntry(index, next)}
                    onClear={() => setOpponentEntry(index, BLANK_ENTRY(`opponent-${index + 1}`))}
                  />
                ))}
              </div>
              <OpponentIntelPanel inference={opponentIntel} active={opponentCount >= 1} />
            </section>

            <section className="recommendationColumn">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">Bring 4</p>
                  <h2>Recommendations</h2>
                </div>
                <Shield size={20} />
              </div>

              {canShowRecommendations ? (
                <div className="recommendationList" data-testid="recommendation-list">
                  {topRecommendations.map((recommendation, index) => (
                    <RecommendationRow
                      key={`${recommendation.leads.map((pokemon) => pokemon.id).join('-')}-${recommendation.backs.map((pokemon) => pokemon.id).join('-')}`}
                      recommendation={recommendation}
                      rank={index + 1}
                      selected={index === selectedIndex}
                      onSelect={() => setSelectedIndex(index)}
                    />
                  ))}
                </div>
              ) : (
                <div className="emptyState compactState" data-testid="recommendation-empty">
                  <Swords size={20} />
                  <h2>Need a preview</h2>
                  <p>Fill at least four of your slots and one opposing slot.</p>
                </div>
              )}

              <DetailPanel recommendation={canShowRecommendations ? selectedRecommendation : undefined} />
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
