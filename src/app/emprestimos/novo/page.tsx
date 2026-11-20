import NovoEmprestimoLoader from "@/components/NovoEmprestimoLoader";

export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ clienteId?: string }>;
}

export default async function NovoEmprestimoPage({ searchParams }: PageProps) {
  const { clienteId } = await searchParams;
  return <NovoEmprestimoLoader clienteIdParam={clienteId} />;
}
