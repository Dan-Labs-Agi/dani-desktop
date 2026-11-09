import { useEffect, useState } from 'react';
import { api } from '@/state/store';
import { PILL } from './SignInPill';
type Setup = { phase: 'not-installed' | 'installing' | 'installed' | 'failed' | 'unsupported'; message: string; modelReady: false };
const initial: Setup = { phase: 'not-installed', message: 'Set up Dani Free on this computer. Existing verified tools are reused.', modelReady: false };
export function DaniFreeSetup({ onNext, onOther, showNavigation = true }: { onNext: () => void; onOther: () => void; showNavigation?: boolean }) {
  const [setup, setSetup] = useState<Setup>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void api<Setup>('/api/instances/dani-free/setup').then(s => { if(live) setSetup(s); }).catch(() => {}); return () => { live = false; }; }, []);
  useEffect(() => {
    if (setup.phase !== 'installing') return;
    const timer = window.setInterval(() => { void api<Setup>('/api/instances/dani-free/setup').then(setSetup).catch(() => {}); }, 2000);
    return () => clearInterval(timer);
  }, [setup.phase]);
  const install = async () => {
    setBusy(true);
    try { setSetup(await api<Setup>('/api/instances/dani-free/setup', { method:'POST', body:'{}' })); }
    catch { setSetup({phase:'failed',message:'Dani Free setup could not start. Try again.',modelReady:false}); }
    finally { setBusy(false); }
  };
  const installing = busy || setup.phase === 'installing';
  return <>
    <button data-dani-free-install="" className={PILL} disabled={installing || setup.phase === 'unsupported' || setup.phase === 'installed'} onClick={() => void install()}>
      {installing ? 'Installing Dani Free...' : setup.phase === 'installed' ? 'Dani Free tools installed' : 'Install Dani Free'}
    </button>
    <p data-dani-free-status="" role="status" className="mt-3 max-w-[320px] text-[13px] leading-[18px] text-ink-secondary">{setup.message}</p>
    {showNavigation && <button type="button" onClick={onOther} className="mt-3 rounded text-[13px] text-ink-secondary hover:text-ink">Other ways to connect</button>}
    {(showNavigation || setup.phase === 'installed') && <button type="button" data-welcome-later="" onClick={onNext} className="mt-3 rounded text-[13px] text-ink-secondary hover:text-ink">{setup.phase === 'installed' ? 'Continue' : 'Set up later'}</button>}
  </>;
}
