import Link from 'next/link'

const TABS = [
  ['manuscrito', 'Manuscrito', ''],
  ['glossario', 'Glossário', '/glossario'],
  ['grafia', 'Grafia', '/grafia'],
  ['exportacoes', 'Exportações', '/exportacoes'],
  ['historico', 'Histórico', '/historico'],
  ['configuracoes', 'Configurações', '/configuracoes'],
] as const

export type BookTab = (typeof TABS)[number][0]

export function BookNav({ bookId, title, active }: { bookId: string; title: string; active: BookTab }) {
  return (
    <div className="book-nav">
      <h1>{title}</h1>
      <nav aria-label="Seções da obra">
        {TABS.map(([key, label, path]) => (
          <Link key={key} href={`/obra/${bookId}${path}`} aria-current={key === active ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
