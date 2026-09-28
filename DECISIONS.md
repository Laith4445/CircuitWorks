# DECISIONS.md — one line per decision the spec didn't settle

Format: date · decision · why. Newest at the bottom.

- 2026-09-28 · Project name is **CircuitWorks** (owner's choice; SPEC's "Circuit Bench" was a placeholder). Package name `circuitworks`.
- 2026-09-28 · Exercise files are the SPEC §5 circuit JSON plus one extra top-level key `exercise` holding the title, problem text, reference checks and variants. The app ignores that key; the Self-Check page and tests use it. Easy to split out later.
- 2026-09-28 · E4 uses a **step** voltage source (0 → 24 V at t = 0) rather than a DC source, because SPEC §4.5 says DC sources are "on" before t = 0 (which would pre-charge the capacitor) and the capability matrix lists E4 under "pulse / step sources".
- 2026-09-28 · Transient starts with an exact t = 0⁺ solve (capacitors held at v(0⁻), inductors at i(0⁻)) before stepping. This gives the true "just after" values for E6 without waiting one time step, and removes the need for the backward-Euler-first-two-steps fallback so far (trapezoidal shows no ringing on E6).
- 2026-09-28 · Trace point t = 0 holds the 0⁺ values; the 0⁻ operating point is returned separately (`op0`) so the UI can show both later.
- 2026-09-28 · Value parser: `M` and `MEG` both mean mega, `m` means milli (SPEC §9.6). Unit letters (Ω, F, H, V, A, s, Hz, W) are stripped.
- 2026-09-28 · Current convention in results: for a two-terminal part, current flows from pin a to pin b *through* the part; v × i is power absorbed. A battery delivering power therefore shows a negative current. The op amp reports the current it pushes out of its output.
- 2026-09-28 · Dependent sources controlled by a current can sense it through a resistor, voltage source, inductor, closed switch, or op-amp output. Sensing through a capacitor or another current source is not supported yet (it would need an extra branch unknown; add when an exercise needs it).
- 2026-09-28 · AC sweep and DC use the switch's *initial* state; only Time flips it at t = 0.
- 2026-09-28 · Extraction rule for wires: a wire endpoint lying anywhere on another wire (its middle counts) joins it — this is the T-junction. A wire passing over a pin without ending there does not connect (SPEC §7.3).
- 2026-09-28 · Two-terminal parts draw horizontally at rotation 0 with pin a on the left; rotation 90 puts pin a on top. Ground has a single pin at its origin. Op amp: + at (−30,−10), − at (−30,+10), out at (+30,0).
- 2026-09-28 · The E6 circuit is implemented exactly as read in EXERCISES.md (open question §10.3 still stands: confirm against fig_m6.1.png).
- 2026-09-28 · Op-amp saturation is not modelled (known limitation, SPEC §4.2).
- 2026-09-28 · M1 editor: a part placed from the palette/hotkey returns to the select tool after one click (press the key again for another). Easy to flip to "keep placing until Esc" if students prefer.
- 2026-09-28 · Moving a part drags the ends of wires attached to its pins along (rubber-band), so moving never silently disconnects anything. Wires may become diagonal; extraction handles that.
- 2026-09-28 · Space both rotates (the part being placed / the selection) and, held down, pans the canvas with a drag. If nothing is selected it only pans.
- 2026-09-28 · Wire endpoint ids exist only in memory (for selection); saved files and links never contain them.
- 2026-09-28 · Files/links written by M1 use the SPEC §5 format plus optional `flip` on a part and `dir` on a current probe. Older files without them load fine.
- 2026-09-28 · Probe badges show 3 significant figures; hovering shows 5 and the reference direction. Node names in tooltips are automatic (n1, n2…) until labels are editable in a later milestone.
- 2026-09-28 · "New" and "Restore unsaved circuit?" use the browser's built-in confirm dialog for now (the only modal dialogs in the app).
- 2026-09-28 · Time and Frequency runs work from the run bar in M1 but only report "solved (N points)"; the plot panel is M2.
- 2026-09-28 · Playwright smoke test (SPEC §7.3) deferred: it needs a browser download; the E1-from-blank-canvas check was done by hand in the built-in browser this session. Add it in M6 with the README.
- 2026-09-28 · M2 plots are a hand-rolled SVG plotter (SPEC §4.4 allows it) behind `src/ui/plot/Plot.tsx`, no uPlot. Reason: full control of cursors, kept traces and the two-panel Bode layout coming in M3, and one less dependency. Big traces are thinned to the min/max per pixel column so peaks survive.
- 2026-09-28 · Cursor readouts on the schematic: during a Time run each probe badge shows the value at the plot cursor (hover or pinned A), otherwise the value at the end of the run. The tooltip says which.
- 2026-09-28 · Adding, moving or re-labelling a probe after a Time run rebuilds the traces from the last result without re-solving (SPEC E3 "unlocks"). Any change to parts, wires or analysis settings re-solves.
- 2026-09-28 · Time re-runs automatically after an edit only when the last run took under 300 ms and the "auto" box in the run bar is ticked (SPEC §6.1). Otherwise press Run.
- 2026-09-28 · The time step field lives in the run bar as "Step", blank by default with the derived value as placeholder, instead of an "Advanced" disclosure. One field, no extra click.
- 2026-09-28 · No backward-Euler fallback was needed: E6's switch transient shows no trapezoidal ringing thanks to the exact t = 0⁺ solve.
