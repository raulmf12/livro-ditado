import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const VERIFIER_DIR = fileURLToPath(new URL('../word_verifier/', import.meta.url))

export interface DocxParagraph {
  index: number
  style: string
  text: string
  left_indent_cm: number | null
  font_size_pt: number | null
  line_spacing: number | null
  footnote_ids: number[]
  ai_marked_text: string[]
}

export interface DocxReport {
  paragraphs: DocxParagraph[]
  footnotes: { id: number; text: string }[]
  comments: { id: number; author: string; text: string }[]
  sections: { footnote_restart: string | null; page_cm: [number, number] | null; margins_cm: Record<'top' | 'right' | 'bottom' | 'left', number> | null }[]
  ai_marked_count: number
}

/** Abre um .docx com python-docx e devolve estilos, notas, comentários e marcações "Inserido IA". */
export async function verifyDocx(path: string): Promise<DocxReport> {
  const python = `${VERIFIER_DIR}.venv/bin/python`
  const { stdout } = await run(python, [`${VERIFIER_DIR}verify_docx.py`, path], { maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(stdout) as DocxReport
}
