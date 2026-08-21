# Lista mínima para a entrevista física — peso, dimensões e embalagem

Gerada em 21/08/2026 (rodada 2) **depois** de esgotar tudo o que o sistema já
tinha. Só entra aqui o que nenhuma fonte existente pode responder.

Fonte da lista: `ERP.public.produtos` (12 ativos, `deleted_at is null`).
Estado hoje: **1 de 12** com peso e dimensões; `gramatura_g_m2` NULL em 12 de 12.

**Não pergunte o que já está no sistema.** Endereço do cliente, documento,
telefone, e-mail e valor do pedido já têm fonte canônica provada — não fazem
parte desta entrevista.

## Regime A — venda por `unidade` (11 produtos)

| Produto | peso | dimensões | falta |
|---|---|---|---|
| Baby look 100% algodão | 0,150 kg | 10 × 30 × 40 cm | **só confirmar** se é peça nua ou já embalada |
| Baby Look Plus Size 100% Algodão | — | — | tudo |
| Camisa Polo Personalizada | — | — | tudo |
| Camiseta Básica 02 (`CAM`) | — | — | tudo |
| Camiseta Básica 100% Algodão (`CAM`) | — | — | tudo |
| Camiseta Básica Plus Size 100% Algodão | — | — | tudo |
| Camiseta Infantil 100% Algodão | — | — | tudo |
| Camiseta Oversized 100% Algodão | — | — | tudo |
| Camiseta Teste (`CAM`) | — | — | descartável? confirmar se sai do catálogo |
| Moletom Canguru Personalizado | — | — | tudo |
| Moletom Careca Personalizado | — | — | tudo |

Para cada um:

1. **peso** da peça em kg — dizer se é peça nua ou já dobrada/embalada;
2. **dimensões** da peça dobrada, em cm (altura × largura × comprimento);
3. **variação por tamanho** — os 12 produtos têm `tem_variacoes = true`.
   P e GG pesam igual? Se não, precisamos de peso por faixa de tamanho, não por produto;
4. **embalagem** — saco, caixa ou envelope; peso e medidas da embalagem vazia;
5. **regra de empilhamento** — quantas peças cabem por volume antes de virar
   um segundo volume, e quanto muda a altura por peça adicional.

## Regime B — venda por `metro_linear` (1 produto)

**Filme DTF Têxtil Impresso** (`DTF-TXT`)

1. **peso por metro linear** real, por largura de filme — a heurística atual usa
   100 g/m fixo para toda largura;
2. **caixa/tubo** usado por faixa de metragem, com medidas reais — a heurística
   atual usa 60×13×13 até 40 m e 60×26×13 acima, sem evidência registrada;
3. **piso de peso** — `calcular-frete` aplica 300 g mínimo; é real ou é chute?
4. **limite de metragem por volume** antes de dividir em dois.

## Regime C — pedido misto

Um pedido com camisetas **e** filme DTF vira um volume só ou dois? Se um só,
qual embalagem manda na medida?

## Evidência pedida

Foto da balança e da fita métrica para pelo menos um item de cada regime, ou
uma planilha assinada. Precisa distinguir **peça** de **volume postado** — a
transportadora cobra o volume.

## Onde isso entra (atualizado em 21/08/2026)

As tabelas de destino **já existem** no ERP — foram criadas em 21/08/2026 pela
migration `logistica_envio_estado_canonico`, e estão vazias esperando estes dados:

| Dado | Tabela | Colunas |
|---|---|---|
| peso e dimensões da **peça** | `ERP.public.logistica_produto_medida` | `peso_kg`, `altura_cm`, `largura_cm`, `comprimento_cm`, `origem`, `medido_por`, `medido_em`, `evidencia_url` |
| regra de embalagem/empilhamento | `ERP.public.logistica_embalagem_regra` | `pecas_por_volume`, `volume_altura_cm`, `volume_largura_cm`, `volume_comprimento_cm`, `tara_kg`, `origem`, `definida_por`, `definida_em` |

Duas coisas de propósito nesse desenho:

1. **`medido_por` e `medido_em` são `NOT NULL`.** Sem quem mediu e quando, não é
   procedência — é só um número. Por isso o peso legado de `public.produtos`
   (0,150 kg do Baby look) **não migra sozinho**: ninguém sabe quem o digitou.
2. **A regra de embalagem é uma tabela separada da medida.** É o que separa "o
   produto tem peso" de "sei o peso do volume postado". O caso didático está no
   ERP: a **venda 30 tem 40 unidades** de um produto cadastrado com 0,150 kg e
   10 × 30 × 40 cm — medidas de **uma peça**. Quarenta peças não cabem nessa
   caixa, e o frete cobra o volume.

`origem` só aceita `FICHA_FISICA` ou `AFERIDO_NA_EXPEDICAO`. A heurística
`HEURISTICA_CONFIG` continua cotando e nunca emite.
