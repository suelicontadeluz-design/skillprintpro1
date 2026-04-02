# Skiprintpro Admin

Painel administrativo do programa de fidelidade Skiprintpro.
Backend: Supabase (projeto `jjigrdmtanyxrzmkelvz`, região `sa-east-1`)
Frontend: Next.js 14 App Router

---

## Deploy na Vercel (via GitHub)

### Pré-requisito: variáveis de ambiente

Você precisará da **Anon Key** do Supabase:
1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard)
2. Abra o projeto **Skiprintpro** (`jjigrdmtanyxrzmkelvz`)
3. Vá em **Settings → API**
4. Copie o valor de **anon public**

---

## Desenvolvimento local

```bash
cp .env.example .env.local
# Edite .env.local e cole sua anon key

npm install
npm run dev
# http://localhost:3000/admin/dashboard
```
