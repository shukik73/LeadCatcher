import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: "LeadCatcher - Stop Losing Customers to Missed Calls",
  description: "Instantly text back every caller you miss. Secure the job while you're busy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased"
        )}
        style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}
      >
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
