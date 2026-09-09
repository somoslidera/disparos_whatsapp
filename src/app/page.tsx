import type { Metadata } from "next";
import { Suspense } from "react";
import { NewCampaign } from "@/components/new-campaign";

export const metadata: Metadata = { title: "Nova campanha" };

export default function HomePage() {
  return (
    <Suspense>
      <NewCampaign />
    </Suspense>
  );
}
