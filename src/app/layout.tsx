import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { DataProvider } from "@/components/data-provider";

export const metadata: Metadata = {
  title: { default: "Disparos WhatsApp", template: "%s · Disparos WhatsApp" },
  description: "Envio de mensagens em massa para contatos, grupos e listas do WhatsApp",
};

export const viewport: Viewport = {
  themeColor: "#070a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-full font-sans">
        <DataProvider>
          <AppShell>{children}</AppShell>
        </DataProvider>
        <Toaster
          position="top-right"
          theme="dark"
          richColors
          closeButton
          toastOptions={{ style: { background: "#0e131a", border: "1px solid rgba(255,255,255,0.1)" } }}
        />
      </body>
    </html>
  );
}
