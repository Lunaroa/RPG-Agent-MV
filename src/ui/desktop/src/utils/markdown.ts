// Dependency-free markdown → HTML renderer ported from legacy frontend.
// All raw text is HTML-escaped before structural tags are injected, so the
// output is safe to use with v-html (no untrusted markup survives).

export function renderMarkdown(markdown: string): string {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    const fence = /^```(\w+)?\s*$/.exec(line.trim())
    if (fence) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        code.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      i += 1
      continue
    }
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr>')
      i += 1
      continue
    }
    if (isMarkdownTableStart(lines, i)) {
      const tableLines = [lines[i], lines[i + 1]]
      i += 2
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        tableLines.push(lines[i])
        i += 1
      }
      html.push(renderMarkdownTable(tableLines))
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const block: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      html.push(`<blockquote>${renderMarkdown(block.join('\n'))}</blockquote>`)
      continue
    }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line)
    if (unordered || ordered) {
      const tag = unordered ? 'ul' : 'ol'
      const itemPattern = unordered ? /^\s*[-*]\s+(.+)$/ : /^\s*\d+\.\s+(.+)$/
      const items: string[] = []
      while (i < lines.length) {
        const item = itemPattern.exec(lines[i])
        if (!item) break
        items.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
        i += 1
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }
    const paragraph = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !isMarkdownBlockStart(lines, i)) {
      paragraph.push(lines[i])
      i += 1
    }
    html.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`)
  }
  return html.join('')
}

function renderInlineMarkdown(value: string): string {
  const codeTokens: string[] = []
  let escaped = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE${codeTokens.length}@@`
    codeTokens.push(`<code>${code}</code>`)
    return token
  })
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  escaped = escaped.replace(/__(.+?)__/g, '<strong>$1</strong>')
  for (let index = 0; index < codeTokens.length; index += 1) {
    escaped = escaped.replace(`@@CODE${index}@@`, codeTokens[index])
  }
  return escaped
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] || ''
  return /^```/.test(line.trim())
    || /^(#{1,4})\s+/.test(line)
    || /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*[-*]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || isMarkdownTableStart(lines, index)
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return /\|/.test(lines[index] || '')
    && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || '')
}

function renderMarkdownTable(lines: string[]): string {
  const headers = splitMarkdownTableRow(lines[0])
  const bodyRows = lines.slice(2).map(splitMarkdownTableRow)
  return [
    '<div class="markdown-table-wrap"><table>',
    `<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`,
    `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`,
    '</table></div>'
  ].join('')
}

function splitMarkdownTableRow(line: string): string[] {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return String(value || '').replace(/[&<>"']/g, (char) => map[char])
}
