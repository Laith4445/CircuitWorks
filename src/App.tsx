import { useEffect, useState } from 'react';
import { SelfCheck } from './ui/SelfCheck';
import { Editor } from './ui/Editor';

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
  return <Editor />;
}
