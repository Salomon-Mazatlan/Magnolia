/**
 * Minimal type shim for @iarna/rtf-to-html. The package ships without
 * its own types; we only need `fromString` on the main process.
 */
declare module '@iarna/rtf-to-html' {
  function fromString(
    rtf: string,
    optionsOrCallback:
      | ((err: Error | null, html?: string) => void)
      | Record<string, unknown>,
    callback?: (err: Error | null, html?: string) => void
  ): void

  const rtfToHtml: {
    fromString: typeof fromString
  }
  export default rtfToHtml
  export { fromString }
}
