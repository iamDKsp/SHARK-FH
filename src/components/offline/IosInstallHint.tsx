"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { useOffline } from "./OfflineProvider";

const DISMISS_KEY = "shark_fh_ios_install_hint_dismissed";

export default function IosInstallHint() {
  const { isEnabledRoute } = useOffline();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isEnabledRoute || typeof window === "undefined") return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
      const ua = navigator.userAgent || "";
      const isIos = /iPad|iPhone|iPod/.test(ua);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as unknown as { standalone?: boolean }).standalone);
      if (isIos && !isStandalone) {
        setVisible(true);
      }
    } catch {
      // ignora
    }
  }, [isEnabledRoute]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignora
    }
  };

  return (
    <div className="bg-emerald-950 text-emerald-50 border-b border-emerald-800/80 text-xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Share className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <p className="truncate">
            Para usar offline no iPhone: toque em <strong>Compartilhar</strong> e{" "}
            <strong>Adicionar à Tela de Início</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="p-1 text-emerald-300 hover:text-white rounded-md cursor-pointer shrink-0"
          aria-label="Fechar dica"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
