import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view';
import { EditorState, Prec, StateField } from '@codemirror/state';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, type StringStream } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { setDiagnostics, lintGutter, type Diagnostic as CMDiag } from '@codemirror/lint';
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { FLUID_ES, FLUID_LIST, FUNC_ES, HA_FUNCS, PROP_FUNCS, fluidLabel, type Diagnostic, type Lang } from '../engine';
import { enclosingCall, findFunction, functionCatalog, matchFunction, norm, paramLabels, type FnInfo } from './signatures';

const FUNC_NAMES = new Set([
  ...Object.keys(PROP_FUNCS),
  ...Object.keys(HA_FUNCS),
  ...Object.keys(FUNC_ES),
  'sqrt', 'exp', 'ln', 'log', 'log10', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'abs', 'min', 'max',
]);
const FLUIDS = new Set([...FLUID_LIST.map((f) => f.toLowerCase()), ...Object.keys(FLUID_ES), 'steam', 'airh2o']);

type LexState = { inComment: '"' | '}' | null };
function tok(stream: StringStream, state: LexState): string | null {
    if (state.inComment) {
      const close = state.inComment;
      while (!stream.eol()) {
        if (stream.next() === close) {
          state.inComment = null;
          break;
        }
      }
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (ch === '"' || ch === '{') {
      stream.next();
      state.inComment = ch === '"' ? '"' : '}';
      return tok(stream, state);
    }
    if (stream.match('//') || ch === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\[[^\]\n]*\]/)) return 'unit';
    if (stream.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^'[^'\n]*'/)) return 'string';
    const id = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (id) {
      const w = id[0].toLowerCase();
      if (FUNC_NAMES.has(w) && stream.peek() === '(') return 'function';
      if (FLUIDS.has(w)) return 'fluid';
      return 'variable';
    }
  stream.next();
  return 'operator';
}

const lang = StreamLanguage.define<LexState>({
  startState: () => ({ inComment: null }),
  token: tok,
  tokenTable: { unit: t.unit, function: t.function(t.variableName), fluid: t.className },
});

const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.unit, color: 'var(--syn-unit)' },
  { tag: t.function(t.variableName), color: 'var(--syn-func)', fontWeight: '600' },
  { tag: t.className, color: 'var(--syn-fluid)' },
  { tag: t.operator, color: 'var(--syn-op)' },
  { tag: t.string, color: 'var(--syn-fluid)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--text-3)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'white' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
});

type Group = 'var' | 'prop' | 'ha' | 'math' | 'fluid';

function fluidOptions(lang: Lang) {
  const ha = fluidLabel('AirH2O', lang);
  return [
    ...FLUID_LIST.map((f) => ({ label: fluidLabel(f, lang), alt: f, detail: lang === 'es' ? 'fluido' : 'fluid' })),
    { label: ha, alt: 'AirH2O', detail: lang === 'es' ? 'aire húmedo' : 'humid air' },
  ];
}

/** Our own matching and ranking, so typing a property in words ("ent", "entropia", "volumen")
 *  offers the normal property (h_esp, s_esp, v_esp…) first and the humid-air one after it. */
function completionSource(ctx: CompletionContext, lang: Lang, variables: string[]): CompletionResult | null {
  const w = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  const typed = w.text;
  const q = norm(typed);
  const line = ctx.state.doc.lineAt(w.from);
  const call = enclosingCall(line.text, w.from - line.from);
  const callFn = call ? findFunction(call.name, lang) : undefined;
  const fluidSlot = !!callFn && callFn.kind !== 'math' && call!.arg === 0;
  const ha = fluidLabel('AirH2O', lang);

  const order: Record<Group, number> = fluidSlot
    ? { fluid: 0, var: 1, prop: 2, ha: 3, math: 4 }
    : { var: 0, prop: 1, ha: 2, math: 3, fluid: 4 };
  const scored: Array<{ c: Completion; score: number; group: Group; i: number; hl: boolean }> = [];
  // prefix matches score 3, description words 2, substring 1
  let i = 0;

  for (const f of functionCatalog(lang)) {
    const m = matchFunction(f, typed);
    if (!m.score) continue;
    const apply = f.kind === 'ha' ? `${f.name}(${ha}, ` : `${f.name}(`;
    scored.push({
      c: {
        label: f.name,
        type: 'function',
        detail: m.via && m.score === 3 ? `${m.via} · ${f.desc}` : f.desc,
        apply,
        info: () => signatureCard(f, -1, lang, true),
      },
      score: m.score,
      group: f.kind,
      i: i++,
      hl: !!m.primary,
    });
  }
  for (const fl of fluidOptions(lang)) {
    const n = norm(fl.label);
    const s = n.startsWith(q) || norm(fl.alt).startsWith(q) ? 3 : q.length >= 2 && n.includes(q) ? 1 : 0;
    if (s) scored.push({ c: { label: fl.label, type: 'class', detail: fl.detail }, score: s, group: 'fluid', i: i++, hl: n.startsWith(q) });
  }
  for (const v of variables) {
    if (v === typed) continue;
    const n = v.toLowerCase();
    const s = n.startsWith(q) ? 3 : q.length >= 2 && n.includes(q) ? 1 : 0;
    if (s) scored.push({ c: { label: v, type: 'variable' }, score: s, group: 'var', i: i++, hl: n.startsWith(q) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || order[a.group] - order[b.group] || Number(b.hl) - Number(a.hl) || a.i - b.i);
  const highlight = new Set(scored.filter((x) => x.hl).map((x) => x.c));
  return {
    from: w.from,
    options: scored.map((x) => x.c),
    filter: false,
    getMatch: (c) => (highlight.has(c) ? [0, typed.length] : []),
  };
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** The box with a function's arguments. `active` = argument the cursor is in (-1 = none). */
function signatureCard(f: FnInfo, active: number, lang: Lang, full: boolean): HTMLElement {
  const es = lang === 'es';
  const box = el('div', 'sig');
  const sig = el('div', 'sig-line');
  sig.append(el('span', 'sig-name', f.name), '(');
  const labels = paramLabels(f);
  const act = f.variadic ? Math.min(active, labels.length - 2) : active;
  labels.forEach((p, k) => {
    if (k) sig.append(', ');
    sig.append(el('span', k === act ? 'sig-param active' : 'sig-param', p));
  });
  sig.append(')');
  box.append(sig);
  box.append(el('div', 'sig-desc', f.desc));

  const inInputs = f.inputs && active >= 1;
  if (f.inputs && (full || inInputs)) {
    const head = el('div', 'sig-head', es ? `Entradas (elige ${f.nInputs})` : `Inputs (pick ${f.nInputs})`);
    const grid = el('div', 'sig-inputs');
    for (const [k, meaning] of f.inputs) {
      const row = el('div', 'sig-input');
      row.append(el('code', undefined, `${k}=`), el('span', undefined, meaning));
      grid.append(row);
    }
    box.append(head, grid);
  } else if (active === 0 && f.params[0]?.doc) {
    box.append(el('div', 'sig-note', `${f.params[0].name}: ${f.params[0].doc}`));
  }
  if (f.note && (full || inInputs)) box.append(el('div', 'sig-note', f.note));
  if (full || active < 0) {
    const ex = el('div', 'sig-example');
    ex.append(el('span', 'sig-head', es ? 'Ejemplo' : 'Example'), el('code', undefined, f.example));
    box.append(ex);
  }
  if (full && f.aliases.length) {
    box.append(el('div', 'sig-alias', (es ? 'También se puede escribir: ' : 'Also accepted: ') + f.aliases.join(', ')));
  }
  return box;
}

/** Argument hint shown above the cursor while typing inside a function call. */
function signatureHint(getLang: () => Lang) {
  type Hint = { tip: Tooltip; key: string } | null;
  const compute = (state: EditorState): Hint => {
    const sel = state.selection.main;
    if (!sel.empty) return null;
    const line = state.doc.lineAt(sel.head);
    const call = enclosingCall(line.text, sel.head - line.from);
    if (!call) return null;
    const lang = getLang();
    const f = findFunction(call.name, lang);
    if (!f) return null;
    const pos = line.from + call.nameStart;
    return {
      key: `${pos}:${f.canon}:${call.arg}:${lang}`,
      tip: {
        pos,
        above: true,
        arrow: false,
        create: () => {
          const dom = el('div', 'sig-tooltip');
          dom.append(signatureCard(f, call.arg, lang, false));
          return { dom };
        },
      },
    };
  };
  return StateField.define<Hint>({
    create: compute,
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      const next = compute(tr.state);
      // keep the same tooltip while nothing visible changed, to avoid flicker
      return value && next && value.key === next.key ? value : next;
    },
    provide: (f) => showTooltip.from(f, (h) => h?.tip ?? null),
  });
}

export interface EditorHandle {
  focusLine(line: number): void;
}

export function Editor(props: {
  value: string;
  onChange: (v: string) => void;
  lang: Lang;
  onRun: () => void;
  diagnostics: Diagnostic[];
  variables: string[];
  handleRef?: React.MutableRefObject<EditorHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    const complete = (ctx: CompletionContext) => completionSource(ctx, cb.current.lang, cb.current.variables);
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: 'Mod-Enter', run: () => (cb.current.onRun(), true) },
              { key: 'F2', run: () => (cb.current.onRun(), true) },
            ]),
          ),
          basicSetup,
          lang,
          syntaxHighlighting(highlight),
          theme,
          lintGutter(),
          autocompletion({ override: [complete] }),
          signatureHint(() => cb.current.lang),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    if (props.handleRef)
      props.handleRef.current = {
        focusLine(line: number) {
          const l = v.state.doc.line(Math.min(Math.max(line, 1), v.state.doc.lines));
          v.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
          v.focus();
        },
      };
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external value changes (examples, file open)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
    }
  }, [props.value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const len = v.state.doc.length;
    const diags: CMDiag[] = props.diagnostics
      .filter((d) => d.pos)
      .map((d) => ({
        from: Math.min(d.pos!.from, len),
        to: Math.min(Math.max(d.pos!.to, d.pos!.from + 1), len),
        severity: d.severity,
        message: d.message,
      }));
    v.dispatch(setDiagnostics(v.state, diags));
  }, [props.diagnostics]);

  return <div className="editor" ref={host} />;
}
