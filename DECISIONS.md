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
