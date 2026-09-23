import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  type Licenca, lerLicenca, licencaValida, revalidarLicenca, limparLicenca,
} from "@/lib/licenca";

interface LicencaContextValue {
  licenca: Licenca | null;
  carregando: boolean;
  ehColaborador: boolean;
  permissoes: string[];
  onAtivado: () => void;
  sair: () => Promise<void>;
}

const LicencaContext = createContext<LicencaContextValue | null>(null);

export function LicencaProvider({ children }: { children: ReactNode }) {
  const [licenca, setLicenca] = useState<Licenca | null>(null);
  const [carregando, setCarregando] = useState(true);
  const appState = useRef(AppState.currentState);

  async function carregar() {
    const salva = await lerLicenca();
    if (salva && licencaValida(salva)) {
      setLicenca(salva);
      // Reconfere no servidor em segundo plano (revogação/expiração em tempo real)
      void revalidarLicenca().then((atualizada) => setLicenca(atualizada));
    } else {
      if (salva) await limparLicenca();
      setLicenca(null);
    }
    setCarregando(false);
  }

  useEffect(() => {
    void carregar();

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        void revalidarLicenca().then((atualizada) => setLicenca(atualizada));
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  async function sair() {
    await limparLicenca();
    setLicenca(null);
  }

  const permissoes = licenca?.permissoes ?? [];

  return (
    <LicencaContext.Provider
      value={{
        licenca,
        carregando,
        ehColaborador: permissoes.length > 0,
        permissoes,
        onAtivado: () => void carregar(),
        sair,
      }}
    >
      {children}
    </LicencaContext.Provider>
  );
}

export function useLicenca(): LicencaContextValue {
  const ctx = useContext(LicencaContext);
  if (!ctx) throw new Error("useLicenca precisa estar dentro de LicencaProvider");
  return ctx;
}
