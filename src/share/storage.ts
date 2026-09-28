/** Autosave to localStorage. Degrades silently when storage is unavailable (SPEC §9.9). */
import type { Circuit } from '../schematic/model';
import { migrate, toFileJson } from './url';

const KEY = 'circuitworks.autosave.v1';
const ONBOARD_KEY = 'circuitworks.onboarded';

export function saveAutosave(c: Circuit): void {
  try { localStorage.setItem(KEY, toFileJson(c)); } catch { /* private mode etc. */ }
}

export function loadAutosave(): Circuit | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? migrate(JSON.parse(s)) : null;
  } catch { return null; }
}

export function clearAutosave(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function getFlag(name: string): boolean {
  try { return localStorage.getItem(`${ONBOARD_KEY}.${name}`) === '1'; } catch { return false; }
}
export function setFlag(name: string): void {
  try { localStorage.setItem(`${ONBOARD_KEY}.${name}`, '1'); } catch { /* ignore */ }
}
