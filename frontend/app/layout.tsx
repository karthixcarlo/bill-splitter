import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Bro please pay - Smart Bill Splitter",
    description: "AI-powered bill splitting with instant UPI payments",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="dark">
            <body className={inter.className}>
                <div className="min-h-screen bg-zinc-950 text-zinc-50">
                    {children}
                </div>
            </body>
        </html>
    );
}
