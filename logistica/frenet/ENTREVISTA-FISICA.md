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

## Onde isso entra

`ERP.public.produtos.peso_bruto_kg`, `.altura_cm`, `.largura_cm`,
`.comprimento_cm` (e `gramatura_g_m2` para o filme). A regra de embalagem e
empilhamento **não tem tabela ainda** — nasce depois da entrevista, junto com a
frente `entrega-cep-e-frete-sem-fonte-fiel`, que já está bloqueada exatamente
nisso.

Enquanto isso, `pacote.origem_medida` só aceita `FICHA_FISICA` ou
`AFERIDO_NA_EXPEDICAO`. `HEURISTICA_CONFIG` continua cotando e nunca emite.
