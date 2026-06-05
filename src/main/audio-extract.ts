/**
 * Audio metadata extraction using music-metadata.
 * Runs in the main process (Node.js).
 */

export interface AudioMetadata {
  duration: number   // seconds
  channels: number
  sampleRate: number
  mimeType: string
}

const MIME_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac'
}

export async function extractAudioMetadata(filePath: string, ext: string): Promise<AudioMetadata> {
  const mm = await import('music-metadata')
  const metadata = await mm.parseFile(filePath)

  return {
    duration: metadata.format.duration ?? 0,
    channels: metadata.format.numberOfChannels ?? 1,
    sampleRate: metadata.format.sampleRate ?? 44100,
    mimeType: MIME_TYPES[ext.toLowerCase()] || 'audio/wav'
  }
}
