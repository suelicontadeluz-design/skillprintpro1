import { AsyncLocalStorage } from 'node:async_hooks';

declare const Deno: any;

type HafRequestContext = {
  phone: string | null;
  chatName: string | null;
  dryRun: boolean;
};

const HAF_CTX_GLOBAL = '__HAF_REQUEST_CONTEXT_V1__';
const g = globalThis as any;
const hafAls: AsyncLocalStorage<HafRequestContext> =
  g[HAF_CTX_GLOBAL] instanceof AsyncLocalStorage
    ? g[HAF_CTX_GLOBAL]
    : new AsyncLocalStorage<HafRequestContext>();

g[HAF_CTX_GLOBAL] = hafAls;

const hafNativeServe = Deno.serve.bind(Deno);

(Deno as any).serve = (...args: any[]) => {
  const handlerIndex = typeof args[0] === 'function' ? 0 : 1;
  const handler = args[handlerIndex];
  if (typeof handler !== 'function') throw new TypeError('Deno.serve handler missing');

  args[handlerIndex] = async (req: Request, info: any) => {
    let ctx: HafRequestContext = { phone: null, chatName: null, dryRun: false };
    try {
      if (req.method === 'POST' && (req.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        const body = await req.clone().json().catch(() => null);
        if (body && typeof body === 'object') {
          const phone = String(body.phone ?? '').replace(/\D/g, '');
          ctx = {
            phone: phone || null,
            chatName: String(body.chat_name ?? body.chatName ?? '').trim() || null,
            dryRun: body._dry_run === true,
          };
        }
      }
    } catch {}
    return hafAls.run(ctx, () => handler(req, info));
  };

  return hafNativeServe(...args as any);
};

export const __hafRequestContext = hafAls;
