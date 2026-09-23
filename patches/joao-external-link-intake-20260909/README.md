# João — External Link Intake v1 / media_handling v2

## Objetivo
Permitir que o vendedor trate links HTTP(S) enviados pelo cliente como entrada operacional real: classificar provedor/tipo, tentar leitura pública antes de alegar incapacidade e falhar de forma específica sem inventar conteúdo.

## Onde estávamos
- `media_handling/v1`: classifica mídia e riscos, sem executor específico de link.
- João já possuía `web_fetch_20250910` via `joao-link-navigation-20260908/web-fetch-preload.ts`.
- O runtime dizia para abrir links públicos, mas não havia contrato v2, classificação determinística de provedor/tipo, telemetria de tentativa/resultado nem prova técnica vinculada ao skill contract.

## Para onde queremos chegar
Pipeline progressivo e fail-closed:
1. URL HTTP(S) recente do cliente.
2. Classificação determinística de provedor e tipo.
3. `web_fetch` simples primeiro.
4. Se simples falhar, encaminhar depois para handler especializado (Drive/Canva/Dropbox/OneDrive/WeTransfer/browser).
5. Nunca alegar leitura sem evidência da ferramenta.
6. Conteúdo remoto sempre não confiável e sem autoridade comercial.

## Esta etapa NÃO faz
- download de pasta do Google Drive;
- extração de ZIP;
- browser/Playwright;
- exportação do Canva;
- remoção/validação de fundo transparente;
- preço, frete, pagamento ou qualquer efeito comercial.

## Reuso externo
Método adaptado de `browserbase/skills`, `skills/fetch/SKILL.md`, MIT, commit `6811ca31163332d9d60309cff48e77f09de37a17`.
A adaptação usa apenas o desenho `fetch-first -> verificar resultado -> fallback especializado -> conteúdo não confiável`. Nenhuma dependência Browserbase foi adicionada; o executor primário continua sendo o `web_fetch` já existente no João.

## Testes locais
`external-link-intake-core.test.ts` cobre 8 classes principais e 15 grupos de assertions:
- Google Drive
- Google Docs
- Canva
- Dropbox + imagem
- OneDrive
- WeTransfer
- arquivo PNG direto
- página web genérica
- URL não HTTP(S)
- pontuação após URL
- múltiplas URLs
- telemetria sem query token
- web_fetch success
- web_fetch error
- fetch não observado

## Córtex
- skill: `media_handling`
- contract: v2 / taxonomy v7
- contract id: `da0ae797-3777-47a3-beae-4df990457fb0`
- contract hash: `sha256:d3cb81a632f3346513131cc35891fd1bfdfa81da7e0ee7e34f1ba8d3ac31a755`
- technical certification: TEST_SHADOW_ONLY
- certification id: `cd6740c4-96d6-428a-8cdf-c89fc3a76504`
- authority: false
- production certified: false

## Shadow
`external-link-intake-shadow-preload.ts` deve ser importado ANTES do web-fetch v1 atual. Isso permite observar a requisição já modificada pelo wrapper v1 e o resultado retornado pela Anthropic sem alterar o comportamento do vendedor.

Kill switch:
`public.sistema_config.chave = 'joao_external_link_intake_shadow_ativo'`

## Critério para promoção
Não promover só porque o deploy está ACTIVE. Exigir:
- transporte/cron saudável após deploy;
- shadow prova `web_fetch_present_in_actual_request=true` para links reais;
- ausência de regressões de venda;
- resultado observável ou erro honesto para links reais;
- nenhum segredo/query token gravado em telemetria;
- depois substituir o v1 antigo por um único preload v2, sem wrappers duplicados.
