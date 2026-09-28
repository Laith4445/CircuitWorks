# EXERCISES.md — the seven proof-of-concept exercises

Source: *Circuit Analysis and Design*, 3rd ed. (Ulaby, Maharbiz, Furse), 2025
open-access PDF. Figures for the four exercises that need one are in
`figures/`. Reference values were computed independently in
`reference_answers.py` (NumPy/SciPy; closed-form and numerical ODE cross-checked).

Each exercise is listed with: what the student is asked to do; the circuit as a
netlist (so the solver can be tested before any UI exists); the reference values
and tolerance; and the capability it is meant to unlock. **Every reference value
here is a required unit test.**

Netlist notation used below (this is documentation, not the file format —
the JSON format is defined in SPEC §5):
`R1 a b 10` = resistor R1 between nodes a and b, 10 Ω. `0` is ground.
`V1 a 0 dc 15` = voltage source, + terminal at a. `I1 0 c 1.5*I(R2)` = current
source pushing current *into* c, controlled by the current through R2 (positive
in R2's a→b direction).

Tolerances: DC values ±0.1 %. Transient and AC values ±1 % unless noted; the
solver's step/point settings must be the app's *defaults*, not tuned per test.

---

## E1 — Problem 2.74: Resistor bridge, DC (figure: `fig_P2.74.png`)
**Student task.** Build the circuit, run DC operating point, read V_out.
**Circuit.** 2.5 V source, + at top node T, − at bottom node (ground). Two 10 Ω
resistors both connect T to middle node M (one drawn vertical, one diagonal —
they are in parallel). A 15 Ω and a 25 Ω both connect M to ground (also
parallel). V_out is measured from T (+) to M (−).
```
V1 T 0 dc 2.5
R1 T M 10
R2 T M 10
R3 M 0 15
R4 M 0 25
```
**Reference.** V(M) = 1.6304 V; V_out = V(T) − V(M) = **0.8696 V**.
Currents: I(V1) = 0.17391 A total.
**Unlocks.** DC solve; voltage probe between two arbitrary nodes (not just
node-to-ground); parallel elements drawn in non-obvious geometry.
**UI test.** Owner builds this from a blank canvas and gets 0.870 V displayed
on the schematic without opening any dialog.

## E2 — Problem 2.76: Dependent current source, DC (figure: `fig_P2.76.png`)
**Student task.** Find the voltage across R1, R2, R3.
**Circuit.** V1 = 15 V, + at node a, − at ground. R1 = 10 Ω a→b. R2 = 30 Ω b→ground;
I is the current down through R2. R3 = 15 Ω b→c. A current-controlled current
source of value 1.5·I between ground and c, arrow pointing up (current flows
from ground into c).
```
V1 a 0 dc 15
R1 a b 10
R2 b 0 30
R3 b c 15
F1 0 c 1.5*I(R2)      ; CCCS, current into node c
```
**Reference.** V(b) = **18.000 V**, V(c) = **31.500 V**, I = I(R2) = 0.6000 A.
V_R1 = V(a)−V(b) = −3.000 V; V_R2 = 18.000 V; V_R3 = V(b)−V(c) = −13.500 V.
(The answers are negative because the dependent source pushes current back
toward the battery. A student who gets +3 V has the polarity wrong — the app
should show signed values and the reference direction on the probe.)
**Unlocks.** All four dependent source types (VCVS, VCCS, CCVS, CCCS) with a
clear UI for choosing the controlling quantity. Controlling *current* must be
sensable through any two-terminal element (here a resistor).

## E3 — Problem 4.62: Noninverting op amp, pulse input, transient
**Student task.** Draw a noninverting amplifier (book Fig. 4-7) with gain 2,
feed it a 1 V pulse, plot input and output vs. time.
**Circuit.** Ideal op amp. Input pulse source at v_in (0 → 1 V). Op amp + input
connects to v_in. Feedback resistor R_f = 10 kΩ from output to the − input;
R_s = 10 kΩ from the − input to ground. Gain = 1 + R_f/R_s = 2.
```
V1  in 0 pulse(0 1 1ms 1us 1us 2ms 5ms)   ; low, high, delay, rise, fall, width, period
X1  in n out opamp                        ; pins: +, −, out (ideal)
Rf  out n 10k
Rs  n 0 10k
```
Simulate 0–10 ms.
**Reference.** v_out = 2·v_in exactly for an ideal op amp: 0 V when the pulse
is low, **2.000 V** when high, transitions at the same instants as the input.
V(n) = v_in (virtual short). I(Rf) = 0.1 mA when high.
**Unlocks.** Ideal op amp model (implemented as a constraint V+ = V−, with the
output current as an extra unknown — see SPEC §4.2); pulse source with editable
parameters; transient analysis; a two-trace time plot with a legend; adding a
probe *after* running should show its trace without re-running when possible.
**Note.** Op-amp saturation is deliberately *not* modeled in the prototype
(the ideal model has no rails). Record this as a known limitation; the book's
m4.4 needs it later.

## E4 — Problems 6.60 and 6.62: Series RLC step response, damping study
**Student task (6.60).** Series RLC: V_s = 24 V, R = 12 Ω, L = 300 mH,
C = 10 mF. Plot v_C(t) for 0 < t < 0.2 s. **(6.62)** Change R to obtain
under-, critically-, and over-damped responses and compare the three plots.
**Circuit.** Source step at t = 0 (energy-free initial conditions: v_C(0)=0,
i_L(0)=0).
```
V1 a 0 dc 24         ; applied at t=0 (a step); C and L start at zero
R1 a b 12
L1 b c 300m
C1 c 0 10m
```
**Reference (R = 12 Ω, overdamped: α = 20 s⁻¹, ω₀ = 18.257 s⁻¹).**
v_C(0.02) = 1.2336 V; v_C(0.05) = 5.3484 V; v_C(0.10) = **12.365 V**;
v_C(0.20) = **20.181 V**. Monotonic, no overshoot.
**Damping study.** Critical R = 2√(L/C) = **10.954 Ω**.
- R = 2 Ω (underdamped): v_C peaks at **37.39 V** at t ≈ 0.175 s (overshoots 24 V).
- R = 10.954 Ω (critical): v_C(0.2) = 21.103 V, no overshoot.
- R = 12 Ω: as above.
Tolerance ±1 % on values, ±2 % on the peak time.
**Unlocks.** Capacitor and inductor companion models; a transient integrator that
is accurate and stable for a 0.2 s window (this circuit's time constants are
tens of ms — easy); **run-overlay**: keep the previous trace when a value is
edited and re-run, so the three damping cases sit on one plot; cursor readout
of value at a time.

## E5 — Problem 9.51: Series bandpass filter, frequency sweep
**Student task.** Design a series RLC bandpass with L = 1 mH, f₀ = 1 MHz,
Q = 10; choose F_START = 100 kHz; plot magnitude and phase of the transfer
function H = V_R / V_s.
**Circuit.** The student must compute C and R first (that is the point of the
exercise): C = 1/(ω₀²L) = **25.33 pF**, R = ω₀L/Q = **628.3 Ω**.
```
V1 in 0 ac 1
L1 in x 1m
C1 x out 25.33p
R1 out 0 628.3
; H = V(out)/V(in), sweep 100 kHz → 10 MHz, log, ≥100 points/decade
```
**Reference.** |H(1 MHz)| = **1.000 (0 dB)**, phase 0°. |H(100 kHz)| = 0.0101
(−39.9 dB), phase +89.4°. |H(10 MHz)| = 0.0101, phase −89.4°. Half-power
points |H| = 0.7071 at **951.2 kHz** and **1051.2 kHz** (bandwidth 100 kHz).
Tolerance ±1 % on magnitudes, ±1° on phase, ±0.5 % on the half-power frequencies
(the sweep must be dense enough for cursors to find them).
**Unlocks.** AC (frequency-domain) analysis at each point of a log sweep;
magnitude in dB and phase in degrees on a log-frequency axis; two stacked
panels (magnitude, phase); phase unwrapping must not produce a jump at 0°;
cursors that report frequency and value; the "transfer function" probe (ratio
of two node voltages) as a first-class thing rather than a formula the student
types.

## E6 (stretch) — Problem m6.1: Switch opens at t = 0, initial conditions
(figure: `fig_m6.1.png`)
**Student task.** Switch has been closed a long time and opens at t = 0. Find
v_C(0), i_C(0), v_C(∞), i_L(0), v_L(0), i_L(∞). The Multisim part is to build it,
toggle the switch, and read the values.
**Circuit (read from the figure — Claude Code and the owner should confirm this
reading against `fig_m6.1.png`).** All the resistors hang off one node N:
R1 = 680 Ω from N to ground; R_sw = 10 Ω from N through the switch to ground;
the top path from N is R2 = 100 Ω, R_w = 10 Ω, L = 3.3 mH in series to node P;
the middle path from N is R3 = 100 Ω then C = 0.1 µF to node P. V_s = 4.7 V,
+ at P, − at ground. v_C is + on the N-side plate. i_L is drawn *upward* into
N from... — in this reading i_L flows from P through L, R_w, R2 into N; the
figure's arrow sits on the wire joining N's two junctions, so the sign
convention should be confirmed. i_C flows from N through R3 into C.
```
V1  P 0 dc 4.7
R1  N 0 680
Rsw N s 10
S1  s 0 closed_until_t0     ; ideal switch: closed for t<0, opens at t=0
R2  N q 100
Rw  q r 10
L1  r P 3.3m
R3  N m 100
C1  m P 0.1u
```
**Reference (switch closed, t = 0⁻).** i_L = **39.21 mA**; V(N) = 0.3865 V;
v_C = V(m) − V(P) = **−4.3135 V**; i_C = 0; v_L = 0.
**Just after (t = 0⁺).** i_L = 39.21 mA (continuous); v_C = −4.3135 V
(continuous); V(N) jumps to 3.7556 V; i_C = **33.69 mA**; v_L = **−3.369 V**.
**Final (t → ∞).** i_L = **5.949 mA**; V(N) = 4.0456 V; v_C = **−0.6544 V**.
**Transient shape.** v_C swings from −4.31 V to a maximum of +0.60 V at
t ≈ 35.8 µs, then rings down to −0.654 V (underdamped). Simulate 0–2 ms;
default time step must resolve a ~36 µs feature — i.e. the transient
integrator needs either an adaptive step or a sensible default (≥ 2000 points
per window is not enough here if the user asks for 100 ms; see SPEC §4.3).
**Unlocks.** Switch element with a "state before t=0" and a toggle; transient
that starts from the DC operating point of the pre-switch circuit (this is the
whole "initial conditions" concept in Chapters 5–6); probe readouts at t = 0⁻,
0⁺, ∞ as named quantities, not just a plot.

## E7 (stretch) — Problem 8.64: Wattmeter and AC power (figure: `fig_P8.64.png`)
**Student task.** Use the wattmeter to measure average power in Z_L at 1 MHz;
then run AC analysis 100 kHz → 1 GHz and show the 1 MHz value agrees.
**Circuit.** v_s = 1 V∠0° at 1 MHz (peak amplitude, the book's convention).
25 Ω series, 1 nF series, then a 1 µH inductor to ground, then the load
Z_L = 12.5 Ω in series with 1 nF, to ground.
```
V1 a 0 ac 1 sin(0 1 1MEG)
R1 a b 25
C1 b c 1n
L1 c 0 1u
RL c d 12.5
CL d 0 1n
; wattmeter across (c → 0) sensing current into RL
```
**Reference (1 V peak).** |I_L| = 0.2649 mA; P_avg(Z_L) = ½·|I_L|²·12.5 =
**0.4385 µW**; complex power S_L = 0.4385 µW − j5.583 µVAR.
(If the source is interpreted as 1 V RMS the answer doubles to 0.877 µW.
**Decision required — see SPEC §6.4:** source values are *peak amplitude*
to match the book; the UI must say so on the source dialog.)
Tolerance ±1 %. The time-domain wattmeter (average of v·i over whole cycles
after start-up) and the AC-analysis value must agree within 1 %.
**Unlocks.** A wattmeter instrument (voltage pins + current path) that reports
average power; consistency between the transient and AC engines; a sweep whose
plotted quantity is *power*, not a voltage; a 4-decade sweep.

---

## Capability matrix

| Capability | E1 | E2 | E3 | E4 | E5 | E6 | E7 |
|---|---|---|---|---|---|---|---|
| DC solve | ● | ● | | | | ● | |
| Dependent sources | | ● | | | | | |
| Ideal op amp | | | ● | | | | |
| Pulse / step sources | | | ● | ● | | | |
| Transient (C, L) | | | ● | ● | | ● | ● |
| AC sweep, Bode plot | | | | | ● | | ● |
| Switch + initial conditions | | | | | | ● | |
| Wattmeter / power | | | | | | | ● |
| Run overlay, cursors | | | | ● | ● | | |
| Node-to-node probe | ● | ● | | | | ● | |
