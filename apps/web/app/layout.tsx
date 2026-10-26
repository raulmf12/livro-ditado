import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ditado do Livro',
  description: 'Ditado por voz do manuscrito, com estrutura, citações e exportação Word.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
