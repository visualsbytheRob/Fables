/**
 * Live playtest pane (F531–F540): runs the CURRENT editor buffers through
 * the forge VM, entirely client-side. Recompiles on edit and re-applies the
 * recorded choice path while it stays valid (hot reload, F532/F533);
 * supports jump-to-knot starts with a VAR state editor (F534/F535), named
 * scenarios with a replay/diff runner (F536/F537), per-line source
 * attribution (F538) and an iPhone-ish preview frame (F539).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Play, RotateCcw, Select, Smartphone, useToast } from '@fables/ui';
import { programFingerprint } from '@fables/forge-vm';
import type { IrProgram } from '@fables/forge-vm';
import {
  compileBuffers,
  makeJumpSource,
  startRun,
  takeChoice,
  transcriptOf,
  type RunResult,
} from './engine.js';
import {
  deleteScenario,
  loadScenarios,
  runScenario,
  saveScenario,
  type Scenario,
  type ScenarioResult,
} from './scenarios.js';

export interface PlaytestPaneProps {
  storyId: string;
  /** Live project buffers (path → source). */
  sources: ReadonlyMap<string, string>;
  entryPath: string;
  /** Bumped whenever any buffer changes — triggers the hot-reload rebuild. */
  version: number;
  /** Jump the editor to file:line (transcript source attribution, F538). */
  onJumpToSource: (file: string, line: number) => void;
}

const REBUILD_IDLE_MS = 400;

export function PlaytestPane({
  storyId,
  sources,
  entryPath,
  version,
  onJumpToSource,
}: PlaytestPaneProps) {
  const { toast } = useToast();
  const [seed, setSeed] = useState('42');
  const [startKnot, setStartKnot] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [showVars, setShowVars] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [program, setProgram] = useState<IrProgram | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>(() => loadScenarios(storyId));
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioResults, setScenarioResults] = useState<Map<string, ScenarioResult>>(new Map());
  const [openDiff, setOpenDiff] = useState<string | null>(null);

  /** The recorded choice path of the live run (texts, in order). */
  const pathRef = useRef<string[]>([]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const compileNow = useCallback((): IrProgram | null => {
    const knot = startKnot;
    const built = compileBuffers(
      sourcesRef.current,
      entryPath,
      knot !== '' ? (src) => makeJumpSource(src, knot) : undefined,
    );
    setProgram(built.program);
    setBuildError(built.error);
    return built.program;
  }, [entryPath, startKnot]);

  const begin = useCallback(
    (path: readonly string[]) => {
      const built = compileNow();
      if (built === null) {
        setRun(null);
        return;
      }
      const result = startRun(built, { seed: seed === '' ? 42 : seed, vars }, path);
      pathRef.current = result.lines
        .filter((l) => l.kind === 'choice')
        .map((l) => l.text);
      setRun(result);
    },
    [compileNow, seed, vars],
  );

  // Hot reload (F532/F533): when buffers change while a run is live, rebuild
  // and re-apply the recorded path. Divergence stops the replay with a notice.
  const fingerprint = program === null ? null : programFingerprint(program);
  useEffect(() => {
    if (run === null) return;
    const timer = setTimeout(() => {
      const built = compileNow();
      if (built === null) return; // keep the stale run + show the build error
      if (fingerprint !== null && programFingerprint(built) === fingerprint) return;
      const result = startRun(built, { seed: seed === '' ? 42 : seed, vars }, pathRef.current);
      pathRef.current = result.lines.filter((l) => l.kind === 'choice').map((l) => l.text);
      setRun(result);
    }, REBUILD_IDLE_MS);
    return () => clearTimeout(timer);
  }, [version]);

  const choose = (index: number): void => {
    if (run === null || program === null) return;
    const view = run.choices[index];
    if (view === undefined) return;
    pathRef.current = [...pathRef.current, view.text];
    setRun(takeChoice(run, program, index));
  };

  const knotNames = useMemo(() => {
    // Knot names for jump-to-knot, read straight from the compiled program.
    const base = compileBuffers(sourcesRef.current, entryPath);
    if (base.program === null) return [];
    return base.program.containers
      .map((c) => c.name)
      .filter((name) => name !== '' && !name.includes('.') && !name.includes('#'));
  }, [entryPath, version]);

  const globalNames = useMemo(() => {
    const base = program ?? compileBuffers(sourcesRef.current, entryPath).program;
    return base === null ? [] : base.globals.filter((g) => g.declKind === 'VAR').map((g) => g.name);
  }, [program, entryPath, version]);

  const onSaveScenario = (): void => {
    if (run === null) {
      toast('start a run before saving a scenario');
      return;
    }
    const name = scenarioName.trim() === '' ? `scenario ${scenarios.length + 1}` : scenarioName.trim();
    const saved = saveScenario(storyId, {
      name,
      seed: seed === '' ? 42 : seed,
      choices: pathRef.current,
      baseline: transcriptOf(run.lines),
    });
    setScenarios(loadScenarios(storyId));
    setScenarioName('');
    toast(`saved scenario "${saved.name}"`);
  };

  const onRunScenarios = (): void => {
    const built = compileBuffers(sourcesRef.current, entryPath);
    if (built.program === null) {
      toast(built.error ?? 'story does not compile');
      return;
    }
    const results = new Map<string, ScenarioResult>();
    for (const scenario of scenarios) results.set(scenario.id, runScenario(built.program, scenario));
    setScenarioResults(results);
  };

  const transcript = (
    <div className="playtest-transcript" data-testid="playtest-transcript">
      {run === null ? (
        <p style={{ color: 'var(--text-dim)' }}>
          Press Run to play the current buffers. Edits hot-reload and replay your choices.
        </p>
      ) : (
        run.lines.map((line, i) => (
          <p key={i} className={`pt-line pt-${line.kind}`}>
            <span className="pt-text">{line.kind === 'choice' ? `> ${line.text}` : line.text}</span>
            {line.file !== undefined && line.line !== undefined ? (
              <button
                className="pt-src"
                title="Jump to source (F538)"
                onClick={() => onJumpToSource(line.file as string, line.line as number)}
              >
                {line.file.split('/').pop()}:{line.line}
              </button>
            ) : null}
          </p>
        ))
      )}
    </div>
  );

  const choicesBlock =
    run !== null && run.status === 'choices' ? (
      <div className="pt-choices">
        {run.choices.map((c) => (
          <Button key={c.index} onClick={() => choose(c.index)}>
            {c.text}
          </Button>
        ))}
      </div>
    ) : null;

  return (
    <div className="playtest">
      <div className="playtest-toolbar">
        <Button variant="primary" onClick={() => begin([])} title="Run from the start (F531)">
          <Play size={13} /> Run
        </Button>
        <Button onClick={() => begin(pathRef.current)} title="Restart and replay choices (F533)">
          <RotateCcw size={13} /> Replay
        </Button>
        <label>
          seed{' '}
          <Input
            className="seed-input"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            aria-label="Seed"
          />
        </label>
        <Select
          value={startKnot}
          onChange={(e) => setStartKnot(e.target.value)}
          aria-label="Start at knot"
          title="Jump-to-knot playtesting (F534)"
        >
          <option value="">from start</option>
          {knotNames.map((name) => (
            <option key={name} value={name}>
              -&gt; {name}
            </option>
          ))}
        </Select>
        <Button onClick={() => setShowVars((v) => !v)} title="State editor (F535)">
          vars
        </Button>
        <Button
          onClick={() => setMobile((m) => !m)}
          title="iPhone preview frame (F539)"
          className={mobile ? 'regex-toggle on' : ''}
        >
          <Smartphone size={13} />
        </Button>
      </div>

      {buildError !== null ? (
        <p className="pt-status" style={{ color: 'var(--danger)' }}>
          build failed: {buildError}
        </p>
      ) : null}
      {run !== null && run.divergedAt !== null ? (
        <p className="pt-status" style={{ color: '#f5a623' }}>
          replay diverged at choice {run.divergedAt + 1} — path truncated.
        </p>
      ) : null}
      {run !== null && run.status === 'done' ? <p className="pt-status">— THE END —</p> : null}

      {showVars ? (
        <div className="pt-vars" data-testid="playtest-vars">
          {globalNames.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>no VARs declared</span>
          ) : (
            globalNames.map((name) => (
              <label key={name} className="pt-var-row">
                <code>{name}</code>
                <Input
                  placeholder="initial value"
                  value={vars[name] ?? ''}
                  onChange={(e) => setVars((prev) => ({ ...prev, [name]: e.target.value }))}
                  aria-label={`Initial value for ${name}`}
                />
              </label>
            ))
          )}
        </div>
      ) : null}

      {mobile ? (
        <div className="pt-mobile-frame" data-testid="mobile-frame">
          {transcript}
          {choicesBlock}
        </div>
      ) : (
        <>
          {transcript}
          {choicesBlock}
        </>
      )}

      <div className="pt-scenarios">
        <div className="pt-scenario-row">
          <Input
            placeholder="scenario name"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            aria-label="Scenario name"
          />
          <Button onClick={onSaveScenario} title="Save current choice path (F536)">
            Save path
          </Button>
          <Button onClick={onRunScenarios} disabled={scenarios.length === 0} title="Replay all (F537)">
            Run all
          </Button>
        </div>
        {scenarios.map((scenario) => {
          const result = scenarioResults.get(scenario.id);
          return (
            <div key={scenario.id}>
              <div className="pt-scenario-row">
                <span className="sc-name">
                  {scenario.name} · {scenario.choices.length} choice
                  {scenario.choices.length === 1 ? '' : 's'}
                </span>
                {result !== undefined ? (
                  <button
                    className={`sc-chip ${result.status}`}
                    onClick={() => setOpenDiff(openDiff === scenario.id ? null : scenario.id)}
                    title={result.status === 'pass' ? 'transcript unchanged' : 'transcript changed — view diff'}
                  >
                    {result.status}
                  </button>
                ) : null}
                <Button
                  onClick={() => {
                    deleteScenario(storyId, scenario.id);
                    setScenarios(loadScenarios(storyId));
                  }}
                >
                  ×
                </Button>
              </div>
              {result !== undefined && openDiff === scenario.id && result.status !== 'pass' ? (
                <div className="pt-diff">
                  {result.diff.map((d, i) => (
                    <div key={i} className={`diff-${d.op}`}>
                      {d.op === 'add' ? '+ ' : d.op === 'del' ? '- ' : '  '}
                      {d.text}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
