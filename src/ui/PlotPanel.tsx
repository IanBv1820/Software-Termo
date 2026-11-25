import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, Legend, Tooltip, Filler } from 'chart.js';
import type { TableRow } from '../engine';
import type { VarOut } from '../worker/protocol';
import type { Doc } from './doc';
import { fmt, siToUnit, unitFor } from './format';

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend, Tooltip, Filler);

const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5'];

export function PlotPanel(props: { doc: Doc; setDoc: (f: (d: Doc) => Doc) => void; vars: VarOut[]; rows: (TableRow | null)[]; theme: string; onGoTable: () => void }) {
  const { doc, setDoc, vars, rows } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const cols = doc.table.columns.map((c) => c.name);
  const byKey = new Map(vars.map((v) => [v.name, v]));
  const unitOf = (n: string) => unitFor(byKey.get(n)?.dim ?? null, doc.units[n]);
  const label = (n: string) => {
    const u = unitOf(n);
    return `${byKey.get(n)?.name ?? n}${u && u !== '-' ? ` [${u}]` : ''}`;
  };
  const x = cols.includes(doc.plot.x) ? doc.plot.x : cols[0] ?? '';
  const ys = doc.plot.y.filter((y) => cols.includes(y) && y !== x);
  const done = rows.filter((r): r is TableRow => !!r && r.ok);

  useEffect(() => {
    if (!canvas.current) return;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const data = {
      datasets: ys.map((y, i) => ({
        label: label(y),
        data: done.map((r) => ({ x: siToUnit(r.values[x], unitOf(x)), y: siToUnit(r.values[y], unitOf(y)) })),
        borderColor: v(SERIES[i % SERIES.length]),
        backgroundColor: v(SERIES[i % SERIES.length]),
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.25,
      })),
    };
    const grid = v('--border');
    const text = v('--text-2');
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      interaction: { mode: 'nearest' as const, intersect: false },
      plugins: {
        legend: { display: ys.length > 1, labels: { color: text, usePointStyle: true } },
        tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: { type: 'linear' as const, title: { display: true, text: label(x), color: text }, grid: { color: grid }, ticks: { color: text } },
        y: {
          type: 'linear' as const,
          title: { display: ys.length === 1, text: ys.length === 1 ? label(ys[0]) : '', color: text },
          grid: { color: grid },
          ticks: { color: text },
        },
      },
    };
    if (chart.current) {
      chart.current.data = data;
      chart.current.options = options as any;
      chart.current.update();
    } else {
      chart.current = new Chart(canvas.current, { type: 'line', data, options });
    }
  });
  useEffect(() => () => chart.current?.destroy(), []);

  const download = () => {
    const c = canvas.current;
    if (!c) return;
    // draw on a background so the PNG isn't transparent
    const out = document.createElement('canvas');
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `grafica-${ys.join('-') || 'tabla'}.png`;
    a.click();
  };

  if (cols.length < 2) {
    return (
      <div className="empty">
        <h3>Sin datos para graficar</h3>
        <p>La gráfica usa las columnas de la tabla paramétrica. Arma una tabla con al menos una entrada y una salida.</p>
        <button className="btn primary" onClick={props.onGoTable}>
          Armar tabla paramétrica
        </button>
      </div>
    );
  }

  return (
    <div className="plot-panel">
      <div className="plot-controls">
        <label>
          Eje X
          <select value={x} onChange={(e) => setDoc((d) => ({ ...d, plot: { ...d.plot, x: e.target.value } }))}>
            {cols.map((c) => (
              <option key={c} value={c}>
                {byKey.get(c)?.name ?? c}
              </option>
            ))}
          </select>
        </label>
        <div className="y-picks" role="group" aria-label="Eje Y">
          <span>Eje Y</span>
          {cols
            .filter((c) => c !== x)
            .map((c) => (
              <label key={c} className="chip">
                <input
                  type="checkbox"
                  checked={ys.includes(c)}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, plot: { ...d.plot, x, y: e.target.checked ? [...d.plot.y.filter((y) => y !== c), c] : d.plot.y.filter((y) => y !== c) } }))
                  }
                />
                {byKey.get(c)?.name ?? c}
              </label>
            ))}
        </div>
        <span className="spacer" />
        <button className="btn small" onClick={download} disabled={!done.length || !ys.length}>
          Descargar PNG
        </button>
      </div>
      <div className="chart-box">
        {!done.length && (
          <div className="empty overlay">
            <div>
              <p>La gráfica aparece cuando la tabla paramétrica tiene resultados.</p>
              <button className="btn primary" onClick={props.onGoTable}>
                Ir a la tabla
              </button>
            </div>
          </div>
        )}
        {done.length > 0 && !ys.length && <div className="empty overlay">Elige al menos una variable para el eje Y.</div>}
        <canvas ref={canvas} />
      </div>
    </div>
  );
}
