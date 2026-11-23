import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, type StringStream } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { setDiagnostics, lintGutter, type Diagnostic as CMDiag } from '@codemirror/lint';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { FLUID_LIST, HA_FUNCS, PROP_FUNCS, type Diagnostic } from '../engine';

const FUNC_NAMES = new Set([
  ...Object.keys(PROP_FUNCS),
  ...Object.keys(HA_FUNCS),
  'sqrt', 'exp', 'ln', 'log', 'log10', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'abs', 'min', 'max',
]);
const FLUIDS = new Set([...FLUID_LIST.map((f) => f.toLowerCase()), 'steam', 'airh2o']);

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

const COMPLETIONS = [
  ...Object.entries(PROP_FUNCS).map(([k, f]) => ({ label: k, type: 'function', detail: f.desc, apply: `${k}(` })),
  ...Object.entries(HA_FUNCS).map(([k, f]) => ({ label: k, type: 'function', detail: f.desc, apply: `${k}(AirH2O, ` })),
  ...['sqrt', 'exp', 'ln', 'log10', 'sin', 'cos', 'tan', 'abs', 'min', 'max'].map((k) => ({ label: k, type: 'function', apply: `${k}(` })),
  ...FLUID_LIST.map((f) => ({ label: f, type: 'class', detail: 'fluido' })),
  { label: 'AirH2O', type: 'class', detail: 'aire húmedo' },
];

export interface EditorHandle {
  focusLine(line: number): void;
}

export function Editor(props: {
  value: string;
  onChange: (v: string) => void;
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
    const complete = (ctx: CompletionContext) => {
      const w = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
      if (!w || (w.from === w.to && !ctx.explicit)) return null;
      const vars = cb.current.variables.map((v) => ({ label: v, type: 'variable' }));
      return { from: w.from, options: [...COMPLETIONS, ...vars], validFor: /^[A-Za-z0-9_]*$/ };
    };
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
