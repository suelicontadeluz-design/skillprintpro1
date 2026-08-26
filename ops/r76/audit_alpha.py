#!/usr/bin/env python3
"""
R76 — Auditoria do erro tipo I global do pre-registro EXP-REATIV-V2.

Desenho auditado (lido do pre-registro, nao inferido):
  - dois bracos, acrual ate n = 20, 40, 70 por braco
  - desfecho binario (compra canonica em D30)
  - teste: Fisher exato UNILATERAL (tratamento > controle), P(X >= a) hipergeometrica
  - EFFICACY: parar e declarar se p <= 0.0294 em qualquer look
  - FUTILITY: em n=20 e n=40, parar sem declarar se o poder condicional de rejeitar
    em n=70, sob a alternativa PINADA 0.102 -> 0.302, cair abaixo de 0.20
  - efficacy anterior encerra o estudo: nao ha looks seguintes

Saida deterministica. Nenhum dado futuro entra.
"""
from math import comb
from functools import lru_cache

ALPHA_CP   = 0.0294          # boundary por checkpoint, conforme V2
LOOKS      = (20, 40, 70)    # n por braco
N_MAX      = LOOKS[-1]
FUT_THRESH = 0.20
PIN_PC, PIN_PT = 0.102, 0.302   # alternativa pinada, imutavel
GRID = (0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50)
EPS = 1e-15

def bp(n, k, p):
    if p <= 0: return 1.0 if k == 0 else 0.0
    if p >= 1: return 1.0 if k == n else 0.0
    return comb(n, k) * (p ** k) * ((1 - p) ** (n - k))

@lru_cache(maxsize=None)
def fisher_1s(a, b, c, d):
    """P(X >= a) sob a hipergeometrica condicional. Unilateral: tratamento > controle."""
    n1, n2, k = a + b, c + d, a + c
    tot = comb(n1 + n2, k)
    s = 0
    for x in range(a, min(n1, k) + 1):
        s += comb(n1, x) * comb(n2, k - x)
    return s / tot

@lru_cache(maxsize=None)
def rejeita(a, c, n):
    return fisher_1s(a, n - a, c, n - c) <= ALPHA_CP

@lru_cache(maxsize=None)
def cond_power(n_int, a, c):
    """P(rejeitar em N_MAX | dados ate n_int) sob a alternativa pinada."""
    r = N_MAX - n_int
    s = 0.0
    for da in range(r + 1):
        pa = bp(r, da, PIN_PT)
        if pa < 1e-13: continue
        for dc in range(r + 1):
            pc = bp(r, dc, PIN_PC)
            if pc < 1e-13: continue
            if rejeita(a + da, c + dc, N_MAX):
                s += pa * pc
    return s

def alpha_global(p0, aplicar_futility):
    """Erro tipo I family-wise sob H0: p_trat = p_ctrl = p0."""
    rej_por_look = []
    vivos = {(0, 0): 1.0}      # estados (a, c) que chegam vivos ao proximo look
    n_ant = 0
    for i, n in enumerate(LOOKS):
        passo = n - n_ant
        # acrual: convolucao com Bin(passo, p0) em cada braco
        novos = {}
        inc = [(k, bp(passo, k, p0)) for k in range(passo + 1) if bp(passo, k, p0) > EPS]
        for (a, c), pr in vivos.items():
            for da, pa in inc:
                for dc, pc in inc:
                    q = pr * pa * pc
                    if q < EPS: continue
                    key = (a + da, c + dc)
                    novos[key] = novos.get(key, 0.0) + q
        # avaliacao do look
        rej = 0.0
        segue = {}
        ultimo = (i == len(LOOKS) - 1)
        for (a, c), pr in novos.items():
            if rejeita(a, c, n):
                rej += pr
            elif not ultimo:
                if aplicar_futility and cond_power(n, a, c) < FUT_THRESH:
                    pass                      # para por futilidade, nao declara
                else:
                    segue[(a, c)] = pr
        rej_por_look.append(rej)
        vivos = segue
        n_ant = n
    return rej_por_look, sum(rej_por_look)

def set_boundary(b):
    global ALPHA_CP
    ALPHA_CP = b
    rejeita.cache_clear()
    cond_power.cache_clear()

def main():
    print("=" * 78)
    print("AUDITORIA DE ALPHA GLOBAL — EXP-REATIV-V2")
    print(f"looks n por braco = {LOOKS} | boundary por look = {ALPHA_CP} | Fisher exato UNILATERAL")
    print(f"futility: poder condicional < {FUT_THRESH} sob alternativa pinada {PIN_PC} -> {PIN_PT}")
    print("=" * 78)
    for modo, aplica in (("NON-BINDING (futility NAO aplicada — caso valido sempre)", False),
                         ("BINDING (futility aplicada)", True)):
        print(f"\n--- {modo} ---")
        print(f"{'p0':>6} | {'look n=20':>10} {'look n=40':>10} {'look n=70':>10} | {'ALPHA GLOBAL':>13}")
        pior = (None, -1.0)
        for p0 in GRID:
            looks, tot = alpha_global(p0, aplica)
            print(f"{p0:>6.2f} | {looks[0]:>10.5f} {looks[1]:>10.5f} {looks[2]:>10.5f} | {tot:>13.5f}")
            if tot > pior[1]: pior = (p0, tot)
        print(f"  PIOR CASO: p0 = {pior[0]:.2f}  ->  alpha global = {pior[1]:.5f}"
              f"  {'<= 0.05 OK' if pior[1] <= 0.05 else '> 0.05 FALHA'}")
    print()
    print("--- §2: o boundary 0,0294 continua valido para 20/40/70? ---")
    print("    (a V1 usava 20/40/60; nao se copia boundary sem revalidar)")
    for b in (0.0500, 0.0400, 0.0350, 0.0294, 0.0250, 0.0200):
        set_boundary(b)
        pior = max(alpha_global(p0, False)[1] for p0 in GRID)
        print(f"    boundary {b:.4f} -> alpha global (pior caso, non-binding) = {pior:.5f}"
              f"  {'OK' if pior <= 0.05 else 'FALHA'}")
    set_boundary(0.0294)

if __name__ == "__main__":
    main()
