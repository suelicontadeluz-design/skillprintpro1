#!/usr/bin/env python3
"""Sanitiza PII de cliente do artefato do Joao, mexendo SO em literais de PII.

USO:
    python3 sanitizar.py <entrada.ts> <saida.ts> [nomes.json]

`nomes.json` (NAO versionado, por conter PII) mapeia primeiro nome de cliente
para rotulo generico, ex.: {"Fulana": "cliente A"}. Sem ele, so os literais
numericos sao sanitizados.

REGRAS
  - telefone: preserva DDI + DDD e o COMPRIMENTO; o corpo vira sintetico
    sequencial obviamente falso ('9' + zeros + indice).
  - telefone formatado: mesmo formato, corpo sintetico.
  - CEP: 00000-000 (inequivocamente sintetico).
  - nome de cliente colado a um caso anotado: rotulo generico.
  - nomes de FUNCIONARIO nao sao tocados: eles vivem em RX_HUMANO, que e
    codigo funcional, nao comentario.

Determinismo: o mesmo valor de entrada gera sempre a mesma saida sintetica,
entao reexecutar a sanitizacao reproduz byte a byte o mesmo artefato.
"""
import re, sys, json, hashlib, collections

if len(sys.argv) < 3:
    print(__doc__)
    raise SystemExit(2)

ent, sai = sys.argv[1], sys.argv[2]
nomes = json.load(open(sys.argv[3], encoding='utf-8')) if len(sys.argv) > 3 else {}

src = open(ent, encoding='utf-8').read()

RX_TEL = re.compile(r'\b55[1-9]\d{9,10}\b')
RX_FMT = re.compile(r'\((\d{2})\)\s?(9?\d{4})[-\s]?(\d{4})')
RX_CEP = re.compile(r'\b\d{5}-\d{3}\b')

mapa = collections.OrderedDict()

def sint_tel(orig: str) -> str:
    if orig in mapa:
        return mapa[orig]
    i = len([k for k in mapa if k.startswith('55')]) + 1
    ddd = orig[2:4]
    corpo_len = len(orig) - 4
    idx = f'{i:03d}'
    novo = '55' + ddd + '9' + '0' * (corpo_len - 1 - len(idx)) + idx
    assert len(novo) == len(orig), (len(orig), len(novo))
    mapa[orig] = novo
    return novo

def sint_fmt(m) -> str:
    orig = m.group(0)
    if orig in mapa:
        return mapa[orig]
    ddd, p1 = m.group(1), m.group(2)
    mapa[orig] = f"({ddd}) {'9' + '0' * (len(p1) - 1)}-{len(mapa) + 1:04d}"
    return mapa[orig]

def sint_cep(m) -> str:
    mapa.setdefault(m.group(0), '00000-000')
    return mapa[m.group(0)]

out = RX_TEL.sub(lambda m: sint_tel(m.group(0)), src)
out = RX_FMT.sub(sint_fmt, out)
out = RX_CEP.sub(sint_cep, out)
for real, generico in nomes.items():
    out = re.sub(r'(?<![A-Za-z])' + re.escape(real) + r'(?![A-Za-z])', generico, out)
    mapa[real] = generico

open(sai, 'w', encoding='utf-8').write(out)
print('entrada sha256:', hashlib.sha256(src.encode()).hexdigest())
print('saida   sha256:', hashlib.sha256(out.encode()).hexdigest())
print('substituicoes distintas:', len(mapa))
print('linhas entrada/saida:', src.count('\n'), '/', out.count('\n'))
