/** Case- and accent-insensitive string form ("Fundão" → "fundao"). */
export function normalizeText(value) {
  if (value == null) return ''
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

/** Letters and digits only, after accent folding ("Idanha-a-Nova" → "idanhanova"). */
export function compactText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '')
}
