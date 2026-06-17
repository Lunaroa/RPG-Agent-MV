/** 展示用供应商名称：去掉末尾括号后缀，避免把运行引擎写进供应商名。 */
export function formatProviderDisplayName(name: string | null | undefined): string {
  if (!name) return ''
  let result = name.trim()
  if (!result) return ''
  while (true) {
    const next = result.replace(/\s*[（(][^）)]*[）)]\s*$/u, '').trim()
    if (next === result) break
    result = next
  }
  return result || name.trim()
}
