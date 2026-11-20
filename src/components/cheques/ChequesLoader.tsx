"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, CloudOff } from "lucide-react";
import ChequesClientView from "./ChequesClientView";
import { useOffline } from "@/components/offline/OfflineProvider";
import { getAllCheques, getAllClientes, getAllParceiros } from "@/lib/offline/db";
import {
  applyPendingToCheques,
  applyPendingToClientes,
  applyPendingToParceiros,
} from "@/lib/offline/applyPending";
import type { CachedCheque, CachedCliente, CachedParceiro } from "@/lib/offline/types";

export default function ChequesLoader() {
  const { session, pendingOps, dataRevision, isOnline, syncBootstrap } = useOffline();
  const [rawCheques, setRawCheques] = useState<CachedCheque[]>([]);
  const [rawClientes, setRawClientes] = useState<CachedCliente[]>([]);
  const [rawParceiros, setRawParceiros] = useState<CachedParceiro[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = session?.userId || "local";
    let cancelled = false;

    const load = async () => {
      try {
        const [chs, cls, parcs] = await Promise.all([
          getAllCheques(uid).catch(() => []),
          getAllClientes(uid).catch(() => []),
          getAllParceiros(uid).catch(() => []),
        ]);
        if (!cancelled) {
          setRawCheques(chs);
          setRawClientes(cls);
          setRawParceiros(parcs);
          if (cls.length > 0 || chs.length > 0 || !isOnline) {
            setLoading(false);
          }
        }
        if (cls.length === 0 && chs.length === 0 && isOnline) {
          await syncBootstrap(true);
          if (!cancelled) {
            const [chs2, cls2, parcs2] = await Promise.all([
              getAllCheques(uid).catch(() => []),
              getAllClientes(uid).catch(() => []),
              getAllParceiros(uid).catch(() => []),
            ]);
            setRawCheques(chs2);
            setRawClientes(cls2);
            setRawParceiros(parcs2);
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

  const cheques = useMemo(() => applyPendingToCheques(rawCheques, pendingOps), [rawCheques, pendingOps]);
  const clientes = useMemo(() => applyPendingToClientes(rawClientes, pendingOps), [rawClientes, pendingOps]);
  const parceiros = useMemo(() => applyPendingToParceiros(rawParceiros, pendingOps), [rawParceiros, pendingOps]);

  if (loading && cheques.length === 0 && clientes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-2">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
        <span className="text-xs text-slate-500">Carregando cheques...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isOnline && (
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-semibold">
          <CloudOff className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Modo offline — exibindo cheques salvos no aparelho.</span>
        </div>
      )}
      <ChequesClientView
        cheques={cheques as any}
        clientes={clientes}
        parceiros={parceiros}
      />
    </div>
  );
}
