import { useEffect, useState } from 'react';
import { SelfCheck } from './ui/SelfCheck';

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  if (hash.startsWith('#/selfcheck')) return <SelfCheck />;
  return (
    <main>
      <h1>CircuitWorks</h1>
      <p>Browser circuit simulator for <em>Circuit Analysis and Design</em> (prototype).</p>
      <p>Milestone M0: the solver exists, the drawing editor does not yet.</p>
      <p><a href="#/selfcheck">Open the Self-Check page</a> to see the solver run all seven exercises.</p>
    </main>
  );
}
