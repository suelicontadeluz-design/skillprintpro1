// Substitui 'https://esm.sh/@supabase/supabase-js@2' durante o teste. O cliente e
// injetado em globalThis antes do import, porque a Edge cria `sb` no topo do modulo.
export function createClient() {
  if (!globalThis.__SB_FAKE__) throw new Error('cliente fake nao instalado antes do import');
  return globalThis.__SB_FAKE__;
}
