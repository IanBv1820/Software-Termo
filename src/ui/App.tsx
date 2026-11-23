import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { linspace, type Diagnostic, type TableRow } from '../engine';
import type { Response, VarOut } from '../worker/protocol';
import { Editor, type EditorHandle } from './Editor';
import { Results } from './Results';
import { TablePanel } from './TablePanel';
import { PlotPanel } from './PlotPanel';
import { Help } from './Help';
import { EXAMPLES } from './examples';
import { docFromExample, loadDoc, parseDocFile, saveDoc, type Doc } from './doc';
import { fmt, siToUnit, unitFor, unitToSi } from './format';
import { useSolver } from './useSolver';

type Tab = 'results' | 'table' | 'plot' | 'help';
type Stats = Extract<Response, { type: 'solved' }>['stats'];

export function App() {
  const [doc, setDocState] = useState<Doc>(loadDoc);
  const setDoc = useCallback((f: (d: Doc) => Doc) => setDocState((d) => f(d)), []);
  const { ready, fatal, call, cancel } = useSolver();
  const [tab, setTab] = useState<Tab>('results');
  const [checkDiags, setCheckDiags] = useState<Diagnostic[]>([]);
  const [solveDiags, setSolveDiags] = useState<Diagnostic[] | null>(null);
  const [vars, setVars] = useState<VarOut[]>([]);
  const [solvedSrc, setSolvedSrc] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(null);
  const [busy, setBusy] = useState(false);
  const [tableRows, setTableRows] = useState<(TableRow | null)[]>([]);
  const [tableRunning, setTableRunning] = useState(false);
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('termo-solver:theme') ?? 'auto';
    } catch {
      return 'auto';
    }
  });
  const editorRef = useRef<EditorHandle | null>(null);
  const [pending, setPending] = useState<{ message: string; confirm: string; action: () => void } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveDoc(doc), [doc]);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('termo-solver:theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const solvedNow = solvedSrc === doc.src;

  // live syntax + unit check while typing
  useEffect(() => {
    const h = setTimeout(async () => {
      const r = await call<Extract<Response, { type: 'checked' }>>({ type: 'check', src: doc.src });
      if (r.type !== 'checked') return;
      setCheckDiags(r.diagnostics);
      setVars((old) => {
        const prev = new Map(old.map((v) => [v.name.toLowerCase(), v]));
        return r.vars.map((v) => ({ ...v, value: prev.get(v.name.toLowerCase())?.value ?? NaN }));
      });
    }, 350);
    return () => clearTimeout(h);
  }, [doc.src, call]);

  const run = useCallback(async () => {
    setBusy(true);
    setTab((t) => (t === 'help' ? 'results' : t));
    const src = doc.src;
    const r = await call<Extract<Response, { type: 'solved' }>>({ type: 'solve', src, guesses: doc.guesses, lower: doc.lower, upper: doc.upper });
    setBusy(false);
    if (r.type !== 'solved') return;
    setSolveDiags(r.diagnostics);
    if (r.vars.length) setVars(r.vars);
    setStats(r.stats);
    setSolvedSrc(r.ok ? src : null);
  }, [call, doc]);

  const runRef = useRef(run);
  runRef.current = run;

  const runTable = useCallback(async () => {
    const cols = doc.table.columns;
    const byKey = new Map(vars.map((v) => [v.name.toLowerCase(), v]));
    const n = doc.table.rows;
    const inputs = cols
      .filter((c) => c.input && c.from !== undefined && c.to !== undefined)
      .map((c) => {
        const unit = unitFor(byKey.get(c.name.toLowerCase())?.dim ?? null, doc.units[c.name.toLowerCase()]);
        return { name: c.name, values: linspace(c.from!, c.to!, n).map((v) => unitToSi(v, unit)) };
      });
    setTableRows(new Array(n).fill(null));
    setTableRunning(true);
    const res = await call<Response>({ type: 'table', src: doc.src, inputs, guesses: doc.guesses, lower: doc.lower, upper: doc.upper }, (m) => {
      if (m.type === 'tableRow') setTableRows((rows) => rows.map((r, i) => (i === m.index ? m.row : r)));
    });
    setTableRunning(false);
    if (res.type === 'tableDone') {
      if (res.rows.length) setTableRows(res.rows);
      const errs = res.diagnostics.filter((d) => d.severity === 'error');
      if (errs.length) setSolveDiags(errs);
    }
  }, [call, doc, vars]);

  const exportCsv = () => {
    const cols = doc.table.columns;
    const byKey = new Map(vars.map((v) => [v.name.toLowerCase(), v]));
    const units = cols.map((c) => unitFor(byKey.get(c.name.toLowerCase())?.dim ?? null, doc.units[c.name.toLowerCase()]));
    const head = cols.map((c, i) => `${byKey.get(c.name.toLowerCase())?.name ?? c.name}${units[i] ? ` [${units[i]}]` : ''}`);
    const lines = tableRows.map((r) => cols.map((c, i) => (r ? String(siToUnit(r.values[c.name.toLowerCase()], units[i])) : '')).join(','));
    download(`${slug(doc.title)}-tabla.csv`, [head.join(','), ...lines].join('\n'), 'text/csv');
  };

  const isDirty = () => !!doc.src.trim() && !EXAMPLES.some((e) => e.src === doc.src);
  const openExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (isDirty() && !pending)
      return setPending({
        message: `Se reemplazarán las ecuaciones de «${doc.title}» por el ejemplo «${ex?.title}». Guarda antes si quieres conservarlas.`,
        confirm: 'Reemplazar ecuaciones',
        action: () => loadExample(id),
      });
    loadExample(id);
  };
  const loadExample = (id: string) => {
    setDocState(docFromExample(id));
    setSolveDiags(null);
    setSolvedSrc(null);
    setTableRows([]);
    setStats(null);
  };
  const newDoc = () => {
    if (isDirty())
      return setPending({
        message: `Se borrarán las ecuaciones de «${doc.title}». Guarda antes si quieres conservarlas.`,
        confirm: 'Borrar y empezar',
        action: clearDoc,
      });
    clearDoc();
  };
  const clearDoc = () => {
    setDocState({ ...docFromExample('rankine'), title: 'Sin título', src: '', table: { columns: [], rows: 10 }, plot: { x: '', y: [] } });
    setVars([]);
    setSolveDiags(null);
    setSolvedSrc(null);
    setTableRows([]);
    setStats(null);
  };
  const saveFile = () => download(`${slug(doc.title)}.tsolv`, JSON.stringify(doc, null, 2), 'application/json');
  const openFile = async (f: File) => {
    try {
      const d = parseDocFile(await f.text());
      setDocState({ ...d, title: d.title || f.name.replace(/\.[^.]+$/, '') });
      setSolveDiags(null);
      setSolvedSrc(null);
      setTableRows([]);
    } catch (e) {
      setNotice(`No se pudo abrir «${f.name}»: ${e instanceof Error ? e.message : String(e)}. Elige un archivo .tsolv guardado con este programa.`);
    }
  };

  // diagnostics shown: syntax/unit check while editing, plus solver messages for the solved text
  const diagnostics = useMemo(() => {
    const solverOnly = (solveDiags ?? []).filter((d) => !checkDiags.some((c) => c.message === d.message && c.pos?.from === d.pos?.from));
    return [...checkDiags, ...(solveDiags && (solvedSrc === null || solvedNow) ? solverOnly : [])];
  }, [checkDiags, solveDiags, solvedSrc, solvedNow]);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const varNames = useMemo(() => vars.map((v) => v.name), [vars]);

  const status = !ready
    ? { cls: 'pending', text: fatal ?? 'Cargando propiedades termodinámicas…' }
    : busy
      ? { cls: 'pending', text: 'Resolviendo…' }
      : solvedNow && stats
        ? { cls: 'ok', text: `Resuelto: ${stats.equations} ecuaciones en ${stats.blocks} bloques · ${stats.ms < 1 ? '<1' : Math.round(stats.ms)} ms` }
        : errors.length
          ? { cls: 'error', text: `${errors.length} error${errors.length > 1 ? 'es' : ''}` }
          : { cls: 'idle', text: solvedSrc === null && stats === null ? 'Listo para resolver' : 'Ecuaciones modificadas: resuelve de nuevo' };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M10 3h4v10.5a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="12" cy="17" r="2" fill="currentColor" />
          </svg>
          <span>Software-Termo</span>
        </div>
        <input
          className="doc-title"
          value={doc.title}
          onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
          aria-label="Nombre del documento"
          spellCheck={false}
        />
        <nav className="actions">
          <button className="btn ghost" onClick={newDoc}>
            Empezar en blanco
          </button>
          <button className="btn ghost" onClick={() => fileInput.current?.click()}>
            Abrir
          </button>
          <button className="btn ghost" onClick={saveFile}>
            Guardar
          </button>
          <select className="btn ghost select" value="" onChange={(e) => e.target.value && openExample(e.target.value)} aria-label="Ejemplos">
            <option value="">Ejemplos</option>
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <button
            className="btn ghost icon"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : t === 'light' ? 'auto' : 'dark'))}
            data-tip={`Cambiar tema (ahora: ${theme === 'auto' ? 'automático' : theme === 'dark' ? 'oscuro' : 'claro'})`}
            aria-label={`Cambiar tema (ahora: ${theme === 'auto' ? 'automático' : theme === 'dark' ? 'oscuro' : 'claro'})`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {theme === 'dark' ? (
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
              ) : theme === 'light' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
                </>
              )}
            </svg>
          </button>
          <button className="btn primary" onClick={run} disabled={!ready || busy}>
            ▶ Resolver
          </button>
        </nav>
        <input
          ref={fileInput}
          type="file"
          accept=".tsolv,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f);
            e.target.value = '';
          }}
        />
      </header>

      {pending && (
        <div className="confirm-bar" role="alertdialog" aria-labelledby="confirm-msg" onKeyDown={(e) => e.key === 'Escape' && setPending(null)}>
          <span id="confirm-msg">{pending.message}</span>
          <span className="confirm-actions">
            <button className="btn" autoFocus onClick={() => setPending(null)}>
              Cancelar
            </button>
            <button
              className="btn danger"
              onClick={() => {
                pending.action();
                setPending(null);
              }}
            >
              {pending.confirm}
            </button>
          </span>
        </div>
      )}
      {notice && (
        <div className="confirm-bar error" role="alert">
          <span>{notice}</span>
          <button className="btn" onClick={() => setNotice(null)}>
            Cerrar aviso
          </button>
        </div>
      )}
      <main className="workspace">
        <section className="pane editor-pane">
          <div className="pane-head">
            <h2>Ecuaciones</h2>
            <span className={`status ${status.cls}`}>{status.text}</span>
          </div>
          <Editor value={doc.src} onChange={(src) => setDoc((d) => ({ ...d, src }))} onRun={() => runRef.current()} diagnostics={diagnostics} variables={varNames} handleRef={editorRef} />
          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="diag-list" aria-live="polite">
              {[...errors, ...warnings].slice(0, 30).map((d, i) => (
                <li key={i} className={d.severity}>
                  <button onClick={() => d.pos && editorRef.current?.focusLine(d.pos.line)} disabled={!d.pos}>
                    <span className="badge">{d.severity === 'error' ? 'Error' : 'Aviso'}</span>
                    {d.pos && <span className="line">Línea {d.pos.line}</span>}
                    <span className="msg">{d.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pane side-pane">
          <div className="tabs" role="tablist">
            {(
              [
                ['results', 'Resultados'],
                ['table', 'Tabla paramétrica'],
                ['plot', 'Gráfica'],
                ['help', 'Ayuda'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'results' && (
              <>
                {solvedNow && stats && (
                  <div className="summary">
                    <div>
                      <b>{stats.unknowns}</b> incógnitas
                    </div>
                    <div>
                      <b>{stats.blocks}</b> bloques{stats.largestBlock > 1 ? ` (el mayor con ${stats.largestBlock} ecuaciones acopladas)` : ''}
                    </div>
                    <div>
                      residuo máx. <b>{fmt(stats.maxResidual, 2)}</b>
                    </div>
                  </div>
                )}
                <Results vars={vars} solved={solvedNow} doc={doc} setDoc={setDoc} onRun={run} ready={ready} />
              </>
            )}
            {tab === 'table' && (
              <TablePanel
                doc={doc}
                setDoc={setDoc}
                vars={vars}
                rows={tableRows}
                running={tableRunning}
                onRun={runTable}
                onCancel={() => {
                  cancel();
                  setTableRunning(false);
                }}
                onExport={exportCsv}
              />
            )}
            {tab === 'plot' && <PlotPanel doc={doc} setDoc={setDoc} vars={vars} rows={tableRows} theme={theme} onGoTable={() => setTab('table')} />}
            {tab === 'help' && <Help />}
          </div>
        </section>
      </main>
    </div>
  );
}

function slug(s: string) {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'documento'
  );
}

function download(name: string, content: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
