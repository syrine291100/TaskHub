import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "TaskHub — Vos projets, en mouvement", description: "Organisez vos projets et votre équipe dans un tableau Kanban simple et clair." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
