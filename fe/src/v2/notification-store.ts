import { canonical, StorageFailure } from '../background/durable-state';
import { MAX_DELIVERY_ATTEMPTS } from '../background/delivery-retry';
import { UUID4 } from './contract';
import { validNotification, type NotificationReceipt } from './notifications';
import type { V2State } from './state';

export type ReceiptScope = { participantId: string; consentId: string };
export type ReceiptSource = ReceiptScope & { sessionId: string };
export type ReceiptLeg = 'shown' | 'selection';
const phases = ['pending', 'sending', 'retry-wait', 'acknowledged', 'exhausted', 'rejected', 'access-blocked', 'privacy-blocked'] as const;
export type ReceiptPhase = typeof phases[number];
export type ReceiptDelivery = { phase: ReceiptPhase; attempts: number; nextRetryAt?: number; code?: string; status?: number };
export interface OutboxReceipt extends NotificationReceipt, ReceiptSource {
  apiOrigin: string;
  shownDelivery: ReceiptDelivery;
  selectionDelivery?: ReceiptDelivery;
  feedbackId?: string;
}

export const receiptDelivery = (entry: OutboxReceipt, leg: ReceiptLeg) => leg === 'shown' ? entry.shownDelivery : entry.selectionDelivery;
export const initialDelivery = (ack = false): ReceiptDelivery => ({ phase: ack ? 'acknowledged' : 'pending', attempts: 0 });
const PREFIX = 'notification/';
const between = (prefix: string) => IDBKeyRange.bound(prefix, prefix + '\uffff');
const validScope = (scope: { participantId?: string; consentId?: string | null } | undefined): scope is ReceiptScope =>
  !!scope?.participantId && UUID4.test(scope.participantId) && !!scope.consentId && UUID4.test(scope.consentId);
const validDelivery = (value: ReceiptDelivery | undefined, ack: boolean) => !!value && phases.includes(value.phase)
  && Number.isInteger(value.attempts) && value.attempts >= 0 && value.attempts <= MAX_DELIVERY_ATTEMPTS
  && (value.phase === 'acknowledged') === ack
  && (['sending', 'retry-wait'].includes(value.phase) ? value.attempts > 0 && Number.isFinite(value.nextRetryAt) : value.nextRetryAt === undefined)
  && (value.code === undefined || /^[A-Z0-9_]{1,48}$/.test(value.code))
  && (value.status === undefined || Number.isInteger(value.status) && value.status >= 300 && value.status <= 599);

export class NotificationStore {
  readonly origin: string;
  private readonly prefix: string;
  private cachedList?: { key: string; entries: Promise<OutboxReceipt[]> };
  constructor(apiBaseUrl: string, private open: () => Promise<IDBDatabase>) {
    this.origin = new URL(apiBaseUrl).origin;
    this.prefix = PREFIX + encodeURIComponent(this.origin) + '/';
  }
  private ownerKey(participantId: string) { return this.prefix + participantId + '/'; }
  private scopeKey(scope: ReceiptScope) { return this.ownerKey(scope.participantId) + scope.consentId + '/'; }
  private sessionKey(source: ReceiptSource) { return this.scopeKey(source) + source.sessionId + '/'; }
  private key(source: ReceiptSource, alertId: string) { return this.sessionKey(source) + alertId; }
  private ownerBlock(scope: ReceiptScope) { return this.ownerKey(scope.participantId) + '!withdrawn'; }
  private sessionBlock(source: ReceiptSource) { return this.sessionKey(source) + '!blocked'; }

  source(state: V2State): ReceiptSource | undefined {
    if (!validScope(state.owner) || !state.session?.sessionId || !UUID4.test(state.session.sessionId)) return;
    return { participantId: state.owner.participantId, consentId: state.owner.consentId, sessionId: state.session.sessionId };
  }
  private check(entry: OutboxReceipt, key: IDBValidKey) {
    if (!validScope(entry) || !UUID4.test(entry.sessionId) || entry.apiOrigin !== this.origin || !validNotification(entry)
      || this.key(entry, entry.alertId) !== key || !validDelivery(entry.shownDelivery, entry.shownAck)
      || (entry.selection ? !validDelivery(entry.selectionDelivery, !!entry.selectionAck) : entry.selectionDelivery !== undefined)
      || entry.selectionAck && !entry.shownAck
      || entry.feedbackId !== undefined && (!entry.selectionAck || !UUID4.test(entry.feedbackId))) throw new StorageFailure('corrupt');
  }
  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('v2', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(new StorageFailure('storage'));
      try { run(tx.objectStore('v2'), result => { value = result; }); }
      catch { tx.abort(); }
    });
  }
  protect(store: IDBObjectStore, state: V2State) {
    if (state.withdrawal && state.owner && UUID4.test(state.owner.participantId)) {
      this.cachedList = undefined;
      store.put(true, this.ownerKey(state.owner.participantId) + '!withdrawn');
    }
    const source = this.source(state);
    if (source && state.quarantine) {
      this.cachedList = undefined;
      store.put(true, this.sessionBlock(source));
    }
  }
  migrate(apiBaseUrl: string) {
    this.cachedList = undefined;
    return this.transaction<void>('readwrite', (store, done) => {
      const key = 'notification-migration/1/' + this.prefix;
      const marker = store.get(key);
      marker.onsuccess = () => {
        if (marker.result === true) return done();
        const migrateState = (state: V2State | undefined, key: IDBValidKey) => {
          if (!state || state.format !== 2 || state.posts?.apiBaseUrl !== apiBaseUrl || state.behaviors?.apiBaseUrl !== apiBaseUrl
            || state.start && state.start.apiBaseUrl !== apiBaseUrl) return;
          const source = this.source(state);
          if (key !== 'current' && (!source || key !== 'session/' + source.sessionId)) return;
          this.protect(store, state);
          if (!source || !Array.isArray(state.notifications)) return;
          for (const receipt of state.notifications) {
            if (!validNotification(receipt) || receipt.selectionAck && !receipt.shownAck) continue;
            const entryKey = this.key(source, receipt.alertId);
            const existing = store.get(entryKey);
            existing.onsuccess = () => {
              if (existing.result !== undefined) return;
              store.add({
                ...source, apiOrigin: this.origin, alertId: receipt.alertId, alertType: state.start?.alertMode ?? 'AI',
                shownAt: receipt.shownAt, shownAck: receipt.shownAck,
                ...(receipt.selection ? { selection: receipt.selection, selectionAck: receipt.selectionAck,
                  selectionDelivery: initialDelivery(receipt.selectionAck) } : {}),
                shownDelivery: initialDelivery(receipt.shownAck),
              } satisfies OutboxReceipt, entryKey);
            };
          }
        };
        const current = store.get('current');
        current.onsuccess = () => migrateState(current.result, 'current');
        const archive = store.openCursor(between('session/'));
        archive.onsuccess = () => {
          const cursor = archive.result;
          if (cursor) { migrateState(cursor.value, cursor.key); cursor.continue(); }
          else { store.put(true, key); done(); }
        };
      };
    });
  }
  hasReceipts() {
    return this.transaction<boolean>('readonly', (store, done) => {
      const request = store.getKey(between(this.prefix));
      request.onsuccess = () => done(request.result !== undefined);
    });
  }
  async list(scope: ReceiptScope, sessionId?: string): Promise<OutboxReceipt[]> {
    if (!validScope(scope)) return [];
    const key = sessionId ? this.sessionKey({ ...scope, sessionId }) : this.scopeKey(scope);
    if (this.cachedList?.key === key) return [...await this.cachedList.entries];
    const entries = this.readList(scope, key);
    const cache = { key, entries };
    this.cachedList = cache;
    try { return [...await entries]; }
    catch (error) {
      if (this.cachedList === cache) this.cachedList = undefined;
      throw error;
    }
  }
  private readList(scope: ReceiptScope, key: string) {
    return this.transaction<OutboxReceipt[]>('readonly', (store, done) => {
      const entries: OutboxReceipt[] = [], blocked = new Set<string>();
      const owner = store.get(this.ownerBlock(scope));
      const cursor = store.openCursor(between(key));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return done(owner.result === true ? [] : entries.filter(e => !blocked.has(this.sessionBlock(e))));
        const key = String(row.key);
        if (key.endsWith('/!blocked')) blocked.add(key);
        else {
          try { this.check(row.value, row.key); }
          catch { store.transaction.abort(); return; }
          entries.push(row.value);
        }
        row.continue();
      };
    });
  }
  async write(source: ReceiptSource, alertId: string, allowed: () => boolean,
    update: (entry: OutboxReceipt | undefined) => OutboxReceipt | undefined, block = false) {
    const key = this.key(source, alertId);
    const saved = await this.transaction<OutboxReceipt | undefined>('readwrite', (store, done) => {
      const owner = store.get(this.ownerBlock(source));
      const session = store.get(this.sessionBlock(source));
      const existing = store.get(key);
      existing.onsuccess = () => {
        try {
          if (!allowed() || owner.result === true || session.result === true) return done(undefined);
          const old = existing.result as OutboxReceipt | undefined;
          if (old) this.check(old, key);
          const next = update(structuredClone(old));
          if (!next) return done(undefined);
          this.check(next, key);
          if (old && (next.alertType !== old.alertType || next.shownAt !== old.shownAt || old.shownAck && !next.shownAck
            || old.selection && canonical(next.selection) !== canonical(old.selection)
            || old.selectionAck && !next.selectionAck || old.feedbackId && old.feedbackId !== next.feedbackId)) {
            throw new StorageFailure('corrupt');
          }
          store.put(next, key);
          if (block) store.put(true, this.sessionBlock(source));
          done(next);
        } catch { store.transaction.abort(); }
      };
    });
    if (saved) this.cachedList = undefined;
    return saved;
  }
}
