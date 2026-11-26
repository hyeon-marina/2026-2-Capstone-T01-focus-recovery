import { useEffect, useRef, useState } from 'react';
import { isPrivacyCommand, isUserSnapshot, type UserCommand, type UserError, type UserReply, type UserSnapshot } from './protocol';

export function useUserSession() {
  const [snapshot, setSnapshot] = useState<UserSnapshot>();
  const [busy, setBusy] = useState<UserCommand['type']>();
  const [error, setError] = useState<UserError>();
  const [offline, setOffline] = useState(false);
  const pending = useRef<{ id: number; type: UserCommand['type'] } | undefined>(undefined);
  const generation = useRef(0);

  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const current = generation.current;
      try {
        const reply: UserReply = await chrome.runtime.sendMessage({ type: 'status' });
        if (!disposed && generation.current === current) {
          if (!reply || !('snapshot' in reply) || !isUserSnapshot(reply.snapshot)) throw new Error('Invalid snapshot');
          setSnapshot(reply.snapshot);
          setOffline(false);
        }
      } catch {
        if (!disposed && generation.current === current) {
          setOffline(true);
          setSnapshot(undefined);
        }
      } finally { polling = false; }
    };
    void chrome.runtime.sendMessage({ type: 'analysis-refresh' }).catch(() => {});
    void poll();
    const timer = setInterval(() => void poll(), 500);
    return () => {
      disposed = true;
      pending.current = undefined;
      clearInterval(timer);
    };
  }, []);

  async function request(command: UserCommand) {
    if (pending.current && (!isPrivacyCommand(command.type) || isPrivacyCommand(pending.current.type))) return;
    const id = ++generation.current;
    pending.current = { id, type: command.type };
    setBusy(command.type);
    setError(undefined);
    try {
      const reply: UserReply = await chrome.runtime.sendMessage(command);
      if (pending.current?.id !== id) return;
      if (!reply || !('snapshot' in reply) || !isUserSnapshot(reply.snapshot)) {
        if (reply?.error === 'invalid') {
          generation.current++;
          setError('invalid');
          return;
        }
        throw new Error('Invalid snapshot');
      }
      generation.current++;
      setSnapshot(reply.snapshot);
      setOffline(false);
      setError(reply.error);
      return reply.snapshot;
    } catch {
      if (pending.current?.id === id) {
        generation.current++;
        setSnapshot(undefined);
        setOffline(true);
      }
    } finally {
      if (pending.current?.id === id) {
        pending.current = undefined;
        setBusy(undefined);
      }
    }
  }

  return { snapshot, busy, error, offline, request };
}
