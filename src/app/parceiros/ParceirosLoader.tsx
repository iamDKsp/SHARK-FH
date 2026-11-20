"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, CloudOff } from "lucide-react";
import ClientParceirosList from "./ClientParceirosList";
import { useOffline } from "@/components/offline/OfflineProvider";
import { getAllParceiros } from "@/lib/offline/db";
import { applyPendingToParceiros } from "@/lib/offline/applyPending";
import type { CachedParceiro } from "@/lib/offline/types";

export default function ParceirosLoader() {
  const { session, pendingOps, dataRevision, isOnline, syncBootstrap } = useOffline();
  const [rawParceiros, setRawParceiros] = useState<CachedParceiro[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = session?.userId || "local";
    let cancelled = false;

    const load = async () => {
      try {
        const list = await getAllParceiros(uid).catch(() => []);
        if (!cancelled) {
          setRawParceiros(list);
          if (list.length > 0 || !isOnline) {
            setLoading(false);
          }
        }
        if (list.length === 0 && isOnline) {
          await syncBootstrap(true);
          if (!cancelled) {
            const list2 = await getAllParceiros(uid).catch(() => []);
            setRawParceiros(list2);
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

  const parceiros = useMemo(
    () =>
      applyPendingToParceiros(rawParceiros, pendingOps)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
        .map((p) => ({
          ...p,
          criado_em: new Date(p.criado_em || Date.now()),
        })),
    [rawParceiros, pendingOps]
  );

  if (loading && parceiros.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-2">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
        <span className="text-xs text-slate-500">Carregando parceiros...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isOnline && (
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-semibold">
          <CloudOff className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Modo offline — exibindo parceiros salvos no aparelho.</span>
        </div>
      )}
      <ClientParceirosList parceiros={parceiros} />
    </div>
  );
}
