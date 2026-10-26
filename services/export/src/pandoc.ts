import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import JSZip from 'jszip'

const run = promisify(execFile)
export const REFERENCE_DOCX = fileURLToPath(new URL('../template/reference.docx', import.meta.url))

/**
 * Onde está o Pandoc: PANDOC_PATH, o do sistema, ou (em desenvolvimento) o
 * que vem com o pypandoc_binary no ambiente Python dos testes.
 */
export async function findPandoc(): Promise<string> {
  if (process.env.PANDOC_PATH) return process.env.PANDOC_PATH
  try {
    await run('pandoc', ['--version'])
    return 'pandoc'
  } catch {
    const venvLib = fileURLToPath(new URL('../../../tests/kit/word_verifier/.venv/lib/', import.meta.url))
    if (existsSync(venvLib)) {
      for (const py of readdirSync(venvLib)) {
        const candidate = `${venvLib}${py}/site-packages/pypandoc/files/pandoc`
        if (existsSync(candidate)) return candidate
      }
    }
    throw new Error('Pandoc não encontrado: instale ou defina PANDOC_PATH')
  }
}

/** Versão da API do documento JSON que este Pandoc entende. */
export async function pandocApiVersion(pandoc: string): Promise<number[]> {
  const out = await pipe(pandoc, ['-f', 'markdown', '-t', 'json'], Buffer.from(''))
  return (JSON.parse(out.toString()) as { 'pandoc-api-version': number[] })['pandoc-api-version']
}

export async function toDocx(pandoc: string, doc: unknown): Promise<Buffer> {
  return pipe(pandoc, ['-f', 'json', '-t', 'docx', `--reference-doc=${REFERENCE_DOCX}`, '-o', '-'], Buffer.from(JSON.stringify(doc)))
}

/**
 * Ajustes que o Pandoc não faz sozinho: com notas por capítulo, a última
 * seção do documento também precisa recomeçar a numeração.
 */
export async function postProcess(docx: Buffer, opts: { footnoteNumbering: 'chapter' | 'book' }): Promise<Buffer> {
  if (opts.footnoteNumbering !== 'chapter') return docx
  const zip = await JSZip.loadAsync(docx)
  const file = zip.file('word/document.xml')
  if (!file) return docx
  let xml = await file.async('string')
  const last = xml.lastIndexOf('<w:sectPr')
  if (last !== -1 && !xml.slice(last).includes('<w:footnotePr>')) {
    const open = xml.indexOf('>', last) + 1
    // ordem do esquema: headerReference/footerReference vêm antes de footnotePr
    let at = open
    const refs = /^(?:<w:(?:headerReference|footerReference)[^>]*\/>)+/.exec(xml.slice(open))
    if (refs) at += refs[0].length
    xml = `${xml.slice(0, at)}<w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>${xml.slice(at)}`
    zip.file('word/document.xml', xml)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function pipe(cmd: string, args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`pandoc saiu com ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`))
    })
    child.stdin.end(input)
  })
}
