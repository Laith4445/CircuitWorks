/**
 * First-visit tour (SPEC §6.5): four positioned tips on a preloaded divider.
 * Skippable, never shown again (localStorage flag). No tour library.
 */
import { useState } from 'react';

const STEPS = [
  { title: '1 · Place a part', text: 'Click a part in the palette (or press its key: R for resistor, V for voltage source, G for ground) and click on the drawing to drop it. Space rotates it before you drop.', at: { left: 190, top: 40 } },
  { title: '2 · Wire it up', text: 'Click a pin and drag to another pin or wire. A dot marks a junction. Red pins are not connected yet — the circuit will not run until every pin is wired.', at: { left: 190, top: 150 } },
  { title: '3 · Add a probe', text: 'Press P and click a wire to drop a voltage probe. Drag its small ○ to another wire to measure between two points. Current and power probes drop onto a part.', at: { right: 300, top: 40 } },
  { title: '4 · Run', text: 'Press Run (or ⌘/Ctrl+Enter). Every probe shows its value on the drawing. After that, changing any value re-runs by itself. Time and Frequency runs open a plot underneath.', at: { left: 190, bottom: 70 } },
] as const;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  return (
    <div className="tour" style={step.at as React.CSSProperties} role="dialog" aria-label="Quick tour">
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="tour-buttons">
        <button className="link" onClick={onDone}>Skip tour</button>
        <span className="spacer" />
        <span className="muted small">{i + 1} / {STEPS.length}</span>
        {i < STEPS.length - 1
          ? <button onClick={() => setI(i + 1)}>Next</button>
          : <button className="primary" onClick={onDone}>Start drawing</button>}
      </div>
    </div>
  );
}

export function Help({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const rows: [string, string][] = [
    ['R C L G V I O S', 'place a resistor, capacitor, inductor, ground, voltage source, current source, op amp, switch'],
    ['W', 'wire tool (or click a pin and drag)'],
    ['P', 'voltage probe'],
    ['Space', 'rotate the part being placed or the selection (hold and drag to pan)'],
    ['F', 'mirror'],
    ['Esc', 'cancel / deselect'],
    ['Delete', 'remove the selection'],
    ['⌘Z / ⌘⇧Z', 'undo / redo'],
    ['⌘Enter', 'run'],
    ['Arrow keys', 'nudge the selection one grid step'],
    ['0', 'fit the drawing to the window'],
    ['Wheel', 'zoom the drawing (or a plot’s x axis)'],
    ['Double-click', 'edit a value in place; flips a switch'],
    ['Shift-click', 'add to the selection (two voltage probes + Ratio = transfer function)'],
    ['Tab', 'while editing a value: jump to the next part'],
  ];
  return (
    <div className="help" role="dialog" aria-label="Keyboard reference">
      <h3>Keyboard reference <button className="link" onClick={onClose} style={{ float: 'right' }}>close</button></h3>
      <table>
        <tbody>{rows.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody>
      </table>
      <p className="muted small">Conventions: amplitudes are peak values (as in the book); a probe on a part reports power absorbed, so a source delivering power reads negative; current arrows are reference directions and negative means the other way. <code>M</code> means mega, <code>m</code> means milli.</p>
      <button onClick={onTour}>Show the quick tour again</button>
    </div>
  );
}
