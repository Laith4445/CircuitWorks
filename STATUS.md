# STATUS.md — where CircuitWorks stands

_Last updated: 2026-09-28 (session 2, milestone M1)._

## What works
- **M0, the solver, is done and proven** (123 automated checks: every book value, plus
  current balance at every node, power balance, and an energy check). Unchanged this session.
- **M1, the drawing editor, is built.** Open the app and you get a palette on the
  left, a drawing area in the middle, an inspector on the right, and a run bar
  along the bottom. You can:
  - Place parts by clicking the palette or pressing a key (R, C, L, G, V, I, O, S),
    rotate with Space, mirror with F, cancel with Esc.
  - Wire by clicking a pin and dragging, or pressing W and clicking point to point.
    Wires route as an L shape. A dot marks every junction.
  - See **red pins** for anything not yet connected. The circuit won't run until
    they're gone, and the message tells you which part.
  - Double-click a part to edit its value right on the drawing (Enter commits,
    Tab jumps to the next part). The inspector shows the same fields and spells
    out what "10k" means. `M` means mega, `m` means milli.
  - Select, drag-move (attached wires follow), marquee-select, Delete, and
    unlimited Undo/Redo (⌘Z / ⌘⇧Z).
  - Drop voltage probes on wires (P key); drag the little ○ to another point to
    measure between two points. Current and power probes drop on a part; click
    the arrow to flip the direction.
  - Press Run (or ⌘Enter): every probe shows its value in a badge on the drawing.
    After the first run, any edit re-runs DC automatically.
  - If you forget the ground, Run offers a one-click "Add ground" fix.
  - Share: one click puts the whole circuit in the page link; opening that link
    anywhere rebuilds the drawing. Save/Open a .json file. Autosave restores
    unsaved work after a crash or reload.
  - Examples… menu loads any of the seven book exercises.
- The Self-Check page (`/#/selfcheck`) still shows 51 of 51 green.

## How to check it (plain language)
1. In the project folder run `npm test` — expect **142 tests passed, 0 failed**.
2. Run `npm run dev` and open the address it prints (http://localhost:5173).
3. **Build E1 from nothing:** press V, Space, click to place the source. Press R,
   Space, click, four times for the resistors. Press G, click, for the ground.
   Wire them up: click a pin, drag to another pin or wire. Double-click each
   part and type its value (2.5, 10, 10, 15, 25). Press P and click the top wire
   to drop a probe; drag its small circle to the middle wire. Press ⌘Enter.
   **The badge should read 870 mV.** Change a resistor value and watch the badge
   update by itself.
4. **Share test:** click Share ↗, copy the address, paste it into another
   browser window. The same circuit appears; press Run and get the same value.
5. The Examples… menu → E2 shows the dependent-source circuit; Run gives
   −3 V, 18 V, −13.5 V on the three probes.

## What I checked this session (so you don't have to take my word for it)
Built E1 and E2 from a blank canvas in the built-in browser using only the
keyboard and mouse, ran them, and read 870 mV (E1) and 18 V / −3 V / 13.5 V
(E2, the last probe measures c relative to b, so its sign is flipped from the
book's V_R3). Opened a Share link in a second tab and got the same circuit and
answer. Deleted the ground, saw the message and the one-click fix, and got the
answer back.

## What's next (M2 — Time)
Pulse/step sources already exist in the solver; M2 adds the plot panel with
cursors and the "Keep" overlay so E3 (op amp) and E4 (three damping cases on
one plot) can be checked on screen.

## Known limitations / open questions
- Time and Frequency runs solve but show no plot yet (M2/M3). The run bar says so.
- Op amp is ideal, no saturation (SPEC §4.2).
- Node names in probe tooltips are automatic (n1, n2…); editable labels come later.
- The Playwright browser test for E1 is deferred (see DECISIONS.md); the same
  check was done by hand this session.
- On very small windows the palette scrolls; the layout is meant for a laptop.
- E6's circuit reading still needs confirming against the figure (SPEC §10.3).

## Broken
Nothing known. No tests are marked `.todo`.
