#!/usr/bin/env node
/**
 * Inspect a .qdpx file and report what's persisted for audio sources.
 * Usage: node scripts/inspect-qdpx-audio.mjs /path/to/project.qdpx
 */
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/inspect-qdpx-audio.mjs /path/to/project.qdpx')
  process.exit(1)
}

const buf = await readFile(filePath)
const zip = await JSZip.loadAsync(buf)

let qdeName = Object.keys(zip.files).find(
  (n) => /^[^/]+\.qde$/i.test(n) && !zip.files[n].dir
)
qdeName = qdeName || 'project.qde'
const qdeXml = await zip.file(qdeName).async('string')

console.log(`\n=== ${filePath}\n`)

// Count source elements by type
for (const tag of ['TextSource', 'PDFSource', 'AudioSource', 'VideoSource', 'PictureSource']) {
  const re = new RegExp(`<${tag}\\b`, 'gi')
  const count = (qdeXml.match(re) || []).length
  console.log(`<${tag}> elements in ${qdeName}: ${count}`)
}
console.log()

// Dump every <AudioSource> ... </AudioSource> or self-closing
const audioBlocks = qdeXml.match(/<AudioSource\b[^>]*?(?:\/>|>[\s\S]*?<\/AudioSource>)/gi) || []
console.log(`AudioSource block dumps:`)
for (const block of audioBlocks) {
  console.log('  ' + block.slice(0, 300))
}
console.log()

// magnolia-sources.json
const metaFile = zip.file('magnolia-sources.json')
if (!metaFile) {
  console.log('magnolia-sources.json: NOT FOUND')
} else {
  const meta = JSON.parse(await metaFile.async('string'))
  console.log(`magnolia-sources.json — full contents of audio-related entries:`)
  for (const m of meta.sourceMeta || []) {
    if (m.sourceType === 'audio' || m.formatData?.hasAudioBinary) {
      console.log(JSON.stringify(m, null, 2).split('\n').map((l) => '  ' + l).join('\n'))
    }
  }
}

// sources/ folder listing
console.log()
const sourceEntries = Object.keys(zip.files).filter((n) => n.startsWith('sources/') && !zip.files[n].dir)
console.log(`Files in sources/ (${sourceEntries.length} total):`)
for (const f of sourceEntries) {
  const size = zip.file(f) ? (await zip.file(f).async('uint8array')).byteLength : 0
  console.log(`  ${f}  (${size.toLocaleString()} bytes)`)
}

// Look at the raw <Source> entries in XML for the guid we found in magnolia-sources.json
if (metaFile) {
  console.log()
  const meta = JSON.parse(await metaFile.async('string'))
  const audioGuids = (meta.sourceMeta || [])
    .filter((m) => m.sourceType === 'audio')
    .map((m) => m.guid.toLowerCase())
  for (const g of audioGuids) {
    const re = new RegExp(`<\\w*Source\\b[^>]*?guid=["']${g}["'][\\s\\S]{0,300}`, 'i')
    const m = qdeXml.match(re)
    console.log(`XML element for guid ${g}:`)
    console.log('  ' + (m ? m[0] : '(no element with this guid found)'))
  }
}
