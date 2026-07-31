import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const unitRoot = resolve(import.meta.dirname)
const source = await readFile(resolve(unitRoot, 'draft.md'), 'utf8')
const diagrams = []
const rendered = source.replace(
  /~~~mermaid\r?\n([\s\S]*?)~~~/g,
  (_whole, diagram) => {
    diagrams.push(diagram.trim() + '\n')
    return '![diagram](./rendered-' + diagrams.length + '.svg)'
  },
)

await Promise.all(
  diagrams.map((diagram, index) =>
    writeFile(resolve(unitRoot, 'diagram-' + (index + 1) + '.mmd'), diagram, 'utf8'),
  ),
)
await writeFile(resolve(unitRoot, 'rendered.md'), rendered, 'utf8')
process.stdout.write(String(diagrams.length))
