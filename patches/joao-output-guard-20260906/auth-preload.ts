const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const nativeFetch = globalThis.fetch.bind(globalThis);
const nativeServe = Deno.serve.bind(Deno);

async function ingressAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${SERVICE}`) return true;

  const cronSecret = req.headers.get("x-cron-secret") || "";
  if (!cronSecret) return false;

  try {
    const res = await nativeFetch(`${SUPABASE_URL}/rest/v1/rpc/fn_edge_cron_auth_ok_v1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": SERVICE,
        "authorization": `Bearer ${SERVICE}`,
      },
      body: JSON.stringify({ p_token: cronSecret }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

(Deno as any).serve = (...args: any[]) => {
  const handlerIndex = typeof args[0] === "function" ? 0 : 1;
  const handler = args[handlerIndex];
  if (typeof handler !== "function") throw new TypeError("Deno.serve handler missing");

  args[handlerIndex] = async (req: Request, info: any) => {
    if (!(await ingressAuthorized(req))) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return handler(req, info);
  };

  return nativeServe(...args as any);
};
