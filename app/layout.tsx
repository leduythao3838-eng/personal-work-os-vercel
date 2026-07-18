import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Work OS — Ngày của tôi",
  description: "Một việc đúng. Một thời điểm thật. Làm đến cùng.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
