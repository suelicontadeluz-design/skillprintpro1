from math import comb, exp, log
from functools import lru_cache

def binom_pmf(n,k,p):
    if p<=0: return 1.0 if k==0 else 0.0
    if p>=1: return 1.0 if k==n else 0.0
    return comb(n,k)*(p**k)*((1-p)**(n-k))

@lru_cache(maxsize=None)
def fisher_one_sided(a,b,c,d):
    # table [[a,b],[c,d]] ; a = sucessos tratamento, b = falhas trat, c = sucessos ctrl, d = falhas ctrl
    n1=a+b; n2=c+d; k=a+c; N=n1+n2
    # P(X >= a) sob hipergeometrica
    tot=comb(N,k); s=0.0
    lo=max(0,k-n2); hi=min(n1,k)
    for x in range(a,hi+1):
        s+=comb(n1,x)*comb(n2,k-x)
    return s/tot

def power(n_t,n_c,p_c,p_t,alpha=0.05):
    pw=0.0
    for a in range(n_t+1):
        pa=binom_pmf(n_t,a,p_t)
        if pa<1e-15: continue
        for c in range(n_c+1):
            pc=binom_pmf(n_c,c,p_c)
            if pc<1e-15: continue
            if fisher_one_sided(a,n_t-a,c,n_c-c)<=alpha:
                pw+=pa*pc
    return pw

def mde(n_t,n_c,p_c,alpha=0.05,target=0.80):
    lo,hi=p_c,0.999
    for _ in range(60):
        mid=(lo+hi)/2
        if power(n_t,n_c,p_c,mid,alpha)>=target: hi=mid
        else: lo=mid
    return hi

def n_needed(p_c,p_t,alpha=0.05,target=0.80,cap=4000):
    n=5
    while n<=cap:
        if power(n,n,p_c,p_t,alpha)>=target: return n
        n+= 5 if n<200 else 25
    return None

print("=== FREQ_2_3 : baseline D30 = 10.2% , 29 contataveis (14 x 15) ===")
pc=0.102
print(f"MDE (power 80%, alpha .05 unilateral): {mde(14,15,pc)*100:.1f}%  -> uplift absoluto {(mde(14,15,pc)-pc)*100:.1f} pp")
print("cenario -> power")
for pt in [0.152,0.202,0.252,0.302,0.402,0.502]:
    print(f"  {pc*100:.1f}% -> {pt*100:.1f}%  (+{(pt-pc)*100:.0f} pp): power = {power(14,15,pc,pt)*100:.1f}%")

print()
print("=== TODOS os 45 contataveis (22 x 23), baseline agregado D30 = 43.9% ===")
pc2=0.439
print(f"MDE: {mde(22,23,pc2)*100:.1f}% -> uplift {(mde(22,23,pc2)-pc2)*100:.1f} pp")
for pt in [0.489,0.539,0.589,0.639,0.739]:
    print(f"  {pc2*100:.1f}% -> {pt*100:.1f}% (+{(pt-pc2)*100:.0f} pp): power = {power(22,23,pc2,pt)*100:.1f}%")

print()
print("=== N NECESSARIO POR GRUPO (power 80%, alpha .05 unilateral), baseline 10.2% ===")
for pt in [0.152,0.202,0.252,0.302,0.402]:
    n=n_needed(pc,pt)
    print(f"  10.2% -> {pt*100:.1f}% (+{(pt-pc)*100:.0f} pp): n por grupo = {n}, total = {2*n if n else None}")
