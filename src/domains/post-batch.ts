import type { PostAudience } from '../types.js';

export type ItemStatus =
  | 'pending'
  | 'in-flight'
  | 'created'
  | 'skipped'
  | 'failed'
  | 'uncertain'
  | 'not-attempted';
export interface BatchReceipt {
  owner?: string;
  runId: string;
  createdAt: number;
  expiresAt?: number;
  rkey?: string;
  cid?: string;
  recordCreatedAt?: string;
}
export interface BatchItem {
  did: string;
  handle: string;
  status: ItemStatus;
  detail?: string;
  receipt?: BatchReceipt;
  undo?: {
    status: 'pending' | 'in-flight' | 'undone' | 'skipped' | 'failed' | 'uncertain';
    detail?: string;
  };
}
export interface BatchInput {
  owner: string;
  sourcePost: string;
  audience: PostAudience;
  action: 'block' | 'mute';
  durationMs: number;
  confirmed: boolean;
  targets: Array<{ did: string; handle: string }>;
}
export interface BatchRun extends Omit<BatchInput, 'targets' | 'confirmed'> {
  id: string;
  confirmedAt: number;
  updatedAt: number;
  state: 'running' | 'stopping' | 'stopped' | 'completed' | 'paused' | 'undoing';
  error?: string;
  items: BatchItem[];
}
export interface BatchStore {
  load(): Promise<BatchRun[]>;
  save(runs: BatchRun[]): Promise<void>;
}
export interface BatchAdapter {
  owner(): Promise<string | undefined>;
  create(
    run: BatchRun,
    item: BatchItem,
    beforeRequest: () => Promise<void>
  ): Promise<{
    status: 'created' | 'skipped' | 'failed' | 'uncertain';
    detail?: string;
    receipt?: BatchReceipt;
  }>;
  undo(
    run: BatchRun,
    item: BatchItem,
    beforeRequest: () => Promise<void>
  ): Promise<{ status: 'undone' | 'skipped' | 'failed' | 'uncertain'; detail?: string }>;
}
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const persistenceFailure = 'Outcome storage failed. No further requests will run.';
const active = (run: BatchRun): boolean => ['running', 'stopping', 'undoing'].includes(run.state);
const hasUnresolvedItems = (run: BatchRun): boolean =>
  run.items.some(
    (item) =>
      ['pending', 'in-flight', 'uncertain'].includes(item.status) ||
      (item.undo && ['pending', 'in-flight', 'uncertain'].includes(item.undo.status))
  );
const incomplete = (run: BatchRun): boolean =>
  active(run) ||
  run.items.some(
    (item) =>
      ['pending', 'in-flight', 'uncertain'].includes(item.status) ||
      (item.undo && ['pending', 'in-flight', 'uncertain', 'failed'].includes(item.undo.status))
  );

/** Only journal transitions are serialized. Stop remains available during the network request. */
export class BatchRunner {
  private queue: Promise<unknown> = Promise.resolve();
  private working = false;
  private persistenceError?: string;
  private knownOutcomes = new Map<string, Partial<BatchItem>>();
  constructor(
    private store: BatchStore,
    private adapter: BatchAdapter
  ) {}
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async load(): Promise<BatchRun[]> {
    try {
      return await this.store.load();
    } catch {
      this.persistenceError = persistenceFailure;
      throw new Error(persistenceFailure);
    }
  }
  private async save(runs: BatchRun[]): Promise<void> {
    try {
      await this.store.save(runs);
    } catch {
      this.persistenceError = persistenceFailure;
      throw new Error(persistenceFailure);
    }
  }
  async list(): Promise<BatchRun[]> {
    return this.locked(async () =>
      (await this.load()).map((run) => {
        for (const item of run.items) {
          const known = this.knownOutcomes.get(`${run.id}:${item.did}`);
          if (known) Object.assign(item, known);
        }
        return this.persistenceError && active(run)
          ? { ...run, error: this.persistenceError }
          : run;
      })
    );
  }
  async start(input: BatchInput): Promise<string> {
    return this.locked(async () => {
      if (this.persistenceError) throw new Error(this.persistenceError);
      if (!input.confirmed) throw new Error('Confirm the selected accounts first');
      if (!input.targets.length || input.targets.length > 5000)
        throw new Error('Select between 1 and 5000 accounts');
      if (new Set(input.targets.map((i) => i.did)).size !== input.targets.length)
        throw new Error('Remove duplicate accounts');
      if (
        !input.owner.startsWith('did:') ||
        input.targets.some(
          (i) =>
            !i.did.startsWith('did:') || !i.handle || i.did.length > 256 || i.handle.length > 256
        )
      )
        throw new Error('Invalid account selection');
      if (
        !['quotes', 'likes', 'reposts'].includes(input.audience) ||
        !['block', 'mute'].includes(input.action) ||
        !/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/.test(input.sourcePost)
      )
        throw new Error('Invalid post or audience');
      if (
        input.durationMs !== -1 &&
        (!Number.isFinite(input.durationMs) ||
          input.durationMs <= 0 ||
          input.durationMs >= 365 * 86400000)
      )
        throw new Error('Invalid duration');
      if ((await this.adapter.owner()) !== input.owner)
        throw new Error('Account changed. Review and confirm again.');
      if (this.persistenceError) throw new Error(this.persistenceError);
      const runs = await this.load();
      if (runs.some((run) => active(run) || run.state === 'paused'))
        throw new Error('An unfinished operation exists. Stop it and review its outcomes first.');
      const { targets, owner, sourcePost, audience, action, durationMs } = input;
      const run: BatchRun = {
        owner,
        sourcePost,
        audience,
        action,
        durationMs,
        id: crypto.randomUUID(),
        confirmedAt: Date.now(),
        updatedAt: Date.now(),
        state: 'running',
        items: targets.map((target) => ({ ...target, status: 'pending' })),
      };
      // Never evict unfinished work. Retain the newest ten operations within the byte budget.
      const retained = [...runs];
      while (retained.length >= 10) {
        const removable = retained.findIndex((entry) => !incomplete(entry));
        if (removable < 0)
          throw new Error(
            'Operation history is full of unresolved outcomes. No history was removed.'
          );
        retained.splice(removable, 1);
      }
      await this.save([...retained, run]);
      return run.id;
    });
  }
  async stop(id: string): Promise<void> {
    await this.locked(async () => {
      if (this.persistenceError) throw new Error(this.persistenceError);
      const runs = await this.load();
      const run = runs.find((r) => r.id === id);
      if (!run) throw new Error('Operation not found');
      const inFlight = run.items.some(
        (i) => i.status === 'in-flight' || i.undo?.status === 'in-flight'
      );
      for (const item of run.items) {
        if (item.status === 'pending') item.status = 'not-attempted';
        if (item.undo?.status === 'pending')
          item.undo = { status: 'skipped', detail: 'Stopped before undo' };
      }
      run.state = inFlight ? 'stopping' : 'stopped';
      run.updatedAt = Date.now();
      await this.save(runs);
    });
  }
  async recover(): Promise<void> {
    await this.locked(async () => {
      const runs = await this.load();
      let changed = false;
      for (const run of runs) {
        const unresolved = hasUnresolvedItems(run);
        if (!active(run) && !unresolved) continue;
        changed = true;
        run.state = 'paused';
        run.error =
          'Background interrupted. Uncertain requests will not be retried. Review the outcomes; stop this operation to leave remaining accounts untouched.';
        for (const item of run.items) {
          if (item.status === 'in-flight') {
            item.status = 'uncertain';
            item.detail =
              'Interrupted after intent was saved; check Bluesky before taking further action.';
          }
          if (item.undo?.status === 'in-flight')
            item.undo = { status: 'uncertain', detail: 'Undo interrupted; no automatic retry.' };
        }
      }
      if (changed) await this.save(runs);
    });
  }
  async undo(id: string, confirmed: boolean): Promise<void> {
    await this.locked(async () => {
      if (!confirmed) throw new Error('Confirm undo first');
      if (this.persistenceError) throw new Error(this.persistenceError);
      const runs = await this.load();
      const run = runs.find((r) => r.id === id);
      if (!run) throw new Error('Operation not found');
      if (runs.some(active)) throw new Error('Stop the current operation before undo');
      if ((await this.adapter.owner()) !== run.owner)
        throw new Error('Switch to the account that created this operation');
      if (run.items.some((i) => i.status === 'pending'))
        throw new Error('Stop the operation before undo');
      for (const item of run.items)
        if (item.status === 'created' && item.receipt && !item.undo)
          item.undo = { status: 'pending' };
      run.state = run.items.some((i) => i.undo?.status === 'pending') ? 'undoing' : run.state;
      run.updatedAt = Date.now();
      await this.save(runs);
    });
  }
  /** One bounded account per wake; no replay of in-flight work, even within this worker. */
  async step(): Promise<boolean> {
    if (this.working || this.persistenceError) return false;
    this.working = true;
    try {
      const intent = await this.locked(async () => {
        if (this.persistenceError) throw new Error(this.persistenceError);
        const runs = await this.load();
        const run = runs.find((r) => r.state === 'running' || r.state === 'undoing');
        if (!run) return null;
        if ((await this.adapter.owner()) !== run.owner) {
          run.state = 'paused';
          run.error = 'Account changed. No further requests will run.';
          await this.save(runs);
          return null;
        }
        const undo = run.state === 'undoing';
        const item = run.items.find((i) =>
          undo ? i.undo?.status === 'pending' : i.status === 'pending'
        );
        if (!item) {
          if (hasUnresolvedItems(run)) {
            run.state = 'paused';
            run.error = 'Unresolved outcomes remain. Review the operation before continuing.';
          } else run.state = 'completed';
          await this.save(runs);
          return null;
        }
        if (undo) item.undo = { status: 'in-flight' };
        else item.status = 'in-flight';
        run.updatedAt = Date.now();
        await this.save(runs);
        return { run: structuredClone(run), item: structuredClone(item), undo };
      });
      if (!intent) return false;
      let outcome;
      const beforeRequest = async () => {
        if (this.persistenceError) throw new Error(this.persistenceError);
        const run = (await this.load()).find((entry) => entry.id === intent.run.id);
        if (!run || !['running', 'undoing'].includes(run.state))
          throw new Error('Stopped before the next request');
        if ((await this.adapter.owner()) !== intent.run.owner)
          throw new Error('Account changed before request');
      };
      try {
        outcome = intent.undo
          ? await this.adapter.undo(intent.run, intent.item, beforeRequest)
          : await this.adapter.create(intent.run, intent.item, beforeRequest);
      } catch (error) {
        outcome = { status: 'uncertain' as const, detail: message(error) };
      }
      return await this.locked(async () => {
        const known: Partial<BatchItem> = intent.undo
          ? { undo: outcome as NonNullable<BatchItem['undo']> }
          : (outcome as Partial<BatchItem>);
        if (this.persistenceError) {
          this.knownOutcomes.set(`${intent.run.id}:${intent.item.did}`, known);
          throw new Error(this.persistenceError);
        }
        let runs: BatchRun[];
        try {
          runs = await this.load();
        } catch (error) {
          this.knownOutcomes.set(`${intent.run.id}:${intent.item.did}`, known);
          throw error;
        }
        const run = runs.find((r) => r.id === intent.run.id);
        if (!run) throw new Error('Operation journal disappeared');
        const item = run.items.find((i) => i.did === intent.item.did);
        if (!item) throw new Error('Account journal disappeared');
        if (intent.undo) item.undo = outcome as NonNullable<BatchItem['undo']>;
        else Object.assign(item, outcome);
        if (outcome.status === 'uncertain') {
          run.state = 'paused';
          run.error = outcome.detail || 'Uncertain outcome; no automatic retry.';
        } else if (run.state === 'stopping') run.state = 'stopped';
        else if (
          !run.items.some((i) =>
            intent.undo ? i.undo?.status === 'pending' : i.status === 'pending'
          )
        )
          run.state = hasUnresolvedItems(run) ? 'paused' : 'completed';
        run.updatedAt = Date.now();
        await this.save(runs);
        return run.state === 'running' || run.state === 'undoing';
      });
    } finally {
      this.working = false;
    }
  }
}
