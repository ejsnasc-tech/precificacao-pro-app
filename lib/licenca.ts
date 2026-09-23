import * as SecureStore from "expo-secure-store";

const API_BASE = "https://topprecificacao.com.br";
const CHAVE = "pp_licenca";

export interface Licenca {
  codigo: string;
  tipo: "principal" | "colaborador";
  permissoes: string[]; // vazio = acesso total
  expira_em: string | null; // null = vitalício
  sessao_id?: string; // identifica esta ativação — derruba o app se outro aparelho reativar o mesmo código
}

export async function lerLicenca(): Promise<Licenca | null> {
  const raw = await SecureStore.getItemAsync(CHAVE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Licenca;
  } catch {
    return null;
  }
}

async function salvarLicenca(licenca: Licenca): Promise<void> {
  await SecureStore.setItemAsync(CHAVE, JSON.stringify(licenca));
}

export async function limparLicenca(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE);
}

export function licencaValida(licenca: Licenca | null): boolean {
  if (!licenca) return false;
  if (!licenca.expira_em) return true;
  return new Date(licenca.expira_em) >= new Date();
}

export async function ativarCodigo(
  codigo: string, nome: string, email: string
): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/codigo/verificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, nome, email }),
    });
    const data = await res.json() as { erro?: string; expira_em?: string | null; tipo?: string; permissoes?: string[]; sessao_id?: string };
    if (!res.ok) return { ok: false, erro: data.erro ?? "Código inválido." };

    await salvarLicenca({
      codigo: codigo.toUpperCase().trim(),
      tipo: (data.tipo as "principal" | "colaborador") ?? "principal",
      permissoes: data.permissoes ?? [],
      expira_em: data.expira_em ?? null,
      sessao_id: data.sessao_id,
    });
    return { ok: true };
  } catch {
    return { ok: false, erro: "Erro de conexão. Verifique sua internet e tente novamente." };
  }
}

// Reconfere a validade no servidor (revogação, expiração) enquanto online.
// Silenciosa: se não tiver internet, mantém o que já está salvo localmente.
export async function revalidarLicenca(): Promise<Licenca | null> {
  const atual = await lerLicenca();
  if (!atual) return null;

  try {
    const res = await fetch(`${API_BASE}/api/codigo/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: atual.codigo, sessao_id: atual.sessao_id }),
    });
    const data = await res.json() as { valido: boolean; tipo?: string; permissoes?: string[]; expira_em?: string | null };

    if (!data.valido) {
      await limparLicenca();
      return null;
    }

    const atualizada: Licenca = {
      codigo: atual.codigo,
      tipo: (data.tipo as "principal" | "colaborador") ?? "principal",
      permissoes: data.permissoes ?? [],
      expira_em: data.expira_em ?? null,
      sessao_id: atual.sessao_id,
    };
    await salvarLicenca(atualizada);
    return atualizada;
  } catch {
    return atual; // offline: confia no que já estava salvo
  }
}
