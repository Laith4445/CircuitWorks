import numpy as np
from scipy.integrate import solve_ivp

print("=== 2.74 ===")
# T=top node (Vs+), M=middle, ground=bottom. Two 10Ω T-M in parallel; 15Ω and 25Ω M-gnd in parallel.
Rtm = 10*10/20; Rmg = 15*25/40
Vout = 2.5*Rtm/(Rtm+Rmg)
print("Vout (T-M) =", Vout, "V ; V_M =", 2.5-Vout)
# MNA check: nodes T(=2.5 fixed), M unknown
# (M-2.5)/10*2 + M/15 + M/25 = 0
M = 2.5*(2/10)/(2/10+1/15+1/25); print("MNA V_M =", M, "Vout =", 2.5-M)

print("=== 2.76 ===")
# a=15V, b, c. R1=10 a-b, R2=30 b-gnd, R3=15 b-c, dep current source 1.5*I into c, I = Vb/30 (down thru R2)
A = np.array([[1/10+1/30+1/15, -1/15],[-1/15 - 1.5/30, 1/15]]); rhs=np.array([15/10, 0.0])
Vb,Vc = np.linalg.solve(A,rhs)
print("Vb=",Vb,"Vc=",Vc,"I=",Vb/30,"V_R1(a->b)=",15-Vb,"V_R2=",Vb,"V_R3(b->c)=",Vb-Vc)

print("=== 4.62 noninverting gain 2: Rf=Rs=10k, pulse 0->1V ===")
print("Ideal: vout = 2*vin -> 0 V low, 2 V high. Rf/Rs current when high: 1V/10k=0.1mA")

print("=== 6.60 series RLC ===")
Vs,R,L,C = 24.0,12.0,0.3,10e-3
alpha=R/(2*L); w0=1/np.sqrt(L*C)
print("alpha=",alpha,"w0=",w0,"-> overdamped" if alpha>w0 else "-> underdamped")
s1=-alpha+np.sqrt(alpha**2-w0**2); s2=-alpha-np.sqrt(alpha**2-w0**2)
print("s1,s2=",s1,s2)
# vC(t)=Vs + A1 e^{s1 t} + A2 e^{s2 t}, vC(0)=0, i(0)=0 -> A1 s1 + A2 s2 = 0
A1 = -Vs*s2/(s2-s1); A2 = -Vs - A1
vC=lambda t: Vs + A1*np.exp(s1*t)+A2*np.exp(s2*t)
for t in [0.02,0.05,0.1,0.2]: print(f"vC({t})={vC(t):.4f} V")
# numeric ODE check
def f(t,y): return [y[1], (Vs - R*y[1] - y[0]/C)/L]  # y=[q,i]; vC=q/C
sol=solve_ivp(f,[0,0.2],[0,0],rtol=1e-9,atol=1e-12,dense_output=True)
for t in [0.02,0.05,0.1,0.2]: print(f"  ODE vC({t})={sol.sol(t)[0]/C:.4f}")
Rcrit=2*np.sqrt(L/C); print("R critical =",Rcrit)
for Rx in [2.0, Rcrit, 12.0]:
    a=Rx/(2*L);
    def g(t,y): return [y[1], (Vs - Rx*y[1] - y[0]/C)/L]
    s=solve_ivp(g,[0,0.2],[0,0],rtol=1e-9,atol=1e-12,dense_output=True)
    ts=np.linspace(0,0.2,20001); v=s.sol(ts)[0]/C
    print(f"R={Rx:.4f}: alpha={a:.3f}, peak vC={v.max():.3f} V at t={ts[v.argmax()]:.4f}s, vC(0.2)={v[-1]:.4f}")

print("=== 9.51 series bandpass: L=1mH f0=1MHz Q=10 ===")
L=1e-3; f0=1e6; w0=2*np.pi*f0; Q=10
C=1/(w0**2*L); R=w0*L/Q
print("C=",C,"F ; R=",R,"ohm")
B=f0/Q; print("bandwidth=",B,"Hz ; f_c1,f_c2 ~", f0-B/2, f0+B/2)
def H(f):
    w=2*np.pi*f; Z=R+1j*(w*L-1/(w*C)); return R/Z
for f in [1e5,0.95e6,1e6,1.05e6,1e7]:
    h=H(f); print(f"f={f:.3e}: |H|={abs(h):.4f} ({20*np.log10(abs(h)):.2f} dB), phase={np.degrees(np.angle(h)):.2f} deg")
# exact half-power freqs
fc1 = f0*(np.sqrt(1+1/(4*Q**2)) - 1/(2*Q)); fc2 = f0*(np.sqrt(1+1/(4*Q**2)) + 1/(2*Q))
print("exact fc1,fc2 =",fc1,fc2, "|H|:",abs(H(fc1)),abs(H(fc2)))

print("=== m6.1 ===")
R1,R2,R3,Rsw,Rw,L,C,Vs = 680.,100.,100.,10.,10.,3.3e-3,0.1e-6,4.7
# Node N: R1 to gnd; (R2+Rw+L) N<->VR; R3-C N<->VR; Rsw+switch N<->gnd. VR = Vs.
# switch closed (t<0), DC: L short, C open
Rp = R1*Rsw/(R1+Rsw); iL0 = Vs/(R2+Rw+Rp); vN0 = iL0*Rp
print("t=0-: iL=",iL0,"A ; vN=",vN0,"; vC(+ at N side) =",vN0-Vs, "; iC=0 ; vL=0")
# t=inf: switch open
iLinf = Vs/(R2+Rw+R1); vNinf=iLinf*R1
print("t=inf: iL=",iLinf,"vN=",vNinf,"vC=",vNinf-Vs)
# transient t>0: states iL (from VR through L,Rw,R2 into N), vC (N-side minus VR-side)
# node N: iL + iC_into_N = vN/R1 ; cap current from N into C: iCn = (vN - vCplate?)...
# C in series with R3 between N and VR: current i3 from N toward VR: i3 = (vN - vC - Vs)/R3  where vC = v(+plate)-v(-plate), + plate on R3 side
# KCL at N: iL - i3 - vN/R1 = 0 -> vN = ... ; diL/dt = (Vs - (R2+Rw)iL - vN)/L ; dvC/dt = i3/C
def h(t,y):
    iL,vC=y
    # solve vN: iL - (vN - vC - Vs)/R3 - vN/R1 = 0
    vN = (iL + (vC+Vs)/R3)/(1/R3+1/R1)
    i3=(vN-vC-Vs)/R3
    return [(Vs-(R2+Rw)*iL-vN)/L, i3/C]
s=solve_ivp(h,[0,2e-3],[iL0,vN0-Vs],rtol=1e-9,atol=1e-12,dense_output=True,max_step=1e-6)
ts=np.linspace(0,2e-3,20001); iL=s.sol(ts)[0]; vC=s.sol(ts)[1]
vN=(iL+(vC+Vs)/R3)/(1/R3+1/R1)
print("iL(0+)=",iL[0],"vN(0+)=",vN[0],"vC(0+)=",vC[0])
print("vC min=",vC.min(),"at",ts[vC.argmin()],"vC max=",vC.max(),"at",ts[vC.argmax()])
print("vC(2ms)=",vC[-1],"iL(2ms)=",iL[-1])
# initial iC(0+) and vL(0+)
i3_0 = (vN[0]-vC[0]-Vs)/R3; print("iC(0+) (flowing N->C->VR)=",i3_0,"; vL(0+)=", Vs-(R2+Rw)*iL0-vN[0])

print("=== 8.64 ===")
f=1e6; w=2*np.pi*f
Zc=1/(1j*w*1e-9); Zl=1j*w*1e-6; ZL=12.5+Zc
Zsh = Zl*ZL/(Zl+ZL)
Ztot = 25 + Zc + Zsh
I = 1.0/Ztot  # phasor amplitude
Vsh = I*Zsh
IL = Vsh/ZL
P = 0.5*abs(IL)**2*12.5
print("Zc=",Zc,"Zl=",Zl,"Ztot=",Ztot)
print("|I|=",abs(I),"Vsh=",abs(Vsh),"|IL|=",abs(IL),"P_avg(ZL)=",P,"W  (amplitude convention)")
print("If 1V were RMS: P=",abs(IL)**2*12.5)
print("Complex power S_L =",0.5*Vsh*np.conj(IL))
