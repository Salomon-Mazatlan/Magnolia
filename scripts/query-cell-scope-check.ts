/**
 * Standalone check for cell-precise survey scoping in the query engine
 * (Phase 2 / task 13b). Builds a survey with codings + answers on two
 * respondents and two questions, then runs queries filtered by a
 * respondent tag and a question tag, asserting results are restricted to
 * the matching cells. Bundle + run via esbuild (no test runner in repo).
 */
import { executeQuery } from '../src/renderer/utils/query-engine'
import type { Query, TextSource, QDASet, Code, SurveyData } from '../src/renderer/models/types'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) { failures++; console.error('  ✗ ' + msg) } else { console.log('  ✓ ' + msg) }
}

const S = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'
const CODE1 = 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC'
const R1 = 'R1', R2 = 'R2', Q1 = 'Q1', Q2 = 'Q2'

const survey: SurveyData = {
  name: 'S',
  columns: [],
  questions: [
    { id: Q1, text: 'Q one', rawText: 'Q one', type: 'open-ended', columns: [{ columnId: 'c1', optionLabel: 'r' }] },
    { id: Q2, text: 'Q two', rawText: 'Q two', type: 'open-ended', columns: [{ columnId: 'c2', optionLabel: 'r' }] }
  ],
  metadataColumnIds: [],
  respondents: [
    { id: R1, displayName: 'R1', metadata: {}, answers: { [Q1]: 'apple pie', [Q2]: 'apple cake' } },
    { id: R2, displayName: 'R2', metadata: {}, answers: { [Q1]: 'apple tart', [Q2]: 'banana split' } }
  ]
}

// One coded selection per cell, all coded CODE1. Offsets cover "apple".
const mkSel = (rid: string, qid: string, guid: string) => ({
  guid,
  startPosition: 0,
  endPosition: 5,
  surveyCell: { respondentId: rid, questionId: qid },
  codings: [{ guid: `cod-${guid}`, codeGuid: CODE1 }]
})

const source: TextSource = {
  guid: S,
  name: 'Survey',
  selections: [mkSel(R1, Q1, 's-r1q1'), mkSel(R1, Q2, 's-r1q2'), mkSel(R2, Q1, 's-r2q1'), mkSel(R2, Q2, 's-r2q2')],
  ...( { sourceType: 'survey', formatData: { survey, rawCsv: '' } } as any )
} as any

const codes: Code[] = [{ guid: CODE1, name: 'Code1', isCodable: true, children: [] }]

// Unified tag model: one tag scopes docs + survey cells.
//   TR → respondent R1; TQ → question Q1; TS → the whole survey (source).
const tags: QDASet[] = [
  { guid: 'TR', name: 'TaggedRespondent', memberSourceGuids: [], memberCodeGuids: [], memberSurveyRespondents: [{ sourceGuid: S, id: R1 }] },
  { guid: 'TQ', name: 'TaggedQuestion', memberSourceGuids: [], memberCodeGuids: [], memberSurveyQuestions: [{ sourceGuid: S, id: Q1 }] },
  { guid: 'TS', name: 'TaggedSurvey', memberSourceGuids: [S], memberCodeGuids: [] }
]

const sources = [source]
const contents = { [S]: '' }
const codeQuery = (df: Query['documentFilter']): Query => ({ documentFilter: df, codeCondition: { type: 'code', codeGuid: CODE1 } })
const textQuery = (df: Query['documentFilter']): Query => ({ documentFilter: df, codeCondition: { type: 'text', searchText: 'apple' } as any })

const cells = (rs: { selectionGuid: string }[]) => rs.map((r) => r.selectionGuid).sort().join(',')

console.log('--- Code query, no tag filter (baseline) ---')
let r = executeQuery(codeQuery({}), sources, contents, codes, tags)
assert(r.length === 4, `all 4 coded cells returned (got ${r.length})`)

console.log('\n--- Code query, tag = respondent R1 (survey enters scope via the respondent) ---')
r = executeQuery(codeQuery({ tagGuids: ['TR'] }), sources, contents, codes, tags)
assert(cells(r) === 's-r1q1,s-r1q2', `R1 cells only (got ${cells(r)})`)

console.log('\n--- Code query, tag = question Q1 ---')
r = executeQuery(codeQuery({ tagGuids: ['TQ'] }), sources, contents, codes, tags)
assert(cells(r) === 's-r1q1,s-r2q1', `Q1 cells only (got ${cells(r)})`)

console.log('\n--- Code query, tags R1 + Q1 (union within the filter) ---')
r = executeQuery(codeQuery({ tagGuids: ['TR', 'TQ'] }), sources, contents, codes, tags)
assert(cells(r) === 's-r1q1,s-r1q2,s-r2q1', `union of R1 and Q1 cells (got ${cells(r)})`)

console.log('\n--- Code query, whole-survey tag = all cells ---')
r = executeQuery(codeQuery({ tagGuids: ['TS'] }), sources, contents, codes, tags)
assert(r.length === 4, `whole-survey tag yields all cells (got ${r.length})`)

console.log('\n--- Code query, exclude respondent R1 ---')
r = executeQuery(codeQuery({ tagExcludeGuids: ['TR'] }), sources, contents, codes, tags)
assert(cells(r) === 's-r2q1,s-r2q2', `R1 cells excluded (got ${cells(r)})`)

console.log('\n--- Text query "apple", tag = respondent R1 ---')
r = executeQuery(textQuery({ tagGuids: ['TR'] }), sources, contents, codes, tags)
// R1 has "apple" in both Q1 and Q2 → 2 matches; R2's are out of scope.
assert(r.length === 2, `only R1's apple matches (got ${r.length})`)
assert(r.every((x) => x.selectionGuid.includes(`-${R1}-`)), 'all matches are R1 cells')

console.log('\n' + (failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`))
process.exit(failures === 0 ? 0 : 1)
