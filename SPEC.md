# SPEC.md — Browser circuit simulator for *Circuit Analysis and Design* (prototype)

Working name: **Circuit Bench** (placeholder — see Open Questions).
Status: proof-of-concept spec. Scope is the seven exercises in `EXERCISES.md`.
Companion files: `CLAUDE.md` (working rules), `EXERCISES.md` (acceptance tests),
`figures/`, `reference_answers.py`.

---

## 1. Why this exists

NI Multisim Live, which the textbook's exercises depend on, shut down on
September 15, 2026. The textbook is open-access and used well beyond the
authors' own courses. The long-term goal is a free, open-source, browser-based
replacement that is *better for this book* than Multisim was: simpler, faster
to learn, and organized around the way the exercises progress.

This prototype exists to answer one question: **can a small, purpose-built,
no-server browser app handle the book's exercises with a materially better
student experience?** Seven exercises were chosen so that each one adds exactly
one capability. If all seven pass and the owner can build them from a blank
canvas without help, the path is validated.

### 1.1 Non-goals for the prototype
- Not a general SPICE simulator. No transistors, diodes, digital parts.
- No op-amp saturation, no nonlinear elements at all (everything is linear, so
  no Newton iteration is needed; keep the solver architecture open to it later).
- No accounts, saving to a server, class rosters, grading, or analytics.
- No mobile/touch layout (use pointer events so it isn't foreclosed).
- No import of Multisim files.
- Not pixel-polished. Coherent, calm, and *predictable* beats pretty.

---

## 2. Users and the core experience

**Primary user:** a student in a first circuits course, on a laptop or
Chromebook, with a textbook problem open beside the browser. They may have
never used a schematic editor. They will make wiring mistakes constantly.

**Secondary user:** an instructor who wants to hand students a starting circuit
by link and receive a link back.

**The one-sentence experience:** *Draw the circuit from the book, press Run,
and see the answers written on the schematic — and when it doesn't work, the
app tells you which wire is wrong.*

### 2.1 Where Multisim Live was weak (the opportunity)
- Analyses hidden behind menus with SPICE jargon (".TRAN", "TSTOP", "TMAX").
- Results in a separate "Grapher" window disconnected from the schematic.
- Silent numerical failures or cryptic SPICE errors ("singular matrix",
  "timestep too small") that students read as their own fault.
- Component browser with thousands of real parts when the book needs twelve
  ideal ones.
- Sharing required an account.

Every one of these is a design decision in §6.

---

## 3. Product scope (what the prototype contains)

### 3.1 Components (the entire palette)
| Part | Pins | Parameters |
|---|---|---|
| Resistor | 2 | R |
| Capacitor | 2 | C, initial voltage (optional) |
| Inductor | 2 | L, initial current (optional) |
| Ground | 1 | — |
| DC voltage source | 2 | V |
| DC current source | 2 | I |
| Waveform voltage source | 2 | type ∈ {sine, pulse, step}, parameters per type; AC magnitude/phase for sweeps |
| Dependent sources ×4 (VCVS, VCCS, CCVS, CCCS) | 2 + control ref | gain; controlling element or node pair |
| Ideal op amp | 3 (+, −, out) | none |
| Switch (SPST) | 2 | initial state; toggles at t=0 (and by click) |
| Wire | — | — |
| **Probes** (measurement, not circuit elements): voltage probe (one node, or two-node differential), current probe (on an element), power probe (on an element or across wattmeter pins) | | |

That's it. Thirteen placeable things. The palette fits on screen without
scrolling.

### 3.2 Analyses (three, named in the book's language)
1. **DC** — "DC Operating Point". One solve. Results annotate the schematic.
2. **Time** — "Transient". Parameters: end time (required), step (optional,
   default derived — §4.3). Sources switch on at t=0; switches change state at
   t=0; caps/inductors start at their initial values or at the pre-t=0 DC
   solution (§4.5). Produces traces.
3. **Frequency** — "AC Sweep". Parameters: start, stop, log/linear, points per
   decade (default 100). Produces magnitude/phase traces for probes, and
   transfer-function probes (ratio of two nodes).

### 3.3 Sharing and persistence
- The entire circuit + analysis settings + probes serialize to JSON, compress,
  and encode into the URL fragment (`#c=…`). Copying the URL is sharing.
- Autosave to `localStorage` on every change (crash protection), with a "Restore
  unsaved circuit?" prompt on load.
- Export/import the JSON as a `.json` file. Export the schematic as SVG/PNG and
  the plot as PNG (students paste these into homework).

### 3.4 Exercise mode (thin)
`/#/exercise/E4` loads the exercise's circuit as a starting point *or* a blank
canvas with the problem statement in a side panel, and shows the reference
values with a "check" button that compares the student's probe readings.
For the prototype this exists mostly to power the Self-Check page; do not
over-build it.

---

## 4. Architecture

Static single-page app. Vite + React + TypeScript. No backend.

```
src/
  engine/        pure TS solver. No DOM. Node-testable.
    netlist.ts   types: Element, Node, Netlist, AnalysisSpec
    mna.ts       matrix assembly (stamps) for DC / AC / transient
    linalg.ts    dense LU with partial pivoting (hand-written, ~150 lines)
    dc.ts, ac.ts, tran.ts
    diagnose.ts  pre-solve structural checks -> plain-language errors
  schematic/     drawing model + extraction to netlist
    model.ts     parts, pins, wires on an integer grid
    extract.ts   geometry -> Netlist (union-find on coincident points)
    parse.ts     "4.7k", "10u", "3.3mH" -> numbers
  ui/            React: canvas (SVG), palette, inspector, run bar, plots
  share/         JSON <-> URL (compression), localStorage, file import/export
  exercises/     the seven circuits as JSON + reference values (+ selfcheck page)
```

### 4.1 Why a hand-written solver instead of ngspice-in-the-browser
Every exercise is a *linear* circuit. Modified nodal analysis (MNA) for linear
DC, AC, and transient is a few hundred lines and loads instantly. Owning the
solver means owning the error messages, which is most of the UX advantage.
ngspice compiled to WebAssembly is the right choice *later* for nonlinear and
mixed-signal work (Chapter 13); design the `AnalysisSpec → Result` interface so
an ngspice backend could be swapped in behind it. Do not start with ngspice.

### 4.2 MNA details that will bite if skipped
- **Unknowns:** node voltages (ground = 0, eliminated) plus one branch current
  for each voltage source, inductor (in transient), ideal op amp output, CCVS,
  and any element with a current probe on it that isn't already a current
  unknown (a resistor's current is derived from voltages; don't add unknowns
  needlessly).
- **Ideal op amp:** two stamps — output node gets an unknown current I_out
  (the op amp can source/sink anything), and one constraint row V(+) − V(−) = 0.
  No gain, no rails. This is exact for every op-amp problem in Chapters 4–9
  that stays in the linear region. Document that saturation is absent.
- **Dependent sources:** VCVS/VCCS stamp against the controlling node pair.
  CCCS/CCVS need the controlling current: if the controlling element is a
  resistor, the control is `(V(a)−V(b))/R` stamped as a VCCS/VCVS in disguise;
  if it's a voltage source/inductor/op-amp output, use that branch's current
  unknown. Expose this uniformly as "controlled by current through *element*".
- **Transient companion models:** trapezoidal rule by default (accurate,
  A-stable; the textbook's plots are smooth exponentials/sinusoids and
  trapezoidal reproduces them well). Provide backward Euler as a fallback only
  if trapezoidal ringing shows up on switch instants; if used, apply BE for the
  first two steps after any discontinuity, then return to trapezoidal.
- **Floating nodes:** any node with no DC path to ground (e.g. between two
  capacitors, or a capacitor in series with the source — E5, E7) makes the DC
  matrix singular. Add a tiny conductance (`gmin = 1e-12 S`) from every node to
  ground in DC/operating-point solves *and* tell the user in a non-blocking
  note when a node is only connected through capacitors. Never crash.
- **Singular matrices** that survive gmin (two ideal voltage sources in
  parallel with different values, a voltage source shorted by a wire, a current
  source in series with an open circuit) must be caught *before* solving by
  `diagnose.ts` (§7.1) and reported with the offending elements highlighted.
- **Units:** all internal math in SI base units. Parsing accepts SPICE suffixes
  (`p n u µ m k M MEG G`) with the classic ambiguity resolved *loudly*: `M` means
  mega in this app (the book uses M for mega), and the parser shows the
  interpreted value ("10M = 10 000 000 Ω") next to every field.

### 4.3 Transient time step
Students don't know what a time step is and shouldn't have to. Default step =
`min(endTime/2000, smallestTimeConstantEstimate/20)` where the estimate comes
from a quick scan: for each R–C or R–L pair sharing a node use RC or L/R; for
any L and C sharing a loop use 1/ω₀ = √(LC); take the minimum. This makes E4
(τ ≈ 25 ms, window 0.2 s → step 0.1 ms) and E6 (ω₀-based ≈ 18 µs, window 2 ms
→ step ≈ 1 µs) both correct with no user input. Expose the step in an
"Advanced" disclosure with the derived value shown as placeholder text. Cap
the point count (e.g. 200 k) and warn rather than hang.

### 4.4 Plotting
One library, chosen for log axes, multiple series, cursors, and speed on
200 k points: **uPlot** (tiny, fast, has log scales) is the default choice.
If it fights the design (cursor readouts, dual panels), a hand-rolled SVG
plotter is acceptable for the prototype. Put it behind a `Plot` component
interface so the choice is reversible. Required behaviors are in §6.3.

### 4.5 Initial conditions and switches (E6)
"Time" analysis has two phases: (1) a DC operating point with every switch in
its *initial* state, sources at their t<0 value (DC sources on, pulse/step
sources at their initial level), capacitors open, inductors shorted. (2) The
transient from t=0 with switches flipped to their final state and C/L states
seeded from phase 1. Explicit initial-value overrides on a C or L win over
phase 1. This one mechanism covers every "switch has been closed for a long
time" problem in Chapters 5–6.

---

## 5. Circuit file format (JSON, versioned)

```json
{
  "v": 1,
  "grid": 10,
  "parts": [
    {"id":"R1","type":"R","x":120,"y":80,"rot":0,"params":{"R":"10"}},
    {"id":"V1","type":"Vdc","x":40,"y":120,"rot":90,"params":{"V":"2.5"}},
    {"id":"G1","type":"GND","x":40,"y":200,"rot":0},
    {"id":"OA1","type":"OPAMP","x":300,"y":100,"rot":0},
    {"id":"F1","type":"CCCS","x":420,"y":120,"rot":0,"params":{"gain":"1.5","ctrl":"R2"}}
  ],
  "wires": [ {"from":[40,110],"to":[120,80]} ],
  "probes": [ {"id":"P1","kind":"v","nodeAt":[120,80],"refAt":[40,200],"label":"Vout"} ],
  "analysis": {"kind":"dc"},
  "labels": [ {"at":[120,60],"text":"T"} ]
}
```
- Pin positions are derived from `type`, `x`, `y`, `rot` (each part type has a
  pin table). Wires are straight orthogonal segments between grid points. A
  junction exists wherever a wire endpoint coincides with a pin or another wire
  endpoint; a wire *crossing* another without an endpoint is not a junction.
- Parameter values are stored as the user's string ("4.7k"), parsed on use.
- Node names are derived (`n1`, `n2`, …) unless the user attaches a label.
- URL encoding: `JSON → deflate → base64url`, in the fragment. Circuits in this
  book compress to well under 2 kB; still, guard for >8 kB with a warning.

---

## 6. UX specification

Design stance: **direct manipulation, visible state, recoverable errors**
(Shneiderman/Nielsen basics applied without ceremony). Concretely:

### 6.1 Layout (single screen, no modal dialogs for common tasks)
```
┌──────────┬──────────────────────────────────────┬───────────────┐
│ Palette  │ Canvas (SVG, pan/zoom, grid)          │ Inspector     │
│ 13 parts │                                        │ (selected     │
│ + probes │   results annotate parts and probes    │  part params, │
│          │   directly after a run                 │  or analysis  │
├──────────┴──────────────────────────────────────┤  settings)    │
│ Run bar: [DC] [Time ▾ end=0.2s] [Frequency ▾]  ▶ Run │ Share ↗ │
├────────────────────────────────────────────────────────────────┤
│ Plot panel (collapsible; only appears for Time/Frequency)      │
└────────────────────────────────────────────────────────────────┘
```
- The three analyses are **tabs in the run bar**, always visible, with their
  1–3 parameters inline. Switching tabs never loses parameters.
- Run is a single button. `Ctrl/Cmd+Enter` also runs. After the first run,
  changing any value auto-re-runs DC within 100 ms (live feel); Time/Frequency
  re-run on demand or when "auto" is toggled and the last run was < 300 ms.

### 6.2 Canvas interactions
- Place a part: click it in the palette, then click on the canvas; or press its
  hotkey (`R C L G V I W O S` — resistor, capacitor, inductor, ground, voltage
  source, current source, wire, op amp, switch) and click. Escape cancels.
- Rotate the part being placed or the selection: `Space` (avoid `R`, which
  places a resistor). Mirror: `F`.
- Wiring: press `W` or click a pin and drag. Wires snap to grid and auto-route
  as an L (horizontal then vertical); a second click adds a corner. Dropping a
  wire end on a pin or wire creates a junction (drawn as a dot).
- Pins that are **unconnected are drawn red** at all times. A circuit with any
  red pin cannot be run; Run shows why. This single affordance prevents the
  majority of student errors before they happen.
- Double-click a part to edit its value inline on the schematic (no dialog);
  `Enter` commits, `Tab` moves to the next part's value. The inspector shows
  the same fields for the selection.
- Multi-select by drag; move by drag; `Delete` removes; `Ctrl/Cmd+Z / Shift+Z`
  undo/redo, unlimited within the session. Every state change is undoable,
  including runs' settings but *not* the results.
- Probes are placed like parts: voltage probe on a node (drops on a wire/pin);
  drag its second handle to another node to make it differential (E1: V_out
  from T to M). Current probe drops onto a two-terminal part and shows an arrow
  for the reference direction; click the arrow to flip it (E2's signs).
- After a DC run, **every probe shows its value on the schematic** in a
  rounded badge (3 significant figures, SI prefix, unit). Values that are
  negative are shown as negative; a hover explains the reference direction.
- Zoom with wheel/pinch; fit-to-circuit with `0`. Pan with space-drag or
  middle mouse.

### 6.3 Plots
- Time and Frequency results open the plot panel. One trace per probe; the
  trace color matches the probe badge color on the schematic (the same probe
  is recognizably the same thing in both places).
- Frequency: two stacked panels, magnitude (dB, toggle to linear) and phase
  (degrees, unwrapped; never show a 360° jump for a continuous response), log
  frequency axis. A transfer-function probe (ratio of two probes) is created by
  selecting two voltage probes and pressing "Ratio".
- Cursors: one cursor follows the mouse and shows every trace's value at that
  x; click to pin cursor A, click again for cursor B; a small table shows
  values at A, B, and Δ. This covers "find the half-power frequency" (E5) and
  "value at t = 0.1 s" (E4).
- **Overlay:** a "Keep" button pins the current traces as ghosts (dashed, same
  color, lighter) so the next run draws on top. "Clear kept" removes them.
  This is E4's damping comparison in two clicks, no parameter-sweep UI needed.
- Axes autoscale; double-click resets. Export PNG.

### 6.4 Conventions the UI must state, not assume
- Waveform sources are specified by **peak amplitude**, matching the book's
  phasor convention (E7). The source's inline field says "1 V peak". Show RMS
  in the inspector as a derived read-only value.
- Frequency in Hz, angles in degrees; ω is never shown.
- Passive sign convention for power: a probe on an element reports power
  *absorbed* by it (negative = delivering). Say so in the badge tooltip.
- Ground is required. If absent, Run explains and offers "Add ground at the
  lowest node?" as a one-click fix.

### 6.5 Onboarding (minimal)
First visit: a 4-step overlay (place, wire, probe, run) on a preloaded 2-resistor
divider. Skippable, never shown again (localStorage). No tour library; four
positioned tooltips.

### 6.6 Accessibility baseline
Keyboard-placeable parts, focusable canvas objects with arrow-key nudge, all
colors also encoded by shape/label (probes are lettered), contrast ≥ 4.5:1,
`prefers-reduced-motion` respected (no animated current flow in the prototype).

---

## 7. Errors, diagnostics, and checks

### 7.1 Pre-run structural diagnostics (`engine/diagnose.ts`)
Run before every solve. Each returns a message, severity, and the ids to
highlight. Messages are written for a student, not an engineer:

| Condition | Message (highlight) |
|---|---|
| Unconnected pin | "R3 has a pin that isn't wired to anything." (pin) |
| No ground | "Add a ground so voltages have a reference." (offer fix) |
| Node connected only via capacitors | "Node between C1 and C2 has no DC path to ground; its DC voltage is undefined (that's fine for Time/Frequency)." (node) |
| Voltage-source loop (two V sources / V source + wire / V source + op-amp output in a loop) | "V1 and V2 are wired directly in parallel with different values — no circuit can satisfy that. Add a resistor or remove one." (elements) |
| Current source in series with open / cut set of current sources | "I1's current has nowhere to go." (element) |
| Op amp with floating input | "The − input of OA1 isn't connected." |
| Controlled source whose control element was deleted | "F1 was controlled by R2, which no longer exists." |
| Two parts with same id / overlapping pins without wire | warn |

Numeric failure after diagnostics pass (pivot below threshold) shows: "The
solver couldn't solve this circuit. This usually means an ideal element is
forced into an impossible state. Highlighted parts are the most likely cause"
— and highlights the elements whose rows had the smallest pivots. Never show a
stack trace or the word "singular".

### 7.2 Self-Check page (`/#/selfcheck`)
Loads each `exercises/E*.json`, runs its analysis with app defaults, compares
against the stored reference values, and shows a table: exercise, quantity,
expected, got, % error, pass/fail. Also shows the wall-clock time per run
(target: DC < 5 ms, Time < 300 ms, Frequency < 100 ms for these circuits).
This page is how the non-technical owner verifies the engine.

### 7.3 Tests
- `engine/*.test.ts`: every reference value in `EXERCISES.md` (same JSON files
  as the Self-Check page; one source of truth). Plus: KCL holds at every node
  of every solution (sum of currents < 1e-9 relative); power balance (source
  power = sum of absorbed power) for DC and at each AC frequency; transient
  energy check for E4 (energy delivered − dissipated = stored, within 1 %).
- `schematic/extract.test.ts`: geometry cases — two parts sharing a pin
  location with no wire (should connect); wire passing over a pin without
  ending there (should *not* connect); T-junction; two wires overlapping
  collinearly; part rotated 90/180/270 with pins in the right place; a probe
  dropped on the middle of a wire.
- `share/*.test.ts`: JSON → URL → JSON round-trip byte-exact; older `v`
  versions load.
- Playwright smoke test: build E1 from a blank canvas with keyboard + mouse,
  run, assert the badge reads "870 mV" or "0.870 V".

---

## 8. Milestones (each ends with something the owner can verify)

**M0 — Engine, no UI.** Netlist types, parser, MNA, DC/AC/transient, diagnostics,
all seven exercise JSONs, all tests green, Self-Check page rendering results
as a plain table. *Owner check:* open Self-Check, see seven green rows.

**M1 — Draw and solve DC.** Canvas, palette, wiring, junctions, red pins,
inline value editing, undo, probes, DC badges, URL sharing, autosave.
*Owner check:* build E1 and E2 from blank canvas without reading docs; share
the URL to another browser and see the same circuit.

**M2 — Time.** Pulse/step sources, transient run, plot panel, cursors, Keep
overlay. *Owner check:* E3 (op amp) and E4 (damping study, three overlaid
traces). Peak of the R=2 Ω trace reads ≈ 37.4 V at the cursor.

**M3 — Frequency.** AC sweep, Bode panels, ratio probe. *Owner check:* E5;
cursor finds 951 kHz / 1051 kHz at −3 dB.

**M4 — Switches and initial conditions.** Switch part, two-phase transient,
t=0⁻/0⁺/∞ readouts. *Owner check:* E6 numbers match.

**M5 — Power.** Power probe, wattmeter, power as an AC-sweep quantity.
*Owner check:* E7 both methods agree.

**M6 — Polish for a first outside look.** Onboarding overlay, keyboard
reference, error-message review with fresh eyes, export PNG/SVG, README with a
2-minute demo GIF. *Owner check:* hands it to the textbook authors.

Rough effort: M0 ≈ 1 session, M1 ≈ 3–5 sessions (this is the big one),
M2–M5 ≈ 1–2 sessions each, M6 ≈ 2. "Session" = one focused Claude Code session
with owner testing after.

---

## 9. Anticipated problems and how to handle them

1. **Wire/junction ambiguity is the #1 source of "wrong answer" bugs.** Two
   parts placed pin-to-pin with no wire — connected or not? *Decision:*
   connected (matches every schematic tool students will meet later) and drawn
   with a junction dot so it's visible. Wires that visually cross without an
   endpoint: not connected, and rendered with a small hop to make that visible.
2. **Grid snapping vs. rotated parts.** Pin tables must place every pin on a
   grid point for all four rotations; make this a test.
3. **Differential probe UX.** Dragging a second handle is discoverable only with
   a hint. Show "drag ○ to measure relative to another point" on first probe.
4. **Trapezoidal ringing at switch instants (E6).** If seen, apply the BE-first-
   two-steps rule in §4.2 rather than global BE (which damps the RLC response
   and would fail E4's peak).
5. **Phase unwrapping** in Bode: unwrap along the sweep; also anchor so that
   the phase at the lowest frequency is in (−180°, 180°].
6. **`M` suffix ambiguity** (milli in SPICE, mega in the book). Decided: mega,
   shown explicitly. `m` is milli. Show the parsed value beside every field.
7. **Value strings with units typed in** ("10 kΩ", "4.7uF"): strip known unit
   symbols; accept `u` and `µ`.
8. **Live re-run on every keystroke** can flicker badges through nonsense
   intermediate values ("1", "10", "10k"). Debounce 150 ms and only re-run when
   the parse succeeds.
9. **localStorage unavailable** (private mode): wrap in try/catch, degrade
   silently.
10. **URL length** in learning-management systems: keep under 2 kB for book
    circuits; offer "copy as short text" (the same base64) as a fallback.
11. **Op amp with output shorted to ground or driving a voltage source**: an
    ideal op amp can't; diagnostics must catch the loop.
12. **Floating-point display**: 0.8695652 → "870 mV"; 18.0000001 → "18.0 V";
    3 significant figures, never trailing noise.
13. **Performance on 200 k-point transients**: store traces as `Float64Array`,
    decimate for drawing, never rebuild React state per point.

---

## 10. Open questions for the owner (not blocking M0)

1. **Name and repo.** Working name "Circuit Bench". GitHub org: the authors'
   or the owner's? License: MIT (code) — confirm the textbook's license doesn't
   require alignment.
2. **Hosting.** GitHub Pages is assumed (free, static). Custom domain later?
3. **m6.1 circuit reading.** `EXERCISES.md` §E6 gives an interpretation of the
   figure; a quick confirmation from an author (or the solutions manual)
   removes the only uncertainty in the reference set.
4. **Amplitude convention.** Peak (book) vs RMS (Multisim's AC source uses
   RMS for its "AC_POWER" source but peak for "AC_VOLTAGE"). Peak is assumed.
5. **Should the exercise panel exist in the student-facing app at all**, or
   only behind Self-Check? Suggest: keep it hidden until authors weigh in.
6. **Chromebook testing.** Someone with a school-managed Chromebook should
   try M1.

---

## 11. First message to give Claude Code

> Read CLAUDE.md, SPEC.md and EXERCISES.md in full. Create STATUS.md and
> DECISIONS.md. Then execute milestone M0 only: scaffold the Vite + React + TS
> project, implement `src/engine/` per SPEC §4, write the seven exercise JSON
> files per EXERCISES.md and the file format in SPEC §5 (hand-place parts on
> the grid for now — layout can be rough), write the tests in SPEC §7.3 that
> apply to the engine, and get them green. Build the Self-Check page as a
> plain table. Do not start on the canvas editor. When M0 is green, update
> STATUS.md with a plain-language "how to check it" and stop.
