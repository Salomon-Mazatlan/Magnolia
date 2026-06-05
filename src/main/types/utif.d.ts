/**
 * Minimal type shim for `utif` — only the entry points the image
 * converter uses. The package ships without its own types.
 */
declare module 'utif' {
  export interface IFD {
    width: number
    height: number
    [key: string]: unknown
  }
  export function decode(buffer: Uint8Array | Buffer): IFD[]
  export function decodeImage(buffer: Uint8Array | Buffer, ifd: IFD): void
  export function toRGBA8(ifd: IFD): Uint8Array
  const UTIF: {
    decode: typeof decode
    decodeImage: typeof decodeImage
    toRGBA8: typeof toRGBA8
  }
  export default UTIF
}
