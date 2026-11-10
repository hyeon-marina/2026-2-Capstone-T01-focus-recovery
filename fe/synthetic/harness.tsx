import { AuthConsentPanel } from '../src/v2/AuthConsentPanel';
import type { CollectionAccess } from '../src/v2/access';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { V2Alert } from '../src/v2/status';
const send = (type: string, extra = {}) => chrome.runtime.sendMessage({ type: `v2-${type}`, ...extra });
Object.assign(globalThis, { v2: send });
function Harness() {
  const [alert, setAlert] = useState<V2Alert | null>(null);
  const [access, setAccess] = useState<CollectionAccess>();
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void send('alert').then(a => { if (a?.alertId && a.alertId !== alert?.alertId) setAlert(a); }).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [alert]);
  useEffect(() => {
    if (alert) void send('shown', { alertId: alert.alertId, shownAt: new Date().toISOString() });
  }, [alert]);
  async function command(type: string) {
    if (type === 'stop' || type === 'quarantine') setAlert(null);
    try { const result = await send(type); setError(result?.error ?? ''); }
    catch { setError('Synthetic harness blocked'); }
  }
  return <main><h1>v2 synthetic harness</h1><p>Catalog only. P2/P6 BLOCKED.</p>
    <AuthConsentPanel command={send} onAccess={value => { setAccess(value); if (!value || value.withdrawn) setAlert(null); }} />
    <button disabled={!access?.consentValid || !access.collectionEnabled || access.withdrawn} onClick={() => void command('start')}>Start synthetic session</button>
    <button onClick={() => void command('stop')}>End session</button>
    <button onClick={() => void command('retry')}>Retry</button><p role="status">{error}</p>
    {alert && <aside role="alert"><p>{alert.goalText}</p>{(['RETURN_TO_GOAL', 'CONTINUE_BROWSING'] as const).map(action =>
      <button key={action} onClick={() => { void send('selection', { alertId: alert.alertId, action, selectedAt: new Date().toISOString() }); setAlert(null); }}>{action}</button>)}</aside>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
