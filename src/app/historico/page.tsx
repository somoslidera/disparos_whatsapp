import type { Metadata } from "next";
import { HistoryPage } from "@/components/history-page";

export const metadata: Metadata = { title: "Histórico" };

export default function Page() {
  return <HistoryPage />;
}
