import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "./components/NavBar";
import MainContent from "./components/MainContent";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
    themeColor: "#10b981",
};

export const metadata: Metadata = {
    title: "Bro please pay - Smart Bill Splitter",
    description: "AI-powered bill splitting with instant UPI payments",
    manifest: "/manifest.json",
    icons: {
        icon: "/favicon.svg",
    },
    openGraph: {
        type: "website",
        siteName: "Bro Please Pay",
        title: "Bro Please Pay - Smart Bill Splitter",
        description: "AI-powered bill splitting with instant UPI payments. Scan, split, pay via UPI.",
    },
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
                    <NavBar />
                    <MainContent>
                        {children}
                    </MainContent>
                </div>
            </body>
        </html>
    );
}
