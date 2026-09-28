# STATUS.md — where CircuitWorks stands

_Last updated: 2026-09-28 (session 2, milestones M1–M3)._

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
- **M2, Time analysis on screen, is built.** Pick the **Time** tab, set the end
  time, press Run. A plot panel opens under the run bar with one trace per
  probe in the probe's colour. Hover the plot to read every trace at that
  instant (the schematic badges follow the cursor too); click to pin cursor A,
  click again for B, and a small table shows A, B and the difference.
  **Keep** freezes the current traces as dashed ghosts so the next run draws on
  top (that is the E4 damping comparison). The time step is chosen
  automatically and shown greyed in the Step box; type your own to override.
  Adding a probe after a run shows its trace at once without re-solving.
- **M3, Frequency sweep on screen, is built.** Pick the **Frequency** tab, set
  the start and stop frequency, press Run. Two stacked panels appear: magnitude
  (dB, with a button to switch to a plain ratio) and phase (degrees, no 360°
  jumps), on a logarithmic frequency axis. Shift-click two voltage probes and
  press **Ratio** to plot one divided by the other (the transfer function H).
  Hover for readouts, click to pin cursors A and B (the table shows |H| and
  phase at each), roll the mouse wheel over the plot to zoom in on the
  frequency axis, double-click to reset.
- The Self-Check page (`/#/selfcheck`) still shows 51 of 51 green.

## How to check it (plain language)
1. In the project folder run `npm test` — expect **158 tests passed, 0 failed**.
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

## How to check M2
1. Examples… → **E4**, press Run. The plot shows v_C rising smoothly to about
   20 V at 0.2 s. Hover near 0.1 s: the readout says about 12.4 V.
2. Click **Keep**. Double-click R1, type `2`, Enter. The plot re-runs by itself:
   a new curve overshoots to a peak; hover the peak and read **≈ 37.4 V** near
   176 ms. The old curve stays as a dashed ghost.
3. Keep again, set R1 to `10.954`, and you have all three damping cases on one plot.
4. Examples… → **E3**, Run. Two traces: v_in steps 0→1 V, v_out steps 0→2 V at
   the same instants. Hover anywhere the pulse is high: v_out = 2 V exactly.

## How to check M3
1. Examples… → **E5**, press Run. The magnitude panel shows a peak at 1 MHz
   reaching 0 dB; the phase panel swings from +89° down to −89° through 0° at
   1 MHz. The badge on the H probe reads −39.9 dB (the value at 10 MHz).
2. Hover the peak: H reads 0.00 dB, phase 0.0°, f = 1 MHz.
3. Roll the mouse wheel over the plot near 1 MHz a few times to zoom in, then
   hover until H reads **−3.01 dB**: this happens at about **951 kHz** on the
   left and **1.051 MHz** on the right. Click to pin A at one and B at the
   other; the table's Δ column shows the bandwidth, about 100 kHz.

## What's next (M4 — Switches and initial conditions)
The solver already handles E6 (the tests prove it). M4 adds the on-screen
side: a switch you can click, and named readouts for "just before", "just
after" and "long after" the switch flips.

## Known limitations / open questions
- Op amp is ideal, no saturation (SPEC §4.2).
- Node names in probe tooltips are automatic (n1, n2…); editable labels come later.
- The Playwright browser test for E1 is deferred (see DECISIONS.md); the same
  check was done by hand this session.
- On very small windows the palette scrolls; the layout is meant for a laptop.
- E6's circuit reading still needs confirming against the figure (SPEC §10.3).

## Broken
Nothing known. No tests are marked `.todo`.
