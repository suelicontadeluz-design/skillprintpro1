#!/usr/bin/env python3
"""Prova: candidato - (bloco hermetico + gate de entrada) == baseline, byte a byte.

O contrato a1_replay_hermetico_v1 e composto por exatamente duas insercoes:
  (a) troca de `const sb = createClient(...)` por `const sbLive = createClient(...)`
      seguida do bloco hermetico, delimitado pelos marcadores abaixo;
  (b) gate de modo logo apos o parse do body em Deno.serve, delimitado por
      comentario proprio.
Removidas as duas, o arquivo resultante tem de ser IDENTICO ao baseline.
"""
import re, sys, hashlib

base = open(sys.argv[1], 'rb').read().decode('utf-8')
cand = open(sys.argv[2], 'rb').read().decode('utf-8')

ini = cand.index('const sbLive = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);')
fim_marc = '// ═════ fim do bloco A1 REPLAY HERMETICO'
fim = cand.index(fim_marc)
fim = cand.index('\n', fim) + 1
rev = cand[:ini] + 'const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);\n' + cand[fim:]

gate_ini = rev.index('\n  // A1 REPLAY HERMETICO: o modo e decidido AQUI')
gate_fim = rev.index('atenderHermetico(body, modoPedido);\n', gate_ini)
gate_fim = rev.index('\n', gate_fim) + 1
# consome tambem a linha em branco que fecha o gate
if rev[gate_fim:gate_fim+1] == '\n':
    gate_fim += 1
rev = rev[:gate_ini] + rev[gate_fim:]

ok = rev == base
print('baseline sha256 :', hashlib.sha256(base.encode()).hexdigest())
print('candidato sha256:', hashlib.sha256(cand.encode()).hexdigest())
print('REVERSIVEL_BYTE_A_BYTE:', ok)
sys.exit(0 if ok else 1)
