import { useMemo, useState } from 'react';
import { fluidLabel, type Lang } from '../engine';
import { defaultUnit, fmt, siToUnit, unitChoices, unitToSi } from './format';
import { TEMPLATES, fieldDim, makeWriter, stateDefault, type Field, type Template, type Values } from './templates';

export type InsertMode = 'new' | 'append';

/** Converts a value given in `fromUnit` to the default unit of the current unit system. */
function inSystem(value: number, fromUnit: string, f: Field, v: Values) {
  const dim = fieldDim(f, v);
  if (!dim || !fromUnit || fromUnit === '-') return { value: String(value), unit: fromUnit || '-' };
  const unit = defaultUnit(dim);
  return { value: fmt(siToUnit(unitToSi(value, fromUnit), unit), 5), unit };
}

function initialValues(t: Template): Values {
  const v: Values = {};
  for (const f of t.fields) v[f.key] = { value: String(f.def), unit: f.unit ?? '' };
  for (const f of t.fields) if (f.kind === 'number') v[f.key] = inSystem(Number(f.def), f.unit ?? '', f, v);
  return v;
}

const parseNum = (s: string) => {
  const t = s.trim().replace(',', '.');
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null;
};

export function Assistant(props: { lang: Lang; canAppend: boolean; onInsert: (src: string, title: string, mode: InsertMode) => void }) {
  const [tpl, setTpl] = useState<Template | null>(null);
  const [values, setValues] = useState<Values>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<InsertMode>('new');
  const [triedSubmit, setTriedSubmit] = useState(false);

  const choose = (t: Template) => {
    setTpl(t);
    setValues(initialValues(t));
    setTouched({});
    setTriedSubmit(false);
  };

  const fieldErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!tpl) return e;
    for (const f of tpl.fields) if (f.kind === 'number' && parseNum(values[f.key]?.value ?? '') === null) e[f.key] = 'Escribe un número, por ejemplo 250 o 0.85.';
    return e;
  }, [tpl, values]);
  const formError = tpl && !Object.keys(fieldErrors).length ? (tpl.validate?.(values) ?? null) : null;

  const code = useMemo(() => {
    if (!tpl || Object.keys(fieldErrors).length) return '';
    const clean: Values = {};
    for (const [k, x] of Object.entries(values)) clean[k] = { ...x, value: x.value.trim().replace(',', '.') };
    return tpl.build(clean, makeWriter(clean, props.lang));
  }, [tpl, values, fieldErrors, props.lang]);

  if (!tpl) {
    return (
      <div className="assistant">
        <p className="lead">Elige el tipo de problema. Te pediré los datos y escribiré las ecuaciones por ti, con comentarios que explican cada paso.</p>
        <ul className="tpl-list">
          {TEMPLATES.map((t, i) => (
            <li key={t.id}>
              <button className="tpl" onClick={() => choose(t)} data-autofocus={i === 0 ? true : undefined}>
                <span className="tpl-title">{t.title}</span>
                <span className="tpl-desc">{t.desc}</span>
                <span className="tpl-go" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">¿Ya sabes lo que quieres escribir? Cierra el asistente y escribe directo en el editor; la pestaña Ayuda tiene todas las funciones.</p>
      </div>
    );
  }

  const set = (key: string, patch: Partial<{ value: string; unit: string }>) =>
    setValues((v) => {
      const next = { ...v, [key]: { ...v[key], ...patch } };
      // "Propiedades de un estado": when the chosen property changes, reset its value field
      if (tpl.id === 'estado' && (key === 'p1' || key === 'p2') && patch.value) {
        const target = key === 'p1' ? 'v1' : 'v2';
        const d = stateDefault(patch.value);
        const f = tpl.fields.find((x) => x.key === target)!;
        next[target] = inSystem(d.value, d.unit, f, next);
      }
      return next;
    });

  const changeUnit = (f: Field, unit: string) => {
    const cur = values[f.key];
    const n = parseNum(cur.value);
    const value = n === null || !cur.unit || cur.unit === '-' ? cur.value : fmt(siToUnit(unitToSi(n, cur.unit), unit), 5);
    set(f.key, { unit, value });
  };

  const submit = () => {
    setTriedSubmit(true);
    if (Object.keys(fieldErrors).length || formError) return;
    props.onInsert(code, tpl.title, props.canAppend ? mode : 'new');
  };

  return (
    <div className="assistant">
      <button className="link-btn" onClick={() => setTpl(null)} data-autofocus>
        ‹ Elegir otro problema
      </button>
      <h3 className="tpl-heading">{tpl.title}</h3>
      <p className="lead">{tpl.desc}</p>
      <details className="assumptions">
        <summary>Qué se supone</summary>
        <ul>
          {tpl.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>

      <form
        className="tpl-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        {tpl.fields.map((f) => {
          const id = `as-${tpl.id}-${f.key}`;
          const v = values[f.key];
          if (!v) return null;
          const err = (touched[f.key] || triedSubmit) && fieldErrors[f.key];
          if (f.kind !== 'number') {
            return (
              <div className="field" key={f.key}>
                <label htmlFor={id}>{f.label}</label>
                <select id={id} value={v.value} onChange={(e) => set(f.key, { value: e.target.value })}>
                  {f.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {f.kind === 'fluid' ? fluidLabel(o.value, props.lang) : o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          const dim = fieldDim(f, values);
          const choices = unitChoices(dim);
          return (
            <div className={`field ${err ? 'has-error' : ''}`} key={f.key}>
              <label htmlFor={id}>{f.label}</label>
              <div className="field-row">
                <input
                  id={id}
                  inputMode="decimal"
                  value={v.value}
                  aria-invalid={!!err}
                  aria-describedby={err ? `${id}-err` : undefined}
                  onChange={(e) => {
                    set(f.key, { value: e.target.value });
                    setTouched((t) => ({ ...t, [f.key]: false }));
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))}
                />
                {choices.length > 1 ? (
                  <select aria-label={`Unidades de ${f.label}`} value={v.unit} onChange={(e) => changeUnit(f, e.target.value)}>
                    {choices.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <span className="unit">{v.unit === '-' ? '' : v.unit}</span>
                )}
              </div>
              {err && (
                <p className="field-error" id={`${id}-err`}>
                  {err}
                </p>
              )}
            </div>
          );
        })}

        {formError && <p className="field-error">{formError}</p>}

        {code && (
          <details className="preview">
            <summary>Ver las ecuaciones que se van a escribir</summary>
            <pre>{code}</pre>
          </details>
        )}

        {props.canAppend && (
          <fieldset className="radio-group">
            <legend>Dónde escribirlas</legend>
            <label>
              <input type="radio" name="as-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> En un documento nuevo
            </label>
            <label>
              <input type="radio" name="as-mode" checked={mode === 'append'} onChange={() => setMode('append')} /> Al final de mis ecuaciones
            </label>
            {mode === 'append' && <p className="hint">Revisa que los nombres de variables no se repitan con los que ya tienes (por ejemplo T1 o h1).</p>}
          </fieldset>
        )}

        <button type="submit" className="btn primary block">
          Escribir ecuaciones y resolver
        </button>
      </form>
    </div>
  );
}
