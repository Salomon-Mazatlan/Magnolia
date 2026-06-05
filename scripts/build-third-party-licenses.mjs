#!/usr/bin/env node
/**
 * Generates THIRD-PARTY-LICENSES.txt by walking license-checker's JSON
 * output and concatenating each dependency's license file. Bundled with
 * the app so the dist binary ships full attribution + license text for
 * every production dependency, satisfying BSD-2 / Apache-2.0 / MIT
 * notice requirements.
 *
 * Usage: node scripts/build-third-party-licenses.mjs > THIRD-PARTY-LICENSES.txt
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const json = execSync('npx --yes license-checker --production --json', {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'ignore']
})
const packages = JSON.parse(json)

const out = [
  'THIRD-PARTY LICENSES',
  '',
  'Magnolia bundles a number of open-source libraries. The full license',
  'text for each is reproduced below, ordered alphabetically by package.',
  ''
]

for (const [pkgName, info] of Object.entries(packages).sort()) {
  out.push('─'.repeat(72))
  out.push(pkgName)
  if (info.publisher) out.push(`  Publisher: ${info.publisher}`)
  if (info.licenses) out.push(`  License:   ${info.licenses}`)
  if (info.repository) out.push(`  Source:    ${info.repository}`)
  out.push('')
  if (info.licenseFile) {
    try {
      const text = readFileSync(info.licenseFile, 'utf8').trim()
      out.push(text)
    } catch (err) {
      out.push(`(License file unreadable: ${err.message})`)
    }
  } else {
    out.push('(No license file in package; see "License" tag above.)')
  }
  out.push('')
  out.push('')
}

process.stdout.write(out.join('\n'))
