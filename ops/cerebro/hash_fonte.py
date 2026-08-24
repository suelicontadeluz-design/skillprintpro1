#!/usr/bin/env python3
"""
REGRA CANONICA DE HASH DE FONTE — Cerebro / Edge Functions
==========================================================
Produz um hash reproduzivel do FONTE de uma Edge (1..N arquivos).

NAO confundir com ezbr_sha256:
  - ezbr_sha256 e hash do BUNDLE eszip/brotli (artefato de BUILD).
    Serve para DETECTAR MUDANCA de deploy. Nao e prova do fonte.
  - o hash desta regra e calculado sobre os BYTES DOS ARQUIVOS.
    E a unica prova byte-exata de equivalencia de fonte.

REGRA (v1):
  1. Unidade = conjunto de arquivos do fonte.
  2. Caminho relativo a raiz do fonte, separador POSIX "/", sem "./".
  3. Ordem determinista: ordenacao por BYTES do caminho (C locale, nao locale-aware).
  4. Newline: SEM normalizacao. Os bytes entram verbatim.
     CRLF e LF produzem hashes DIFERENTES, por design — normalizar
     esconderia uma diferenca real entre o que esta no repo e o que roda.
  5. Serializacao por arquivo, com separadores NUL para o caminho nunca colidir:
         path_utf8 || 0x00 || len_decimal_utf8 || 0x00 || bytes_do_arquivo
  6. H = sha256( concatenacao na ordem do item 3 ).
  7. Arquivo vazio participa (len=0). Diretorio nao participa.

Saida: hash canonico + manifesto por arquivo (sha256 individual + tamanho).
"""
import hashlib, json, os, sys

REGRA = "cerebro/hash-fonte/v1"

def arquivos(raiz):
    if os.path.isfile(raiz):
        return [(os.path.basename(raiz), raiz)]
    out = []
    for dirpath, dirnames, filenames in os.walk(raiz):
        dirnames.sort()
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, raiz).replace(os.sep, "/")
            out.append((rel, full))
    return out

def hash_fonte(raiz):
    itens = arquivos(raiz)
    # item 3: ordem por BYTES do caminho
    itens.sort(key=lambda t: t[0].encode("utf-8"))
    h = hashlib.sha256()
    manifesto = []
    for rel, full in itens:
        with open(full, "rb") as f:
            b = f.read()
        h.update(rel.encode("utf-8")); h.update(b"\x00")
        h.update(str(len(b)).encode("utf-8")); h.update(b"\x00")
        h.update(b)
        manifesto.append({"path": rel, "bytes": len(b),
                          "sha256_arquivo": hashlib.sha256(b).hexdigest()})
    return {"regra": REGRA, "hash_fonte": h.hexdigest(),
            "arquivos": len(manifesto), "manifesto": manifesto}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("uso: hash_fonte.py <arquivo-ou-diretorio>", file=sys.stderr); sys.exit(2)
    print(json.dumps(hash_fonte(sys.argv[1]), ensure_ascii=False, indent=2))
