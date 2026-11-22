"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, UserPlus } from "lucide-react";

interface Option {
  id: string;
  nome: string;
  telefone?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  name: string; // Para usar no FormData oculto
  onCreateNew?: (searchQuery: string) => void;
  createNewLabel?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione...",
  name,
  onCreateNew,
  createNewLabel = "Cadastrar cliente rápido",
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.id === value);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const searchTrim = search.trim();
  const searchDigits = searchTrim.replace(/\D/g, "");

  const filteredOptions = options.filter((opt) => {
    if (!searchTrim) return true;
    const matchNome = norm(opt.nome).includes(norm(searchTrim));
    const matchTelRaw = Boolean(opt.telefone && opt.telefone.includes(searchTrim));
    const matchTelDigits = Boolean(
      searchDigits && opt.telefone && opt.telefone.replace(/\D/g, "").includes(searchDigits)
    );
    return matchNome || matchTelRaw || matchTelDigits;
  });

  const handleTriggerCreate = () => {
    if (!onCreateNew) return;
    const q = searchTrim;
    setIsOpen(false);
    setSearch("");
    onCreateNew(q);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Campo Oculto para o FormData funcionar nativamente */}
      <input type="hidden" name={name} value={value} />

      {/* Botão Principal */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left bg-transparent border-none p-3 text-slate-900 font-medium flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform"
      >
        <span className={!selectedOption ? "text-slate-400" : ""}>
          {selectedOption ? selectedOption.nome : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Menu Dropdown Animado */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl max-h-80 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          
          {/* Barra de Busca */}
          <div className="p-3 border-b border-slate-100 relative">
            <Search className="w-4 h-4 absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pelo nome ou número..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 transition-shadow outline-none"
            />
          </div>

          {/* Lista de Opções */}
          <div className="overflow-y-auto flex-1 p-2 space-y-1">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center space-y-3">
                <p className="text-sm text-slate-500">Nenhuma pessoa encontrada.</p>
                {onCreateNew && (
                  <button
                    type="button"
                    onClick={handleTriggerCreate}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {searchTrim ? `Cadastrar "${searchTrim}" rápido` : createNewLabel}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChange(opt.id);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-4 py-3 rounded-lg flex flex-col transition-colors cursor-pointer ${
                    value === opt.id 
                    ? "bg-emerald-50 text-emerald-700 font-bold" 
                    : "hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <span className="font-bold text-sm">{opt.nome}</span>
                  {opt.telefone && (
                    <span className="text-xs text-slate-500 font-medium">
                      {opt.telefone}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Ação fixa de cadastro rápido quando há itens listados */}
          {onCreateNew && filteredOptions.length > 0 && (
            <div className="p-2 border-t border-slate-100 bg-slate-50/90 shrink-0">
              <button
                type="button"
                onClick={handleTriggerCreate}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-emerald-700 hover:bg-emerald-50 font-bold text-xs transition-colors cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {searchTrim ? `Cadastrar "${searchTrim}" rápido` : createNewLabel}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
