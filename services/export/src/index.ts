// Serviço de exportação (manuscrito → Markdown do Pandoc → .docx com o modelo do livro).
// Fase 0: só o esqueleto e a checagem de saúde. A conversão entra em F1.22–F1.25.
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'

const run = promisify(execFile)
const port = Number(process.env.EXPORT_PORT ?? 4030)
const pandoc = process.env.PANDOC_PATH ?? 'pandoc'

async function pandocVersion(): Promise<string | null> {
  try {
    const { stdout } = await run(pandoc, ['--version'])
    return stdout.split('\n')[0] ?? null
  } catch {
    return null
  }
}

createServer((req, res) => {
  if (req.url === '/health') {
    void pandocVersion().then((version) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, pandoc: version }))
    })
    return
  }
  res.writeHead(404).end()
}).listen(port, () => console.log(`serviço de exportação em http://localhost:${port}`))
