import { useState } from 'react';
import { siString } from '../engine';
import type { VarOut } from '../worker/protocol';
import { fmt, siToUnit, unitChoices, unitFor, unitToSi } from './format';
import type { Doc } from './doc';

export function Results(props: {
  vars: VarOut[];
  solved: boolean;
  doc: Doc;
  setDoc: (f: (d: Doc) => Doc) => void;
  onRun: () => void;
  ready: boolean;
  onAssistant: () => void;
}) {
  const { vars, doc, setDoc, solved } = props;
  const [advanced, setAdvanced] = useState(false);
  const [filter, setFilter] = useState('');

  if (!vars.length) {
    return (
      <div className="empty">
        <h3>Todavía no hay resultados</h3>
        <p>Aquí aparecerá cada variable con su valor y sus unidades. Si no sabes por dónde empezar, el asistente te pide los datos y escribe las ecuaciones por ti.</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={props.onAssistant}>
            Usar el asistente
          </button>
          <button className="btn" onClick={props.onRun} disabled={!props.ready}>
            Resolver mis ecuaciones
          </button>
        </div>
        <p className="muted small">
          Atajo: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> o <kbd>F2</kbd>
        </p>
      </div>
    );
  }

  const shown = vars
    .map((v) => ({ ...v, key: v.name.toLowerCase() }))
    .filter((v) => !filter || v.key.includes(filter.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }));

  const setRec = (field: 'guesses' | 'lower' | 'upper', key: string, raw: string, unit: string) => {
    setDoc((d) => {
      const rec = { ...d[field] };
      const n = Number(raw.replace(',', '.'));
      if (raw.trim() === '' || !Number.isFinite(n)) delete rec[key];
      else rec[key] = unitToSi(n, unit);
      return { ...d, [field]: rec };
    });
  };
  const recVal = (field: 'guesses' | 'lower' | 'upper', key: string, unit: string) => {
    const v = doc[field][key];
    return v === undefined ? '' : fmt(siToUnit(v, unit), 6);
  };

  return (
    <div className="results">
      <div className="results-tools">
        <label className="search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Buscar variable</span>
          <input id="var-search" placeholder="Buscar variable" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /> Valores iniciales y límites
        </label>
      </div>
      <div className="table-wrap framed">
        <table className="grid">
          <thead>
            <tr>
              <th>Variable</th>
              <th className="num">Valor</th>
              <th>Unidades</th>
              {advanced && (
                <>
                  <th className="num" title="Valor desde el que arranca el método numérico">Valor inicial</th>
                  <th className="num">Mín</th>
                  <th className="num">Máx</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => {
              const unit = unitFor(v.dim, doc.units[v.key]);
              const choices = unitChoices(v.dim);
              return (
                <tr key={v.key}>
                  <td className="var">{v.name}</td>
                  <td className="num value">{solved ? fmt(siToUnit(v.value, unit)) : <span className="muted">—</span>}</td>
                  <td>
                    {!v.dim ? (
                      <span className="unit-unknown" tabIndex={0} data-tip="Unidades no deducidas: se muestra en SI" aria-label="No se pudieron deducir las unidades a partir de las ecuaciones. Se muestra en SI.">
                        ?
                      </span>
                    ) : choices.length > 1 ? (
                      <select
                        className="unit-select"
                        value={unit}
                        onChange={(e) => setDoc((d) => ({ ...d, units: { ...d.units, [v.key]: e.target.value } }))}
                        aria-label={`Unidades de ${v.name}`}
                      >
                        {choices.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="unit">{unit || siString(v.dim)}</span>
                    )}
                  </td>
                  {advanced &&
                    (['guesses', 'lower', 'upper'] as const).map((f) => (
                      <td key={f} className="num">
                        <input
                          className="cell-input"
                          defaultValue={recVal(f, v.key, unit)}
                          placeholder={f === 'guesses' ? fmt(siToUnit(v.guess, unit)) : ''}
                          onBlur={(e) => setRec(f, v.key, e.target.value, unit)}
                          aria-label={`${f} de ${v.name}`}
                          key={`${f}-${unit}-${doc[f][v.key] ?? ''}`}
                        />
                      </td>
                    ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {advanced && (
        <p className="hint">
          Si una ecuación no converge, da un valor inicial cercano a la respuesta esperada o limita el rango (por ejemplo, calidad entre 0 y 1). Los valores están en las unidades
          elegidas en cada fila.
        </p>
      )}
    </div>
  );
}
