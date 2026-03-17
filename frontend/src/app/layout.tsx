import type { Metadata } from 'next';
import { WalletProvider } from '@/contexts/WalletProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Delta-Neutral Vault',
  description: 'Earn yield from funding rate arbitrage on Drift Protocol',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
