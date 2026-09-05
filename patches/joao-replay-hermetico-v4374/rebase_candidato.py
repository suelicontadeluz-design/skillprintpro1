#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OLD_HERMETIC_COMMIT = "3f1ecf3c24859b628c5baea1d17d2e7620c7faf1"
LIVE_V4371_COMMIT = "58f64326271f3a38e5b92ee322ff5dfcd0866816"
LIVE_V4374_COMMIT = "5ea0aa377acf6b117b270cdcce0ea5cc3afb9091"
LIVE_PATH = "patches/joao-slot-proveniencia-escrita/candidato/index.ts"
OLD_HERMETIC_PATH = "patches/joao-replay-hermetico/candidato/index.ts"
OUT = ROOT / "patches/joao-replay-hermetico-v4374/candidato/index.ts"
DIFF_OUT = ROOT / "patches/joao-replay-hermetico-v4374/candidato/v4.37.4__replay-hermetico.2.diff"


def run(*args: str, input_text: str | None = None) -> str:
    p = subprocess.run(args, cwd=ROOT, input=input_text, text=True, capture_output=True)
    if p.returncode != 0:
        raise SystemExit(f"falhou: {' '.join(args)}\nstdout={p.stdout}\nstderr={p.stderr}")
    return p.stdout


def git_show(commit: str, path: str) -> str:
    return run("git", "show", f"{commit}:{path}")


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


# 1) Fonte hermetica ja provada em 30/08.
old_hermetic = git_show(OLD_HERMETIC_COMMIT, OLD_HERMETIC_PATH)

# 2) Delta acumulado da linha LIVE entre a baseline exata do replay antigo e a v4.37.4 viva.
live_delta = run(
    "git", "diff", "--no-ext-diff", "--binary",
    LIVE_V4371_COMMIT, LIVE_V4374_COMMIT, "--", LIVE_PATH,
)

# 3) Rebasa o delta LIVE por cima do candidato hermetico. Fuzz ZERO: conflito para a rodada.
with tempfile.TemporaryDirectory() as td:
    td = pathlib.Path(td)
    src = td / "hermetic-v4371.ts"
    delta = td / "live-v4371-v4374.diff"
    rebased = td / "rebased.ts"
    src.write_text(old_hermetic)
    delta.write_text(live_delta)
    run("patch", "--batch", "--fuzz=0", "-o", str(rebased), str(src), str(delta))
    candidate = rebased.read_text()

# 4) Corrige divergencias medidas em 05/09.
# fn_compor_total e SECURITY DEFINER mutadora; nunca pode atravessar como leitura no replay.
old_read = "'fn_compor_total', 'fn_dtf_uv_capacidade_folha'"
new_read = "'fn_dtf_uv_capacidade_folha', 'fn_precificar_dtf_uv_v2'"
if candidate.count(old_read) != 1:
    raise SystemExit(f"anchor RPC_LEITURA inesperado: ocorrencias={candidate.count(old_read)}")
candidate = candidate.replace(old_read, new_read, 1)

# Marca contrato e comentarios com a baseline realmente rebasada.
repls = {
    "A1 REPLAY HERMETICO — contrato a1_replay_hermetico_v1 (v4.37.1-replay-hermetico.1)":
        "A1 REPLAY HERMETICO — contrato a1_replay_hermetico_v2 (v4.37.4-replay-hermetico.2)",
    "live   → caminho identico ao v4.37.1: mesmo cliente service-role, mesmo fetch.":
        "live   → caminho identico ao v4.37.4: mesmo cliente service-role, mesmo fetch.",
    "const REPLAY_CONTRACT = 'a1_replay_hermetico_v1';":
        "const REPLAY_CONTRACT = 'a1_replay_hermetico_v2';",
    "v4.37.1. body._dry_run continua existindo e NAO e modo":
        "v4.37.4. body._dry_run continua existindo e NAO e modo",
}
for old, new in repls.items():
    if candidate.count(old) != 1:
        raise SystemExit(f"anchor de versao ausente/duplicado: {old!r} -> {candidate.count(old)}")
    candidate = candidate.replace(old, new, 1)

# 5) Assertions de que o rebase trouxe os fixes vivos e manteve as duas barreiras.
required = [
    "REPLAY_RUNNER_JWT",
    "fetchHermetico",
    "http_externo_bloqueado",
    "fn_replay_snapshot",
    "resolverPhoneCorpus",
    "joao_fatal_unhandled_v191_diag",
    "RX_PROMESSA_PRODUCAO_EXATA",
    "fn_precificar_dtf_uv_v2",
    "a1_replay_hermetico_v2",
]
missing = [x for x in required if x not in candidate]
if missing:
    raise SystemExit("candidato incompleto: " + ", ".join(missing))
if "'fn_compor_total', 'fn_dtf_uv_capacidade_folha'" in candidate:
    raise SystemExit("fn_compor_total ainda classificada como leitura")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(candidate)

live = git_show(LIVE_V4374_COMMIT, LIVE_PATH)
with tempfile.TemporaryDirectory() as td:
    td = pathlib.Path(td)
    a = td / "live.ts"
    b = td / "candidate.ts"
    a.write_text(live)
    b.write_text(candidate)
    p = subprocess.run(
        ["diff", "-u", "--label", "live-v4.37.4", "--label", "candidate-replay-hermetico.2", str(a), str(b)],
        cwd=ROOT, text=True, capture_output=True,
    )
    if p.returncode not in (0, 1):
        raise SystemExit(f"diff falhou: {p.stderr}")
    diff = p.stdout
DIFF_OUT.write_text(diff)

print("OK rebase hermetico v4.37.4")
print("live_sha256     =", sha256_text(live))
print("candidate_sha256=", sha256_text(candidate))
print("candidate       =", OUT.relative_to(ROOT))
print("diff            =", DIFF_OUT.relative_to(ROOT))
