"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { isNetworkError, useOffline } from "@/components/offline/OfflineProvider";

interface DeleteClientButtonProps {
  clienteId: string;
  clienteNome?: string;
  onDeleteAction: (id: string) => Promise<void>;
}

export default function DeleteClientButton({ clienteId, clienteNome, onDeleteAction }: DeleteClientButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { isOnline, enqueueOfflineAction } = useOffline();

  const handleDelete = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm("Tem certeza que deseja deletar este cliente? Isso removerá também todos os empréstimos dele.")) {
      startTransition(async () => {
        if (!isOnline) {
          await enqueueOfflineAction({
            type: "DELETE_CLIENTE",
            entityId: clienteId,
            label: `Excluir cliente${clienteNome ? ` — ${clienteNome}` : ""}`,
            payload: { clienteId, clienteNome },
          });
          router.push("/clientes");
          return;
        }
        try {
          await onDeleteAction(clienteId);
        } catch (err) {
          if (isNetworkError(err)) {
            await enqueueOfflineAction({
              type: "DELETE_CLIENTE",
              entityId: clienteId,
              label: `Excluir cliente${clienteNome ? ` — ${clienteNome}` : ""}`,
              payload: { clienteId, clienteNome },
            });
            router.push("/clientes");
            return;
          }
          console.error("Erro ao deletar:", err);
          alert("Não foi possível excluir o cliente.");
        }
      });
    }
  };

  return (
    <form onSubmit={handleDelete}>
      <button
        type="submit"
        disabled={isPending}
        className="p-2 bg-red-55 text-red-600 hover:bg-red-100 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center"
        title="Excluir Pessoa"
      >
        <Trash2 className="w-5 h-5" />
      </button>
    </form>
  );
}
