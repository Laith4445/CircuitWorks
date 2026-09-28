# STATUS.md — where CircuitWorks stands

_Last updated: 2026-09-28 (session 1, milestone M0)._

## What works
- **The solver is done and proven.** It handles all three analyses the book needs:
  DC operating point, Time (transient), and Frequency (AC sweep). It supports
  resistors, capacitors, inductors, DC and waveform sources (sine / pulse / step),
  all four dependent sources, the ideal op amp, and the switch that flips at t = 0.
- **All seven exercises pass.** 51 reference values from `EXERCISES.md` are
  checked automatically, plus physics sanity checks (currents at every node add
  to zero, source power equals absorbed power, energy is conserved in E4). Every
  reference value is matched to within a few hundredths of a percent, far inside
  the required tolerances. This includes the two "stretch" exercises E6 and E7.
- **Turning drawn parts and wires into a circuit** ("netlist extraction") works
  for hand-placed layouts, including T-junctions, overlapping wires, rotated
  parts, and parts placed pin-to-pin. It has its own tests with awkward layouts.
- **Pre-run checks** catch: missing ground, unwired pins, voltage sources in
  parallel, a current source with nowhere to go, a dependent source whose
  controlling part was deleted, an op-amp output shorted, and nodes that only
  connect through capacitors (a note, not an error).
- **The Self-Check page** (`/#/selfcheck`) shows every check as a green or red
  row with expected value, computed value, percent error, and run time.
- Run times are far below target (DC under 1 ms, Time under 10 ms, Frequency
  under 5 ms; the E7 time-domain wattmeter run is about 25 ms).

## How to check it (plain language)
1. Open a terminal in the project folder and run `npm install` once.
2. Run `npm test`. You should see **123 tests passed, 0 failed**. If anything
   is red, the solver is wrong and I need to fix it before any UI work.
3. Run `npm run dev` and open the address it prints (usually
   http://localhost:5173) with `/#/selfcheck` on the end. You should see
   "**51 of 51 checks pass**" and every row green. Each exercise has its own table.
4. Nothing else is clickable yet; the drawing editor is milestone M1.

## What's next (M1 — draw and solve DC)
Canvas, palette, wiring, junction dots, red unconnected pins, inline value
editing, undo, probes, DC value badges on the schematic, URL sharing, autosave.
Owner check for M1: build E1 and E2 from a blank canvas without reading docs.

## Known limitations / open questions
- No drawing UI yet (by design for M0).
- The op amp is ideal: no saturation, no supply rails (SPEC §4.2). Recorded in `DECISIONS.md`.
- The E6 circuit is built exactly as `EXERCISES.md` reads the figure; SPEC
  open question 3 (confirm against `figures/fig_m6.1.png` with an author) still stands.
- A dependent source can sense current through a resistor, voltage source,
  inductor, closed switch or op-amp output, but not through a capacitor or
  another current source. No exercise needs that yet.
- Exercise circuit layouts are rough hand placements; they will be redrawn
  nicely once the editor exists.

## Broken
Nothing known. No tests are marked `.todo`.
