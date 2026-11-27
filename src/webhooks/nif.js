/**
 * Portuguese NIF checksum (MOD 11), same algorithm as connector-nif.
 * Remainder < 2 → check digit 0; otherwise 11 − remainder.
 */
export function isValidNif(value) {
  const nif = String(value ?? '').trim()
  if (!/^\d{9}$/.test(nif)) return false
  const digits = [...nif].map(Number)
  const sum = digits.slice(0, 8).reduce((acc, n, i) => acc + n * (9 - i), 0)
  const remainder = sum % 11
  const check = remainder < 2 ? 0 : 11 - remainder
  return digits[8] === check
}
