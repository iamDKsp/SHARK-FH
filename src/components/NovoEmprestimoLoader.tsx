"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import FormNovoEmprestimo from "@/components/FormNovoEmprestimo";
import { useOffline } from "@/components/offline/OfflineProvider";
import { getAllClientes, getAllParceiros } from "@/lib/offline/db";
import { applyPendingToClientes, applyPendingToParceiros } from "@/lib/offline/applyPending";
import type { CachedCliente, CachedParceiro } from "@/lib/offline/types";

export default function NovoEmprestimoLoader({ clienteIdParam }: { clienteIdParam?: string }) {
  const { session, pendingOps, dataRevision, isOnline, syncBootstrap } = useOffline();
  const [clientesRaw, setClientesRaw] = useState<CachedCliente[]>([]);
  const [parceirosRaw, setParceirosRaw] = useState<CachedParceiro[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = session?.userId || "local";
    let cancelled = false;

    const load = async () => {
      try {
        const [cls, parcs] = await Promise.all([
          getAllClientes(uid).catch(() => []),
          getAllParceiros(uid).catch(() => []),
        ]);
        if (!cancelled) {
          setClientesRaw(cls);
          setParceirosRaw(parcs);
          if (cls.length > 0 || !isOnline) {
            setLoading(false);
          }
        }
        // Se ainda não havia cache local e estamos online, força bootstrap
        if (cls.length === 0 && isOnline) {
          await syncBootstrap(true);
          if (!cancelled) {
            const [cls2, parcs2] = await Promise.all([
              getAllClientes(uid).catch(() => []),
              getAllParceiros(uid).catch(() => []),
            ]);
            setClientesRaw(cls2);
            setParceirosRaw(parcs2);
            setLoading(false);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [session?.userId, dataRevision, isOnline, syncBootstrap]);

  const clientes = useMemo(() => {
    return applyPendingToClientes(clientesRaw, pendingOps)
      .sort((a, b) => {
        if (Boolean(a.pendingSync) !== Boolean(b.pendingSync)) return a.pendingSync ? -1 : 1;
        return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
      })
      .map((c) => ({
        id: c.id,
        nome: c.pendingSync ? `${c.nome} (Pendente)` : c.nome,
        rawNome: c.nome,
        telefone: c.telefone,
        pendingSync: Boolean(c.pendingSync),
      }));
  }, [clientesRaw, pendingOps]);

  const parceiros = useMemo(() => {
    return applyPendingToParceiros(parceirosRaw, pendingOps)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
      .map((p) => ({
        id: p.id,
        nome: p.pendingSync ? `${p.nome} (Pendente)` : p.nome,
      }));
  }, [parceirosRaw, pendingOps]);

  if (loading && clientes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-2">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
        <span className="text-xs text-slate-500">Carregando clientes e parceiros...</span>
      </div>
    );
  }

  return (
    <FormNovoEmprestimo
      clientes={clientes}
      parceiros={parceiros}
      clienteIdParam={clienteIdParam}
    />
  );
}
