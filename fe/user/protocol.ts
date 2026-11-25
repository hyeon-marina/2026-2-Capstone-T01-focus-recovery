import { validGoal } from '../src/shared/goal';
import type { ReceiptPhase } from '../src/v2/notification-store';
import type { V2State } from '../src/v2/state';
import type { Decision } from '../src/v2/status';
import { UUID4 } from '../src/v2/contract';
import { USER_POPUP } from './mock-config';

const simple = ['status', 'analysis-refresh', 'access', 'agree', 'retry-start', 'reconnect', 'retry', 'retry-receipts', 'logout', 'withdraw'] as const;
export type UserCommand =
  | { type: typeof simple[number] }
  | { type: 'login'; token: string }
  | { type: 'start'; goal: string }
  | { type: 'stop'; sessionHandle: string };

export const isPrivacyCommand = (type: UserCommand['type']) => type === 'logout' || type === 'withdraw';
const validHandle = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function parseCommand(value: unknown): UserCommand | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Record<string, unknown>;
  const size = Object.keys(data).length;
  if (size === 1 && simple.some(type => type === data.type)) return value as UserCommand;
  if (size !== 2) return;
  if (data.type === 'login' && typeof data.token === 'string' && /^synthetic-user-133-[A-Za-z0-9_-]{24,109}$/.test(data.token)) {
    return { type: 'login', token: data.token };
  }
  if (data.type === 'start' && typeof data.goal === 'string' && validGoal(data.goal)) return { type: 'start', goal: data.goal };
  if (data.type === 'stop' && validHandle(data.sessionHandle)) {
    return { type: 'stop', sessionHandle: data.sessionHandle };
  }
}

export function trustedPopup(sender: chrome.runtime.MessageSender, id: string, url: string) {
  return sender.id === id && sender.url === url && (sender.origin === undefined || sender.origin === `chrome-extension://${id}`)
    && (sender.frameId === undefined || sender.frameId === 0)
    && (sender.documentLifecycle === undefined || sender.documentLifecycle === 'active');
}

export function parseAlertKey(value: unknown) {
  return typeof value === 'string' && UUID4.test(value) ? value : undefined;
}
export const alertUrl = (viewId: string) => chrome.runtime.getURL(USER_POPUP) + '?alert=' + viewId;
const detailCommands = ['alert-open', 'alert-view', 'alert-shown'] as const;
const actions = ['RETURN_TO_GOAL', 'CONTINUE_BROWSING'] as const;
export type AlertAction = typeof actions[number];
export type AlertCommand = { type: typeof detailCommands[number]; viewId: string }
  | { type: 'alert-select'; viewId: string; action: AlertAction };
export interface AlertDetail {
  goal: string;
  shown: boolean;
  action?: AlertAction;
  acknowledged?: boolean;
  shownDelivery?: ReceiptPhase;
  selectionDelivery?: ReceiptPhase;
}
export function parseAlertCommand(value: unknown): AlertCommand | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Record<string, unknown>;
  const viewId = parseAlertKey(data.viewId);
  if (!viewId) return;
  const type = detailCommands.find(command => command === data.type);
  const size = Object.keys(data).length;
  if (type && size === 2) return { type, viewId };
  const action = actions.find(value => value === data.action);
  if (data.type === 'alert-select' && action && size === 3) return { type: data.type, viewId, action };
}

const accessStates = ['auth', 'consent', 'ready', 'denied', 'account', 'withdrawn'] as const;
const connectionStates = ['unverified', 'verified', 'stale', 'unreachable', 'auth-required', 'denied'] as const;
export type ServerConnection = typeof connectionStates[number];
const errors = ['invalid', 'auth', 'consent', 'account', 'network', 'response', 'blocked'] as const;
export type UserError = typeof errors[number];
export type AnalysisStatus = 'unconnected' | 'empty' | 'pending' | 'delayed' | 'failed' | 'invalidated' | 'unavailable' | 'completed';
export interface UserSnapshot {
  lifecycle: V2State['lifecycle'];
  access: typeof accessStates[number];
  connection: ServerConnection;
  serverCheckedAt?: number;
  privacyPending: boolean;
  collecting: boolean;
  permission: boolean;
  storageFailed: boolean;
  reconnectRequired: boolean;
  deliveryIssue: boolean;
  privacyHold: boolean;
  withdrawalPending: boolean;
  analysis: AnalysisStatus;
  finalState?: NonNullable<Decision['finalState']>;
  receiptPending: boolean;
  receipts?: Record<typeof receiptCounts[number], number>;
  goal?: string;
  startedAt?: string;
  sessionHandle?: string;
}
export type UserReply = { snapshot: UserSnapshot; error?: UserError } | { error: 'invalid' };

const receiptCounts = ['pending', 'previousPending', 'acknowledged', 'retryWaiting', 'exhausted', 'rejected', 'accessBlocked'] as const;

export function isUserSnapshot(value: unknown): value is UserSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as UserSnapshot;
  return ['IDLE', 'START_PENDING', 'ACTIVE', 'END_PENDING', 'ENDED'].includes(s.lifecycle) && accessStates.includes(s.access)
    && connectionStates.includes(s.connection)
    && (s.serverCheckedAt === undefined || Number.isSafeInteger(s.serverCheckedAt) && s.serverCheckedAt > 0)
    && (!['verified', 'stale'].includes(s.connection) || s.serverCheckedAt !== undefined)
    && ['unconnected', 'empty', 'pending', 'delayed', 'failed', 'invalidated', 'unavailable', 'completed'].includes(s.analysis)
    && (s.analysis === 'completed' ? ['NORMAL', 'TRANSITION', 'DRIFT'].includes(s.finalState!) : s.finalState === undefined)
    && [s.collecting, s.permission, s.storageFailed, s.reconnectRequired, s.deliveryIssue, s.privacyHold, s.withdrawalPending, s.privacyPending, s.receiptPending].every(v => typeof v === 'boolean')
    && (s.receipts === undefined || !!s.receipts && receiptCounts.every(key =>
      Number.isSafeInteger(s.receipts?.[key]) && s.receipts![key] >= 0))
    && (s.goal === undefined || typeof s.goal === 'string' && validGoal(s.goal))
    && (s.startedAt === undefined || typeof s.startedAt === 'string' && Number.isFinite(Date.parse(s.startedAt)))
    && (s.lifecycle === 'IDLE' || !!s.goal)
    && (['IDLE', 'START_PENDING'].includes(s.lifecycle) === (s.startedAt === undefined))
    && (s.lifecycle === 'ACTIVE' ? validHandle(s.sessionHandle) : s.sessionHandle === undefined)
    && (!s.collecting || s.lifecycle === 'ACTIVE' && s.access === 'ready'
      && s.permission && !s.storageFailed && !s.reconnectRequired && !s.privacyHold && !s.privacyPending);
}
