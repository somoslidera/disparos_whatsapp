import type { Metadata } from "next";
import { ConnectionPage } from "@/components/connection-page";

export const metadata: Metadata = { title: "Conexão" };

export default function Page() {
  return <ConnectionPage />;
}
