import Link from 'next/link'

export default function ObraNaoEncontrada() {
  return (
    <main className="page">
      <h1>Obra não encontrada</h1>
      <p className="muted">Esta obra não existe ou não pertence à sua conta.</p>
      <Link href="/obra">Voltar às suas obras</Link>
    </main>
  )
}
