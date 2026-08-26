from math import comb
from functools import lru_cache
def bp(n,k,p):
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
        pa=bp(n,a,pt)
        if pa<1e-14: continue
        for c in range(n+1):
            pcc=bp(n,c,pc)
            if pcc<1e-14: continue
            if fisher(a,n-a,c,n-c)<=alpha: pw+=pa*pcc
    return pw
ALPHA=0.0294; PC=0.102; PT=0.302  # alternativa PINADA: +20 pp sobre o baseline pre-registrado
print(f"Poder no N_MAX (70/braco), alternativa {PC:.3f}->{PT:.3f}, alpha={ALPHA}: {power(70,PC,PT,ALPHA)*100:.1f}%")
print(f"Poder em 60/braco (o que V1 usava): {power(60,PC,PT,ALPHA)*100:.1f}%")
print()
def cond_power(n_int, a_int, c_int, n_max, pc, pt, alpha):
    """P(rejeitar no final | dados ate n_int) sob a alternativa pinada."""
    r=n_max-n_int; s=0.0
    for da in range(r+1):
        pa=bp(r,da,pt)
        if pa<1e-13: continue
        for dc in range(r+1):
            pcc=bp(r,dc,pc)
            if pcc<1e-13: continue
            A=a_int+da; C=c_int+dc
            if fisher(A,n_max-A,C,n_max-C)<=alpha: s+=pa*pcc
    return s
print("=== Poder condicional para a alternativa pinada 10,2% -> 30,2%, N_MAX=70/braco ===")
for n_int in (20,40):
    print(f"-- checkpoint n={n_int} por braco --")
    print(f"   {'trat':>5}{'ctrl':>6}{'CP':>9}   (CP<20% dispara FUTILITY)")
    for a in range(0,9):
        for c in (0,2,4):
            if a> n_int or c>n_int: continue
            cp=cond_power(n_int,a,c,70,PC,PT,ALPHA)
            flag=" <= FUTIL" if cp<0.20 else ""
            if a in (0,1,2,3,5,8) and c in (0,2,4):
                print(f"   {a:>5}{c:>6}{cp*100:>8.1f}%{flag}")
    print()
