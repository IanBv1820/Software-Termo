import type { TableRow } from '../engine';
import type { VarOut } from '../worker/protocol';
import type { Doc, TableCol } from './doc';
import { fmt, siToUnit, unitFor } from './format';

export function TablePanel(props: {
  doc: Doc;
  setDoc: (f: (d: Doc) => Doc) => void;
  vars: VarOut[];
  rows: (TableRow | null)[];
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  onExport: () => void;
}) {
  const { doc, setDoc, vars, rows, running } = props;
  const cols = doc.table.columns;
  const byKey = new Map(vars.map((v) => [v.name.toLowerCase(), v]));
  const available = vars.filter((v) => !cols.some((c) => c.name.toLowerCase() === v.name.toLowerCase()));
  const unitOf = (name: string) => unitFor(byKey.get(name.toLowerCase())?.dim ?? null, doc.units[name.toLowerCase()]);

  const setCols = (f: (c: TableCol[]) => TableCol[]) => setDoc((d) => ({ ...d, table: { ...d.table, columns: f(d.table.columns) } }));
  const update = (i: number, patch: Partial<TableCol>) => setCols((c) => c.map((col, j) => (j === i ? { ...col, ...patch } : col)));
  const num = (s: string) => {
    const n = Number(s.replace(',', '.'));
    return s.trim() === '' || !Number.isFinite(n) ? undefined : n;
  };
  const inputs = cols.filter((c) => c.input);
  const canRun = inputs.length > 0 && inputs.every((c) => c.from !== undefined && c.to !== undefined) && !running;

  return (
    <div className="table-panel">
      <section className="card">
        <h3>Columnas</h3>
        <p className="hint">
          Las columnas de <b>entrada</b> toman valores de un rango; las de <b>salida</b> se calculan en cada fila. Si una entrada está fijada en tus ecuaciones
          (por ejemplo <code>T3 = 480 [C]</code>), la tabla la reemplaza automáticamente.
        </p>
        {cols.length === 0 && <p className="muted">Agrega al menos una variable de entrada y una de salida.</p>}
        <div className="cols">
          {cols.map((c, i) => {
            const unit = unitOf(c.name);
            const exists = byKey.has(c.name.toLowerCase());
            return (
              <div className={`col-row ${exists ? '' : 'missing'}`} key={c.name + i}>
                <span className="var">{byKey.get(c.name.toLowerCase())?.name ?? c.name}</span>
                <div className="seg" role="group" aria-label={`Tipo de columna ${c.name}`}>
                  <button className={c.input ? 'on' : ''} onClick={() => update(i, { input: true })}>
                    Entrada
                  </button>
                  <button className={!c.input ? 'on' : ''} onClick={() => update(i, { input: false })}>
                    Salida
                  </button>
                </div>
                {c.input ? (
                  <span className="range">
                    de <input aria-label="desde" defaultValue={c.from ?? ''} key={`f${c.from}`} onBlur={(e) => update(i, { from: num(e.target.value) })} />
                    a <input aria-label="hasta" defaultValue={c.to ?? ''} key={`t${c.to}`} onBlur={(e) => update(i, { to: num(e.target.value) })} />
                    <span className="unit">{unit}</span>
                  </span>
                ) : (
                  <span className="range muted">{unit && `en ${unit}`}</span>
                )}
                <button className="icon-btn" data-tip={`Quitar ${c.name}`} aria-label={`Quitar ${c.name}`} onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))}>
                  ×
                </button>
                {!exists && <span className="warn-text">no aparece en las ecuaciones</span>}
              </div>
            );
          })}
        </div>
        <div className="table-actions">
          <select
            value=""
            onChange={(e) => e.target.value && setCols((c) => [...c, { name: e.target.value, input: c.every((x) => !x.input) }])}
            aria-label="Agregar columna"
            disabled={!available.length}
          >
            <option value="">+ Agregar variable…</option>
            {available
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
              .map((v) => (
                <option key={v.name}>{v.name}</option>
              ))}
          </select>
          <label className="rows-input">
            Filas
            <input
              type="number"
              min={2}
              max={500}
              value={doc.table.rows}
              onChange={(e) => setDoc((d) => ({ ...d, table: { ...d.table, rows: Math.max(1, Math.min(500, Number(e.target.value) || 1)) } }))}
            />
          </label>
          <span className="spacer" />
          {running ? (
            <button className="btn" onClick={props.onCancel}>
              Detener cálculo
            </button>
          ) : (
            <button className="btn primary" disabled={!canRun} onClick={props.onRun}>
              Calcular tabla
            </button>
          )}
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Resultados de la tabla</h3>
            <button className="btn small" onClick={props.onExport} disabled={running}>
              Exportar CSV
            </button>
          </div>
          <div className="table-wrap framed">
            <table className="grid">
              <thead>
                <tr>
                  <th className="num">#</th>
                  {cols.map((c) => (
                    <th key={c.name} className={`num ${c.input ? 'in-col' : ''}`}>
                      {byKey.get(c.name.toLowerCase())?.name ?? c.name}
                      <div className="unit">{unitOf(c.name) || '-'}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r && !r.ok ? 'row-error' : ''} title={r?.error}>
                    <td className="num muted">{i + 1}</td>
                    {cols.map((c) => (
                      <td key={c.name} className="num">
                        {r ? fmt(siToUnit(r.values[c.name.toLowerCase()], unitOf(c.name))) : <span className="muted">…</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r && !r.ok) && (
            <ul className="row-errors">
              {rows.map((r, i) =>
                r && !r.ok ? (
                  <li key={i}>
                    <b>Fila {i + 1}:</b> {r.error}
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
