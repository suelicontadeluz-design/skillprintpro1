from math import comb, sqrt, log, exp
from functools import lru_cache

def wilson(k,n,z=1.96):
    if n==0: return (0,0)
    p=k/n; d=1+z*z/n
    c=(p+z*z/(2*n))/d
    h=z*sqrt(p*(1-p)/n + z*z/(4*n*n))/d
    return (max(0,c-h), min(1,c+h))

lo,hi = wilson(5,49)
print(f"BASELINE FREQ_2_3 = 5/49 = {5/49*100:.1f}%  IC95% Wilson = [{lo*100:.1f}% , {hi*100:.1f}%]")
lo2,hi2 = wilson(63,106)
print(f"BASELINE FREQ_4_PLUS = 63/106 = {63/106*100:.1f}%  IC95% = [{lo2*100:.1f}% , {hi2*100:.1f}%]")
print()

def binom_pmf(n,k,p):
    if p<=0: return 1.0 if k==0 else 0.0
    if p>=1: return 1.0 if k==n else 0.0
    return comb(n,k)*(p**k)*((1-p)**(n-k))

@lru_cache(maxsize=None)
def fisher(a,b,c,d):
    n1=a+b;n2=c+d;k=a+c;N=n1+n2
    tot=comb(N,k);s=0
    for x in range(a,min(n1,k)+1): s+=comb(n1,x)*comb(n2,k-x)
    return s/tot

def power(n,pc,pt,alpha):
    pw=0.0
    for a in range(n+1):
        pa=binom_pmf(n,a,pt)
        if pa<1e-14: continue
        for c in range(n+1):
            pc_=binom_pmf(n,c,pc)
            if pc_<1e-14: continue
            if fisher(a,n-a,c,n-c)<=alpha: pw+=pa*pc_
    return pw

def n_for(pc,pt,alpha,target=0.80,cap=1500):
    n=10
    while n<=cap:
        if power(n,pc,pt,alpha)>=target: return n
        n+= 5 if n<150 else 25
    return None

print("=== §13/§14  N por grupo, alpha UNILATERAL 0,05 x alpha ajustado 0,0294 (3 checkpoints, Pocock aprox) ===")
print(f"{'cenario':<18}{'N/grupo a=.05':>15}{'N/grupo a=.0294':>18}{'total ajustado':>16}{'meses a 12/mes':>16}")
for pt in [0.15,0.20,0.25,0.30]:
    n1=n_for(0.10,pt,0.05); n2=n_for(0.10,pt,0.0294)
    tot=2*n2 if n2 else None
    meses = round((tot-29)/12,1) if tot else None
    print(f"{'10% -> '+str(int(pt*100))+'%':<18}{str(n1):>15}{str(n2):>18}{str(tot):>16}{str(meses):>16}")

print()
print("=== §15 FUTILITY: com N total realista (120), qual poder sobra por cenario? ===")
for pt in [0.15,0.20,0.25,0.30]:
    print(f"  10% -> {int(pt*100)}%: power(60x60, a=.0294) = {power(60,0.10,pt,0.0294)*100:.1f}%")
print()
print("=== §14 probabilidade de parar por eficacia em cada checkpoint (n por grupo) ===")
for pt in [0.20,0.25,0.30]:
    row=[f"10%->{int(pt*100)}%"]
    for n in [20,40,60]:
        row.append(f"n={n}: {power(n,0.10,pt,0.0294)*100:.0f}%")
    print("  "+" | ".join(row))
