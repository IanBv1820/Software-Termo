import { useCallback, useEffect, useRef, useState } from 'react';
import type { Request, Response } from '../worker/protocol';

type Pending = (r: Response) => void;
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/** Owns the solver Web Worker and exposes a promise-based API. */
export function useSolver() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, { resolve: Pending; onRow?: Pending }>());
  const nextId = useRef(1);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('../worker/solver.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<Response>) => {
      const m = ev.data;
      if (m.type === 'ready') return setReady(true);
      if (m.type === 'fatal') return setFatal(m.message);
      const p = pending.current.get(m.id);
      if (!p) return;
      if (m.type === 'tableRow') return p.onRow?.(m);
      pending.current.delete(m.id);
      p.resolve(m);
    };
    w.onerror = (e) => setFatal(`Error en el motor de cálculo: ${e.message}`);
    return () => w.terminate();
  }, []);

  const call = useCallback(<T extends Response>(req: DistributiveOmit<Request, 'id'>, onRow?: Pending): Promise<T> => {
    const id = nextId.current++;
    return new Promise<T>((resolve) => {
      pending.current.set(id, { resolve: resolve as Pending, onRow });
      workerRef.current!.postMessage({ ...req, id } as Request);
    });
  }, []);

  /** Abort whatever is running (e.g. a long table) by restarting the worker. */
  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    for (const [id, p] of pending.current) p.resolve({ type: 'solved', id, ok: false, diagnostics: [{ severity: 'error', message: 'Cálculo cancelado' }], vars: [], stats: null });
    pending.current.clear();
    setReady(false);
    const w = new Worker(new URL('../worker/solver.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = workerRef.current!.onmessage;
    w.onerror = workerRef.current!.onerror;
    workerRef.current = w;
  }, []);

  return { ready, fatal, call, cancel };
}
