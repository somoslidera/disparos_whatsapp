import type { Metadata } from "next";
import { AudiencesPage } from "@/components/audiences-page";

export const metadata: Metadata = { title: "Minhas listas" };

export default function Page() {
  return <AudiencesPage />;
}
