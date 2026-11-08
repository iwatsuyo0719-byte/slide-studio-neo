import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'SLIDE STUDIO NEO', description: '素材から、伝わるスライドへ' };
export default function Layout({ children }: {
    children: React.ReactNode;
}) { return <html lang="ja"><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap"/><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/></head><body>{children}</body></html>; }
