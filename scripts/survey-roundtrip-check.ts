/**
 * Standalone round-trip check for the survey ⇄ REFI-QDA interop layer.
 * No test runner is configured in this repo, so this is bundled + run
 * directly via esbuild. It exercises the real path an Atlas.ti / MAXQDA
 * round-trip would take (standard XML only — no magnolia-*.json side
 * table):
 *
 *   SurveyData (+ a coded open-ended cell)
 *     → serializeProject  (Variables + Cases + per-respondent docs)
 *     → deserializeProject
 *     → reader-style fold (build docByGuid from case-referenced docs)
 *     → refiToSurvey
 *     → SurveyData' + cell selections
 *
 * and asserts respondents, metadata, closed answers, OPEN-ENDED answers,
 * and the open-ended CODING all survive.
 */
import { serializeProject } from '../src/main/qdpx/xml-serializer'
import { deserializeProject } from '../src/main/qdpx/xml-deserializer'
import { refiToSurvey, type RefiDocSelection } from '../src/main/qdpx/survey-refi'
import type { Project, SurveyData } from '../src/renderer/models/types'
import { writeFileSync, readFileSync } from 'fs'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) { failures++; console.error('  ✗ ' + msg) } else { console.log('  ✓ ' + msg) }
}

const survey: SurveyData = {
  name: 'Customer Feedback',
  columns: [
    { id: 'C1', index: 0, rawHeader: 'RespondentID', rawSubhead: '', cleanHeader: 'RespondentID', cleanSubhead: '', type: 'metadata' },
    { id: 'C2', index: 1, rawHeader: 'Region', rawSubhead: '', cleanHeader: 'Region', cleanSubhead: '', type: 'metadata' },
    { id: 'C3', index: 2, rawHeader: 'How satisfied are you?', rawSubhead: 'Response', cleanHeader: 'How satisfied are you?', cleanSubhead: 'Response', type: 'single-choice' },
    { id: 'C4', index: 3, rawHeader: 'Rating 1-10', rawSubhead: 'Response', cleanHeader: 'Rating 1-10', cleanSubhead: 'Response', type: 'numeric' },
    { id: 'C5', index: 4, rawHeader: 'What could improve?', rawSubhead: 'Open-Ended Response', cleanHeader: 'What could improve?', cleanSubhead: 'Open-Ended Response', type: 'open-ended' },
    { id: 'C6', index: 5, rawHeader: 'Channels used', rawSubhead: 'Email', cleanHeader: 'Channels used', cleanSubhead: 'Email', type: 'multi-select' },
    { id: 'C7', index: 6, rawHeader: '', rawSubhead: 'Phone', cleanHeader: '', cleanSubhead: 'Phone', type: 'multi-select' },
    { id: 'C8', index: 7, rawHeader: '', rawSubhead: 'Chat', cleanHeader: '', cleanSubhead: 'Chat', type: 'multi-select' }
  ],
  questions: [
    { id: 'Q1', text: 'How satisfied are you?', rawText: 'How satisfied are you?', type: 'single-choice', columns: [{ columnId: 'C3', optionLabel: 'Response' }] },
    { id: 'Q2', text: 'Rating 1-10', rawText: 'Rating 1-10', type: 'numeric', columns: [{ columnId: 'C4', optionLabel: 'Response' }] },
    { id: 'Q3', text: 'What could improve?', rawText: 'What could improve?', type: 'open-ended', columns: [{ columnId: 'C5', optionLabel: 'Open-Ended Response' }] },
    { id: 'Q4', text: 'Channels used', rawText: 'Channels used', type: 'multi-select', columns: [
      { columnId: 'C6', optionLabel: 'Email' }, { columnId: 'C7', optionLabel: 'Phone' }, { columnId: 'C8', optionLabel: 'Chat' }
    ] }
  ],
  metadataColumnIds: ['C1', 'C2'],
  respondents: [
    { id: 'R1', displayName: 'Respondent 1', metadata: { C1: '1001', C2: 'West' }, answers: { Q1: 'Very satisfied', Q2: '9', Q3: 'Faster support please', Q4: ['Email', 'Chat'] } },
    { id: 'R2', displayName: 'Respondent 2', metadata: { C1: '1002', C2: 'East' }, answers: { Q1: 'Neutral', Q2: '5', Q3: '', Q4: ['Phone'] } }
  ]
}

const SURVEY_GUID = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'
const CODE_GUID = 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC'

// A coding on R1's open-ended answer: highlight "Faster" (cell-relative
// offsets 0–6 within buildCellText('Faster support please')).
const surveySource: any = {
  guid: SURVEY_GUID,
  name: 'Customer Feedback',
  sourceType: 'survey',
  formatData: { survey, rawCsv: 'irrelevant' },
  selections: [
    {
      guid: 'DDDDDDDD-0000-4000-8000-000000000001',
      startPosition: 0,
      endPosition: 6,
      codings: [{ guid: 'EEEEEEEE-0000-4000-8000-000000000001', codeGuid: CODE_GUID }],
      surveyCell: { respondentId: 'R1', questionId: 'Q3' }
    }
  ]
}

const RTAG = 'FFFFFFFF-0000-4000-8000-000000000001'
const project: Project = {
  name: 'Demo',
  origin: 'Magnolia test',
  users: [],
  codes: [{ guid: CODE_GUID, name: 'Support speed', isCodable: true, children: [] }],
  sources: [surveySource],
  // A tag applied to respondent R1 — should export as a Set with a
  // MemberSource pointing at R1's exported open-ended document.
  sets: [{ guid: RTAG, name: 'Key informant', memberSourceGuids: [], memberCodeGuids: [], memberSurveyRespondents: [{ sourceGuid: SURVEY_GUID, id: 'R1' }] }],
  notes: []
}

const xml = serializeProject(project)
// Dump the serialized XML so it can be validated against the REFI-QDA
// schema (Atlas.ti rejects out-of-order Case children, etc.).
writeFileSync('/tmp/mag-fix.qde', xml)
const reparsed = deserializeProject(xml) as any

console.log('--- Structure ---')
assert(Array.isArray(reparsed._refiCases) && reparsed._refiCases.length === 2, 'two cases parsed')
assert(reparsed.sources.filter((s: any) => /responses/.test(s.name)).length === 2, 'two per-respondent docs emitted')

// The main survey source must NOT carry its (cell-relative) selection in
// the XML — that's the whole point of this change. The coding must live
// on the respondent doc instead.
const mainAfter = reparsed.sources.find((s: any) => s.guid === SURVEY_GUID)
assert(!!mainAfter && (mainAfter.selections ?? []).length === 0, 'main survey source emits NO cell-relative selections')
const codedDoc = reparsed.sources.find((s: any) => /responses/.test(s.name) && (s.selections ?? []).length > 0)
assert(!!codedDoc, 'open-ended coding lives on a respondent doc')

console.log('\n--- Respondent tag → REFI Set MemberSource ---')
const r1doc = reparsed.sources.find((s: any) => /Respondent 1 — responses/.test(s.name))
const tagSet = reparsed.sets.find((s: any) => s.guid === RTAG)
assert(!!r1doc, 'R1 respondent doc emitted')
assert(!!tagSet, 'respondent tag emitted as a Set')
assert(!!r1doc && tagSet?.memberSourceGuids.includes(r1doc.guid), 'tag Set references R1 doc via MemberSource (Atlas/MAXQDA surface the respondent tag)')
assert(!tagSet?.memberSourceGuids.includes(SURVEY_GUID), 'tag does not wrongly include the whole survey')
assert(codedDoc?.selections?.[0]?.codings?.[0]?.codeGuid === CODE_GUID, 'respondent-doc coding references the original code')

// Mirror reader.ts: build docByGuid from case-referenced sources.
const caseDocGuids = new Set<string>()
for (const c of reparsed._refiCases) for (const g of c.sourceRefGuids) caseDocGuids.add(g)
const docByGuid = new Map<string, { text: string; selections: RefiDocSelection[] }>()
for (const s of reparsed.sources) {
  if (!caseDocGuids.has(s.guid)) continue
  docByGuid.set(s.guid, {
    text: s.plainTextContent ?? '',
    selections: (s.selections ?? []).map((sel: any) => ({
      guid: sel.guid, startPosition: sel.startPosition, endPosition: sel.endPosition, codings: sel.codings
    }))
  })
}
assert(docByGuid.size === 2, 'docByGuid built for both respondents')

const { survey: rebuilt, cellSelections } = refiToSurvey(reparsed._refiVariables, reparsed._refiCases, docByGuid, 'Customer Feedback')

console.log('\n--- Values ---')
const qByText = (t: string) => rebuilt.questions.find((q) => q.text === t)
assert(rebuilt.respondents.length === 2, 'two respondents recovered')
assert(rebuilt.metadataColumnIds.length === 2, 'two metadata columns recovered')
assert(qByText('Rating 1-10')?.type === 'numeric', 'numeric question recovered')
const oe = qByText('What could improve?')
assert(oe?.type === 'open-ended', 'open-ended question recovered (from doc sentinel)')
const ms = qByText('Channels used')
assert(ms?.type === 'multi-select' && ms.columns.length === 3, 'multi-select recovered with 3 options')

const r1 = rebuilt.respondents[0]
assert(r1.answers[qByText('How satisfied are you?')!.id] === 'Very satisfied', 'R1 single-choice preserved')
assert(String(r1.answers[qByText('Rating 1-10')!.id]) === '9', 'R1 numeric preserved')
assert(r1.answers[oe!.id] === 'Faster support please', `R1 OPEN-ENDED answer preserved via doc (got ${JSON.stringify(r1.answers[oe!.id])})`)
assert((r1.answers[ms!.id] as string[]).join(',') === 'Email,Chat', 'R1 multi-select preserved')
const r2 = rebuilt.respondents[1]
assert(r2.answers[oe!.id] === '', 'R2 empty open-ended stays empty')

console.log('\n--- Coding round-trip (the new bit) ---')
assert(cellSelections.length === 1, `exactly one cell selection reconstructed (got ${cellSelections.length})`)
const cs: any = cellSelections[0]
assert(cs?.surveyCell?.respondentId === r1.id, 'coding bound to R1')
assert(cs?.surveyCell?.questionId === oe!.id, 'coding bound to the open-ended question')
assert(cs?.startPosition === 0 && cs?.endPosition === 6, `cell-relative offsets recovered as 0–6 (got ${cs?.startPosition}–${cs?.endPosition})`)
assert(cs?.codings?.[0]?.codeGuid === CODE_GUID, 'coding still references the original code')

// ── Side-table round-trip (Magnolia↔Magnolia) ──
// The survey cell selection is no longer in the XML, so the full
// selection (offsets + codings + cell identity) must round-trip through
// magnolia-sources.json instead.
console.log('\n--- Side-table (writeQdpx) ---')
const { writeQdpx } = await import('../src/main/qdpx/writer')
const JSZip = (await import('jszip')).default
await writeQdpx('/tmp/mag-st.qdpx', project, { [SURVEY_GUID]: 'irrelevant csv' })
const zip = await JSZip.loadAsync(readFileSync('/tmp/mag-st.qdpx'))
const st = JSON.parse(await zip.file('magnolia-sources.json')!.async('string'))
const meta = st.sourceMeta.find((m: any) => m.guid === SURVEY_GUID)
const scs = meta?.surveyCellSelections
assert(Array.isArray(scs) && scs.length === 1, 'side-table stores the cell selection')
assert(scs?.[0]?.startPosition === 0 && scs?.[0]?.endPosition === 6, 'side-table preserves cell-relative offsets')
assert(scs?.[0]?.surveyCell?.questionId === 'Q3', 'side-table preserves cell identity')
assert(scs?.[0]?.codings?.[0]?.codeGuid === CODE_GUID, 'side-table preserves the coding')
// And the XML the writer produced must carry no cell selection on the
// survey source — it should be a self-closing <TextSource/> (no children).
const qdeName = Object.keys(zip.files).find((n) => /\.qde$/i.test(n))!
const qde = await zip.file(qdeName)!.async('string')
const tagStart = qde.indexOf(`<TextSource guid="${SURVEY_GUID}"`)
const tagEnd = qde.indexOf('>', tagStart)
const selfClosing = qde[tagEnd - 1] === '/'
const hasSel = selfClosing
  ? false
  : /<PlainTextSelection/.test(qde.slice(tagEnd, qde.indexOf('</TextSource>', tagEnd)))
assert(selfClosing || !hasSel, 'survey TextSource in the written qde has no PlainTextSelection')

console.log('\n' + (failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`))
process.exit(failures === 0 ? 0 : 1)
