/**
 * Minimal type shim for `heic-decode`. The package decodes a HEIC
 * buffer to the raw RGBA pixel data plus dimensions.
 */
declare module 'heic-decode' {
  interface DecodeResult {
    width: number
    height: number
    data: Uint8Array
  }
  function heicDecode(opts: { buffer: Buffer | Uint8Array }): Promise<DecodeResult>
  export default heicDecode
}
