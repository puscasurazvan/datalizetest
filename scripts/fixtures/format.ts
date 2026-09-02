/** Zero-pads a non-negative integer to `width` digits, e.g. pad(42, 6) -> "000042". */
export function pad(value: number, width: number): string {
  return String(value).padStart(width, "0")
}
