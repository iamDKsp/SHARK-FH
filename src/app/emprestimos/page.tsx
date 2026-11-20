import EmprestimosLoader from "@/components/EmprestimosLoader";

export const revalidate = 0;

export default async function EmprestimosPage({
  searchParams,
}: {
  searchParams: Promise<{
    filtro?: string;
    status?: string;
    q?: string;
    parceiro?: string;
    sort?: string;
    pagina?: string;
    dias_atraso?: string;
  }>;
}) {
  const params = await searchParams;
  return (
    <EmprestimosLoader
      initialFiltro={params?.status ?? params?.filtro}
      initialSearch={params?.q ?? ""}
      initialParceiro={params?.parceiro ?? "todos"}
      initialSort={params?.sort ?? "padrao"}
      initialPagina={parseInt(params?.pagina ?? "1", 10) || 1}
      initialDiasAtraso={params?.dias_atraso ?? "0"}
    />
  );
}
