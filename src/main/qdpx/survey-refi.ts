/**
 * Survey ⇄ REFI-QDA Variables/Cases/Documents interop layer.
 *
 * Magnolia stores a survey as a single TextSource (the CSV) plus a
 * Magnolia-specific `magnolia-sources.json` side-table that carries the
 * full parsed `SurveyData` and the (respondentId, questionId) identity
 * of every coded cell. That side-table round-trips perfectly
 * Magnolia↔Magnolia but is invisible to Atlas.ti / MAXQDA: they drop
 * unknown zip entries on re-export, so a survey degrades to a plain CSV
 * blob — and any codings on it vanish — the moment it passes through
 * another tool.
 *
 * This module expresses the same survey in the *standard* REFI-QDA
 * constructs those tools natively use:
 *
 *   - <Variables>   one Variable per metadata column + per CLOSED-ended
 *                   question (single-choice → Text, numeric → Float,
 *                   multi-select → one Boolean Variable per option).
 *   - <Cases>       one Case per respondent, carrying a typed
 *                   <VariableValue> per Variable and a <SourceRef> to
 *                   that respondent's open-ended document (below).
 *   - per-respondent
 *     <TextSource>  the respondent's OPEN-ENDED answers as real document
 *                   text, with a <PlainTextSelection>+<Coding> over each
 *                   coded span. This is what lets open-ended codings
 *                   survive a round-trip through another tool: the span
 *                   is first-class codable text, not Magnolia metadata.
 *
 * Open-ended answers deliberately live in the documents (not as Text
 * variables) so their text is codable; closed/metadata answers live in
 * variables. Each open-ended segment is prefixed with a machine-
 * readable `[[MQ:<questionId>]] <question text>` sentinel so import can
 * map a coded span back to its (respondent, question) cell and the
 * cell-relative offset Magnolia's viewer expects.
 *
 * Fidelity: the closed-question Description tags and the document
 * sentinels make a Magnolia → tool → Magnolia trip faithful when they
 * survive. A foreign-authored file (no sentinels) reconstructs closed
 * questions from variables; open-ended recovery needs the sentinels.
 */
import { v4 as uuidv4 } from 'uuid'
import type {
  Coding,
  SurveyColumn,
  SurveyColumnType,
  SurveyData,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyRespondent,
  PlainTextSelection
} from '../../renderer/models/types'

export type RefiVariableType =
  | 'Text'
  | 'Boolean'
  | 'Integer'
  | 'Float'
  | 'Date'
  | 'DateTime'

export interface RefiVariable {
  guid: string
  name: string
  typeOfVariable: RefiVariableType
  /** Standard REFI-QDA <Description>. We piggy-back a `magnolia:v1:…`
   *  classification tag here so the exact SurveyColumnType survives a
   *  round-trip even though typeOfVariable can't express it. */
  description?: string
}

export interface RefiVariableValue {
  variableGuid: string
  /** Exactly one of the *Value fields is set, matching the variable's type. */
  textValue?: string
  booleanValue?: boolean
  integerValue?: number
  floatValue?: number
}

export interface RefiCase {
  guid: string
  name: string
  /** SourceRef targetGUIDs — the documents this case spans. For a
   *  Magnolia survey this is the respondent's open-ended document. */
  sourceRefGuids: string[]
  values: RefiVariableValue[]
}

/** A source-relative coded span inside a respondent's open-ended doc. */
export interface RefiDocSelection {
  guid: string
  startPosition: number
  endPosition: number
  codings: Coding[]
}

/** A generated per-respondent open-ended document. Emitted as an inline
 *  <TextSource> (PlainTextContent + PlainTextSelection children). */
export interface RefiRespondentDoc {
  guid: string
  name: string
  text: string
  selections: RefiDocSelection[]
  /** The survey source + respondent this doc represents — lets tag
   *  membership on a respondent map to a <MemberSource> pointing at this
   *  doc (REFI Sets can't reference Cases), and lets import map it back. */
  sourceGuid: string
  respondentId: string
}

export interface SurveyRefi {
  variables: RefiVariable[]
  cases: RefiCase[]
  respondentDocs: RefiRespondentDoc[]
}

/** The slice of a survey TextSource this module needs. */
export interface SurveySourceLike {
  guid: string
  selections: PlainTextSelection[]
}

/** GUIDs are uppercase end-to-end in Magnolia (see renderer/utils/guid.ts
 *  for the rationale). Generated locally rather than imported from the
 *  renderer so the main-process bundle stays self-contained — mirroring
 *  xml-deserializer.ts's own normalizeGuid. */
function generateGuid(): string {
  return uuidv4().toUpperCase()
}

/** Codepoint length (not UTF-16 code-unit length). Survey cell offsets
 *  are codepoint offsets in Magnolia's viewer, so document offsets must
 *  be counted the same way to stay aligned across the round-trip. */
function cpLength(s: string): number {
  return [...s].length
}

/** Cleaning applied to a survey cell's raw value. MUST stay byte-for-byte
 *  identical to renderer/utils/survey/cell-text.ts `cleanCellText` —
 *  cell-relative selection offsets are indexed against this exact
 *  output, so any drift here lands codings on the wrong characters. */
function cleanCellText(raw: string): string {
  return (raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Mirror of renderer/utils/survey/cell-text.ts `buildCellText`. */
function buildCellText(answer: string | string[] | undefined): string {
  if (Array.isArray(answer)) return answer.map(cleanCellText).join('\n')
  return cleanCellText(answer ?? '')
}

const TAG = 'magnolia:v1:'

/** Open-ended segment sentinel. Embeds the question id so a coded span
 *  maps back to its cell on import. */
const SENTINEL_RE = /^\[\[MQ:([^\]]+)\]\] ?(.*)$/

function tagFor(type: Exclude<SurveyColumnType, 'skip' | 'multi-select' | 'open-ended'>): string {
  return `${TAG}${type}`
}

function multiSelectTag(questionId: string, optionIndex: number): string {
  return `${TAG}multi-select:${questionId}:${optionIndex}`
}

function parseTag(
  description: string | undefined
): { type: SurveyColumnType; questionId?: string; optionIndex?: number } | null {
  if (!description || !description.startsWith(TAG)) return null
  const rest = description.slice(TAG.length)
  if (rest.startsWith('multi-select:')) {
    const [, questionId, idxStr] = rest.split(':')
    return { type: 'multi-select', questionId, optionIndex: parseInt(idxStr, 10) || 0 }
  }
  const valid: SurveyColumnType[] = ['metadata', 'single-choice', 'numeric']
  if ((valid as string[]).includes(rest)) return { type: rest as SurveyColumnType }
  return null
}

function lookupColumn(survey: SurveyData, columnId: string): SurveyColumn | undefined {
  return survey.columns.find((c) => c.id === columnId)
}

function answerString(respondent: SurveyRespondent, questionId: string): string {
  const a = respondent.answers[questionId]
  if (a == null) return ''
  return Array.isArray(a) ? a.join(', ') : a
}

/** Build one respondent's open-ended document: the text plus a map of
 *  questionId → the codepoint range of that answer's body within the
 *  text (used to translate cell-relative coded offsets to
 *  source-relative ones). */
function buildRespondentDoc(
  respondent: SurveyRespondent,
  openEnded: SurveyQuestion[]
): { text: string; answerStart: Map<string, number> } {
  let text = ''
  let cp = 0
  const answerStart = new Map<string, number>()
  for (const q of openEnded) {
    const header = `[[MQ:${q.id}]] ${q.text}\n`
    text += header
    cp += cpLength(header)
    answerStart.set(q.id, cp)
    const body = buildCellText(respondent.answers[q.id])
    text += body
    cp += cpLength(body)
    text += '\n\n'
    cp += 2
  }
  return { text, answerStart }
}

/**
 * Map a SurveyData onto REFI-QDA Variables + Cases + per-respondent
 * open-ended documents. `source` supplies the survey TextSource guid and
 * its cell selections (the codings to promote into document spans).
 */
export function surveyToRefi(survey: SurveyData, source: SurveySourceLike): SurveyRefi {
  const variables: RefiVariable[] = []
  const metaVarByColumn = new Map<string, RefiVariable>()
  const questionVars = new Map<string, { question: SurveyQuestion; vars: RefiVariable[] }>()

  // Metadata columns → Text variables.
  for (const columnId of survey.metadataColumnIds) {
    const col = lookupColumn(survey, columnId)
    if (!col) continue
    const v: RefiVariable = {
      guid: generateGuid(),
      name: col.cleanHeader || col.rawHeader || `Field ${col.index + 1}`,
      typeOfVariable: 'Text',
      description: tagFor('metadata')
    }
    variables.push(v)
    metaVarByColumn.set(columnId, v)
  }

  // Closed-ended questions → variables. Open-ended ones are handled as
  // documents below, not variables.
  for (const q of survey.questions) {
    if (q.type === 'open-ended') continue
    if (q.type === 'multi-select') {
      const optionVars: RefiVariable[] = q.columns.map((c, i) => ({
        guid: generateGuid(),
        name: `${q.text} — ${c.optionLabel}`,
        typeOfVariable: 'Boolean' as const,
        description: multiSelectTag(q.id, i)
      }))
      variables.push(...optionVars)
      questionVars.set(q.id, { question: q, vars: optionVars })
    } else {
      const v: RefiVariable = {
        guid: generateGuid(),
        name: q.text,
        typeOfVariable: q.type === 'numeric' ? 'Float' : 'Text',
        description: tagFor(q.type === 'numeric' ? 'numeric' : 'single-choice')
      }
      variables.push(v)
      questionVars.set(q.id, { question: q, vars: [v] })
    }
  }

  const openEnded = survey.questions.filter((q) => q.type === 'open-ended')

  // Cell selections, grouped by respondent, for the open-ended cells.
  const cellSelsByRespondent = new Map<string, PlainTextSelection[]>()
  for (const sel of source.selections) {
    const cell = (sel as any).surveyCell as { respondentId: string; questionId: string } | undefined
    if (!cell) continue
    if (!openEnded.some((q) => q.id === cell.questionId)) continue
    const arr = cellSelsByRespondent.get(cell.respondentId) ?? []
    arr.push(sel)
    cellSelsByRespondent.set(cell.respondentId, arr)
  }

  const respondentDocs: RefiRespondentDoc[] = []

  const cases: RefiCase[] = survey.respondents.map((r) => {
    const values: RefiVariableValue[] = []

    for (const [columnId, v] of metaVarByColumn) {
      const raw = r.metadata[columnId] ?? ''
      if (raw !== '') values.push({ variableGuid: v.guid, textValue: raw })
    }
    for (const { question, vars } of questionVars.values()) {
      if (question.type === 'multi-select') {
        const selected = r.answers[question.id]
        const selectedSet = new Set(Array.isArray(selected) ? selected : [])
        question.columns.forEach((c, i) => {
          values.push({ variableGuid: vars[i].guid, booleanValue: selectedSet.has(c.optionLabel) })
        })
      } else if (question.type === 'numeric') {
        const raw = answerString(r, question.id).trim()
        const num = Number(raw.replace(/,/g, ''))
        if (raw !== '' && Number.isFinite(num)) {
          values.push({ variableGuid: vars[0].guid, floatValue: num })
        }
      } else {
        const raw = answerString(r, question.id)
        if (raw !== '') values.push({ variableGuid: vars[0].guid, textValue: raw })
      }
    }

    const sourceRefGuids: string[] = []
    if (openEnded.length > 0) {
      const { text, answerStart } = buildRespondentDoc(r, openEnded)
      const docGuid = generateGuid()
      const selections: RefiDocSelection[] = []
      for (const sel of cellSelsByRespondent.get(r.id) ?? []) {
        const cell = (sel as any).surveyCell as { questionId: string }
        const base = answerStart.get(cell.questionId)
        if (base == null) continue
        // Fresh guids on BOTH the selection and its codings: the same
        // cell selection is also serialized cell-relative on the main
        // survey source for the side-table path, so reusing either guid
        // here produces a file-wide duplicate that Atlas.ti rejects
        // ("Globally unique identifier is not unique"). codeGuid (the
        // CodeRef target) is preserved — only the element's own guid
        // changes.
        selections.push({
          guid: generateGuid(),
          startPosition: base + (sel.startPosition ?? 0),
          endPosition: base + (sel.endPosition ?? 0),
          codings: (sel.codings ?? []).map((cd) => ({ ...cd, guid: generateGuid() }))
        })
      }
      respondentDocs.push({ guid: docGuid, name: `${r.displayName} — responses`, text, selections, sourceGuid: source.guid, respondentId: r.id })
      sourceRefGuids.push(docGuid)
    }

    return { guid: generateGuid(), name: r.displayName, sourceRefGuids, values }
  })

  return { variables, cases, respondentDocs }
}

function inferType(v: RefiVariable): SurveyColumnType {
  if (v.typeOfVariable === 'Boolean') return 'single-choice'
  if (v.typeOfVariable === 'Float' || v.typeOfVariable === 'Integer') return 'numeric'
  return 'open-ended'
}

function valueToString(val: RefiVariableValue): string {
  if (val.textValue != null) return val.textValue
  if (val.booleanValue != null) return val.booleanValue ? 'true' : 'false'
  if (val.integerValue != null) return String(val.integerValue)
  if (val.floatValue != null) return String(val.floatValue)
  return ''
}

/** Parse one respondent doc's text into open-ended segments. Returns
 *  per-question { text, bodyStartCp } using the [[MQ:id]] sentinels. */
function parseRespondentDoc(
  text: string
): Map<string, { body: string; bodyStartCp: number }> {
  const out = new Map<string, { body: string; bodyStartCp: number }>()
  if (!text) return out
  const lines = text.split('\n')
  let cp = 0
  let current: { qid: string; bodyStartCp: number; bodyLines: string[] } | null = null
  const flush = (): void => {
    if (!current) return
    // Drop the trailing blank line that separates segments.
    const body = current.bodyLines.join('\n').replace(/\n+$/, '')
    out.set(current.qid, { body, bodyStartCp: current.bodyStartCp })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(SENTINEL_RE)
    if (m) {
      flush()
      // body starts on the next line: advance past this line + its '\n'.
      const headerCp = cpLength(line) + 1
      current = { qid: m[1], bodyStartCp: cp + headerCp, bodyLines: [] }
    } else if (current) {
      current.bodyLines.push(line)
    }
    cp += cpLength(line) + 1 // +1 for the '\n' removed by split
  }
  flush()
  return out
}

/**
 * Reconstruct a best-effort SurveyData (plus the cell selections to
 * attach to its source) from REFI-QDA Variables + Cases + per-respondent
 * open-ended documents. Used when a survey arrives without Magnolia's
 * side-table — i.e. a file that round-tripped through (or originated in)
 * Atlas.ti / MAXQDA.
 *
 * `docByGuid` maps a respondent-doc guid to its text + parsed coded
 * spans. Closed questions/values come from variables; open-ended
 * questions/answers and their codings come from the documents.
 */
export function refiToSurvey(
  variables: RefiVariable[],
  cases: RefiCase[],
  docByGuid: Map<string, { text: string; selections: RefiDocSelection[] }>,
  surveyName: string
): { survey: SurveyData; cellSelections: PlainTextSelection[]; docToRespondent: Record<string, string> } {
  const referenced = new Set<string>()
  for (const c of cases) for (const val of c.values) referenced.add(val.variableGuid)
  const ours = variables.filter((v) => referenced.has(v.guid))

  const columns: SurveyColumn[] = []
  const questions: SurveyQuestion[] = []
  const metadataColumnIds: string[] = []
  const columnIdByVar = new Map<string, string>()
  const multiGroups = new Map<string, SurveyQuestion>()
  let index = 0

  // ── Closed questions + metadata, from variables ──
  for (const v of ours) {
    const tag = parseTag(v.description)
    const type = tag ? tag.type : inferType(v)

    if (type === 'multi-select' && tag?.questionId != null) {
      const columnId = generateGuid()
      columnIdByVar.set(v.guid, columnId)
      const optionLabel = v.name.includes(' — ') ? v.name.slice(v.name.indexOf(' — ') + 3) : v.name
      const questionText = v.name.includes(' — ') ? v.name.slice(0, v.name.indexOf(' — ')) : v.name
      columns.push({
        id: columnId, index: index++, rawHeader: questionText, rawSubhead: optionLabel,
        cleanHeader: questionText, cleanSubhead: optionLabel, type: 'multi-select'
      })
      let q = multiGroups.get(tag.questionId)
      if (!q) {
        q = { id: generateGuid(), text: questionText, rawText: questionText, type: 'multi-select', columns: [] }
        multiGroups.set(tag.questionId, q)
        questions.push(q)
      }
      q.columns.push({ columnId, optionLabel })
      q.columns.sort(
        (a, b) =>
          (parseTag(ours.find((x) => columnIdByVar.get(x.guid) === a.columnId)?.description)?.optionIndex ?? 0) -
          (parseTag(ours.find((x) => columnIdByVar.get(x.guid) === b.columnId)?.description)?.optionIndex ?? 0)
      )
      continue
    }

    const columnId = generateGuid()
    columnIdByVar.set(v.guid, columnId)
    columns.push({
      id: columnId, index: index++, rawHeader: v.name, rawSubhead: type === 'metadata' ? '' : 'Response',
      cleanHeader: v.name, cleanSubhead: type === 'metadata' ? '' : 'Response', type
    })
    if (type === 'metadata') metadataColumnIds.push(columnId)
    else questions.push({
      id: generateGuid(), text: v.name, rawText: v.name,
      type: type as SurveyQuestionType, columns: [{ columnId, optionLabel: 'Response' }]
    })
  }

  // ── Open-ended questions, from the document sentinels ──
  // oldQuestionId (from [[MQ:id]]) → reconstructed question + its column.
  const openByOldId = new Map<string, { question: SurveyQuestion; columnId: string }>()
  const parsedDocs = new Map<string, Map<string, { body: string; bodyStartCp: number }>>()
  for (const [guid, doc] of docByGuid) {
    const segs = parseRespondentDoc(doc.text)
    parsedDocs.set(guid, segs)
    for (const [oldId, seg] of segs) {
      if (openByOldId.has(oldId)) continue
      // The question text is the sentinel header tail; recover it from
      // the first line above the body — but parseRespondentDoc dropped
      // it, so re-extract from the raw text.
      const headerMatch = doc.text.split('\n').map((l) => l.match(SENTINEL_RE)).find((m) => m?.[1] === oldId)
      const text = headerMatch?.[2]?.trim() || 'Open-ended response'
      const columnId = generateGuid()
      const question: SurveyQuestion = {
        id: generateGuid(), text, rawText: text, type: 'open-ended',
        columns: [{ columnId, optionLabel: 'Open-Ended Response' }]
      }
      columns.push({
        id: columnId, index: index++, rawHeader: text, rawSubhead: 'Open-Ended Response',
        cleanHeader: text, cleanSubhead: 'Open-Ended Response', type: 'open-ended'
      })
      questions.push(question)
      openByOldId.set(oldId, { question, columnId })
      void seg
    }
  }

  // ── Respondents, from cases ──
  const cellSelections: PlainTextSelection[] = []
  // respondent-doc guid → reconstructed respondent id, so the reader can
  // turn a tag Set's <MemberSource> (pointing at a respondent doc) back
  // into a respondent tag.
  const docToRespondent: Record<string, string> = {}
  const respondents: SurveyRespondent[] = cases.map((c, ci) => {
    const valueByVar = new Map<string, RefiVariableValue>()
    for (const val of c.values) valueByVar.set(val.variableGuid, val)
    const respondentId = generateGuid()

    const metadata: Record<string, string> = {}
    for (const v of ours) {
      const columnId = columnIdByVar.get(v.guid)
      if (!columnId || !metadataColumnIds.includes(columnId)) continue
      const val = valueByVar.get(v.guid)
      metadata[columnId] = val ? valueToString(val) : ''
    }

    const answers: Record<string, string | string[]> = {}
    for (const q of questions) {
      if (q.type === 'open-ended') continue // filled from the doc below
      if (q.type === 'multi-select') {
        const selected: string[] = []
        for (const c2 of q.columns) {
          const varGuid = [...columnIdByVar.entries()].find(([, cid]) => cid === c2.columnId)?.[0]
          if (!varGuid) continue
          if (valueByVar.get(varGuid)?.booleanValue) selected.push(c2.optionLabel)
        }
        answers[q.id] = selected
      } else {
        const varGuid = [...columnIdByVar.entries()].find(([, cid]) => cid === q.columns[0].columnId)?.[0]
        const val = varGuid ? valueByVar.get(varGuid) : undefined
        answers[q.id] = val ? valueToString(val) : ''
      }
    }

    // Open-ended answers + cell codings from this respondent's doc.
    const docGuid = c.sourceRefGuids.find((g) => docByGuid.has(g))
    if (docGuid) {
      docToRespondent[docGuid] = respondentId
      const segs = parsedDocs.get(docGuid)!
      const doc = docByGuid.get(docGuid)!
      for (const [oldId, seg] of segs) {
        const recon = openByOldId.get(oldId)
        if (!recon) continue
        answers[recon.question.id] = seg.body
        // Translate this respondent-doc's coded spans that fall inside
        // this segment into cell-relative selections.
        const bodyEnd = seg.bodyStartCp + cpLength(seg.body)
        for (const dsel of doc.selections) {
          if (dsel.startPosition < seg.bodyStartCp || dsel.startPosition >= bodyEnd) continue
          cellSelections.push({
            guid: generateGuid(),
            startPosition: dsel.startPosition - seg.bodyStartCp,
            endPosition: Math.min(dsel.endPosition, bodyEnd) - seg.bodyStartCp,
            codings: dsel.codings,
            surveyCell: { respondentId, questionId: recon.question.id }
          } as PlainTextSelection)
        }
      }
    }

    return { id: respondentId, displayName: c.name || `Respondent ${ci + 1}`, metadata, answers }
  })

  return {
    survey: { name: surveyName, columns, questions, metadataColumnIds, respondents },
    cellSelections,
    docToRespondent
  }
}
