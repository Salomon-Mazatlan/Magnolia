import { app } from 'electron'
import { XMLBuilder } from 'fast-xml-parser'
import type {
  Project,
  Code,
  TextSource,
  PlainTextSelection,
  Coding,
  Memo
} from '../../renderer/models/types'
import {
  surveyToRefi,
  type RefiVariable,
  type RefiCase,
  type RefiRespondentDoc
} from './survey-refi'

// XML special-char escaping. Order matters: replace & first so the
// subsequent replacements don't re-escape the ampersand we just emitted
// for the entity references.
function xmlEscapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
function xmlEscapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  // fast-xml-parser collapses any attribute whose stringified value is
  // exactly "true" into HTML-style boolean syntax (just the attribute
  // name, no value). REFI-QDA's schema mandates a value for booleans
  // like isCodable, so Atlas.ti rejects the file with "Specification
  // mandates value for attribute isCodable" when this collapsing is
  // active. Force the builder to always emit name="value".
  suppressBooleanAttributes: false,
  // Take entity-encoding control away from fast-xml-parser and do it
  // ourselves. The library's default escaping has gaps (notably in
  // attribute values) that produced REFI-QDA files external tools
  // like Atlas.ti rejected with "attributes construct error" on
  // codes / docs / users whose name contained &, <, >, or "
  // characters.
  processEntities: false,
  attributeValueProcessor: (_name, value) =>
    typeof value === 'string' ? xmlEscapeAttr(value) : String(value),
  tagValueProcessor: (_name, value) =>
    typeof value === 'string' ? xmlEscapeText(value) : String(value)
})

function serializeCode(code: Code): any {
  const obj: any = {
    '@_guid': code.guid,
    '@_name': code.name,
    // REFI-QDA requires isCodable on every Code element. Default to
    // true when the field is undefined (legacy data or codes imported
    // from a tool that didn't set it) so the export never produces an
    // empty / missing attribute and never throws on .toString() of
    // undefined.
    '@_isCodable': (code.isCodable ?? true).toString()
  }
  if (code.color) obj['@_color'] = code.color
  if (code.description) obj.Description = code.description
  if (code.children.length > 0) {
    obj.Code = code.children.map(serializeCode)
  }
  return obj
}

function serializeCoding(coding: Coding): any {
  return {
    '@_guid': coding.guid,
    '@_creatingUser': coding.creatingUser,
    '@_creationDateTime': coding.creationDateTime,
    CodeRef: { '@_targetGUID': coding.codeGuid }
  }
}

function serializeSelection(sel: PlainTextSelection): any {
  const obj: any = {
    '@_guid': sel.guid,
    '@_startPosition': sel.startPosition.toString(),
    '@_endPosition': sel.endPosition.toString()
  }
  if (sel.name) obj['@_name'] = sel.name
  if (sel.creatingUser) obj['@_creatingUser'] = sel.creatingUser
  if (sel.creationDateTime) obj['@_creationDateTime'] = sel.creationDateTime
  if (sel.modifyingUser) obj['@_modifyingUser'] = sel.modifyingUser
  if (sel.modifiedDateTime) obj['@_modifiedDateTime'] = sel.modifiedDateTime
  if (sel.description) obj.Description = sel.description
  if (sel.codings.length > 0) {
    obj.Coding = sel.codings.map(serializeCoding)
  }
  return obj
}

/** Resolve the real audio extension. Mirrors writer.ts's helper —
 *  duplicated here because xml-serializer.ts has no fs access of its
 *  own. Falls back to "audio" if no extension is recoverable. */
function audioExtensionFor(source: any): string {
  const explicit = source.formatData?.audioExt as string | undefined
  if (explicit) return explicit.toLowerCase()
  const fromName = (source.name || '').toString().match(/\.([a-z0-9]+)$/i)?.[1]
  if (fromName && fromName.toLowerCase() !== 'audio') return fromName.toLowerCase()
  const fromPath = (source.formatData?.audioFilePath as string | undefined || '')
    .match(/\.([a-z0-9]+)$/i)?.[1]
  if (fromPath && fromPath.toLowerCase() !== 'audio') return fromPath.toLowerCase()
  return 'audio'
}

function serializeTextSource(source: TextSource): any {
  const obj: any = {
    '@_guid': source.guid
  }
  if (source.name) obj['@_name'] = source.name
  if (source.plainTextPath) obj['@_plainTextPath'] = source.plainTextPath
  if (source.richTextPath) obj['@_richTextPath'] = source.richTextPath
  if (source.creatingUser) obj['@_creatingUser'] = source.creatingUser
  if (source.creationDateTime) obj['@_creationDateTime'] = source.creationDateTime
  if (source.modifyingUser) obj['@_modifyingUser'] = source.modifyingUser
  if (source.modifiedDateTime) obj['@_modifiedDateTime'] = source.modifiedDateTime
  if (source.plainTextContent) {
    obj.PlainTextContent = source.plainTextContent
  }
  // Survey-cell selections are NOT emitted here. Their startPosition/
  // endPosition are cell-relative (offsets into one answer cell), which
  // is meaningless against this source's plain text — other QDA tools
  // would render them at the wrong place. They round-trip in full via
  // the magnolia-sources.json side-table instead, and the codings on
  // open-ended cells are additionally promoted to proper source-relative
  // spans on the per-respondent documents (see survey-refi.ts).
  const emittable = source.selections.filter((sel) => !(sel as any).surveyCell)
  if (emittable.length > 0) {
    obj.PlainTextSelection = emittable.map(serializeSelection)
  }
  return obj
}

/** Serialize a <PictureSelection> rectangle (REFI-QDA: pixels, top-left).
 *  firstX/firstY/secondX/secondY are xs:integer in the QDA-XML schema, so
 *  the pixel coordinates MUST be whole numbers — emitting the raw floats
 *  (e.g. "1734.0419…") makes Atlas.ti reject the entire project as invalid
 *  and makes MAXQDA silently drop the image coding. Round to integers. */
function serializePictureSelection(sel: PlainTextSelection): any | null {
  if (!sel.pdfRegion) return null
  const r = sel.pdfRegion
  const obj: any = {
    '@_guid': sel.guid,
    '@_firstX': Math.round(r.x).toString(),
    '@_firstY': Math.round(r.y).toString(),
    '@_secondX': Math.round(r.x + r.width).toString(),
    '@_secondY': Math.round(r.y + r.height).toString()
  }
  if (sel.name) obj['@_name'] = sel.name
  if (sel.creatingUser) obj['@_creatingUser'] = sel.creatingUser
  if (sel.creationDateTime) obj['@_creationDateTime'] = sel.creationDateTime
  if (sel.modifyingUser) obj['@_modifyingUser'] = sel.modifyingUser
  if (sel.modifiedDateTime) obj['@_modifiedDateTime'] = sel.modifiedDateTime
  if (sel.description) obj.Description = sel.description
  if (sel.codings.length > 0) {
    obj.Coding = sel.codings.map(serializeCoding)
  }
  return obj
}

/** Serialize a single video time-range selection as REFI-QDA <VideoSelection>.
 *  begin/end are stored in milliseconds per the spec. */
function serializeVideoSelection(sel: PlainTextSelection): any | null {
  if (!sel.timeRange) return null
  const obj: any = {
    '@_guid': sel.guid,
    '@_begin': Math.round(sel.timeRange.startTime * 1000).toString(),
    '@_end': Math.round(sel.timeRange.endTime * 1000).toString()
  }
  if (sel.name) obj['@_name'] = sel.name
  if (sel.creatingUser) obj['@_creatingUser'] = sel.creatingUser
  if (sel.creationDateTime) obj['@_creationDateTime'] = sel.creationDateTime
  if (sel.modifyingUser) obj['@_modifyingUser'] = sel.modifyingUser
  if (sel.modifiedDateTime) obj['@_modifiedDateTime'] = sel.modifiedDateTime
  if (sel.description) obj.Description = sel.description
  if (sel.codings.length > 0) {
    obj.Coding = sel.codings.map(serializeCoding)
  }
  return obj
}

/** Serialize a video source as REFI-QDA <VideoSource>. The video bytes are
 *  stored separately by writer.ts as `sources/${guid}.${ext}`. */
function serializeVideoSource(source: TextSource): any {
  const ext = (source.formatData?.videoExt as string) || 'mp4'
  const obj: any = {
    '@_guid': source.guid,
    '@_path': `internal://${source.guid}.${ext}`
  }
  if (source.name) obj['@_name'] = source.name
  if (source.creatingUser) obj['@_creatingUser'] = source.creatingUser
  if (source.creationDateTime) obj['@_creationDateTime'] = source.creationDateTime
  if (source.modifyingUser) obj['@_modifyingUser'] = source.modifyingUser
  if (source.modifiedDateTime) obj['@_modifiedDateTime'] = source.modifiedDateTime
  const videoSelections = source.selections
    .map(serializeVideoSelection)
    .filter((s) => s !== null)
  if (videoSelections.length > 0) {
    obj.VideoSelection = videoSelections
  }
  return obj
}

/** Serialize an audio source as REFI-QDA <AudioSource>. The audio
 *  bytes are stored separately by writer.ts as
 *  `sources/${guid}.${ext}`; the `path` attribute points at that
 *  internal path with the real extension so other QDA tools can pick
 *  the right decoder. The transcript text (if any) lives at
 *  `sources/${guid}.txt` and the path on the AudioSource carries the
 *  binary location, not the transcript. */
function serializeAudioSource(source: TextSource): any {
  const ext = audioExtensionFor(source as any)
  const obj: any = {
    '@_guid': source.guid,
    '@_path': `internal://${source.guid}.${ext}`
  }
  if (source.name) obj['@_name'] = source.name
  if (source.creatingUser) obj['@_creatingUser'] = source.creatingUser
  if (source.creationDateTime) obj['@_creationDateTime'] = source.creationDateTime
  if (source.modifyingUser) obj['@_modifyingUser'] = source.modifyingUser
  if (source.modifiedDateTime) obj['@_modifiedDateTime'] = source.modifiedDateTime
  return obj
}

/** Stable derivation of a Representation GUID from a source GUID. The
 *  RFC-4122 spec doesn't mandate that a child element's guid differ
 *  from its parent's, but Atlas.ti's validator (and the Phase 1
 *  reference implementations) cross-check uniqueness — re-using the
 *  source's guid makes the file fail with a generic "not valid"
 *  error. Flipping the first hex character produces a deterministic
 *  but distinct guid so the .txt filename and the Representation's
 *  guid match across save/load cycles. */
function representationGuidFor(sourceGuid: string): string {
  if (!sourceGuid) return sourceGuid
  const first = sourceGuid[0]
  // 0↔f, 1↔e, etc. Reversible, deterministic, never returns the input.
  const flipped = (15 - parseInt(first, 16)).toString(16)
  return Number.isNaN(parseInt(first, 16)) ? sourceGuid : flipped + sourceGuid.slice(1)
}

/** Serialize a PDF source as REFI-QDA <PDFSource>. The PDF bytes are
 *  stored separately by writer.ts as `sources/${guid}.pdf`; the
 *  extracted text lives at `sources/${reprGuid}.txt` and is referenced
 *  via a child <Representation>. Round-trippable through Atlas.ti /
 *  NVivo / MAXQDA — they all expect the Representation child to point
 *  at the text rather than putting plainTextPath on the PDFSource
 *  itself, AND they expect:
 *   - the Representation's guid to be distinct from the PDFSource's,
 *   - PlainTextSelections (codings on the extracted text) to live
 *     INSIDE the Representation, not at the PDFSource level. The
 *     QDA-XML schema scopes text-selections to the Representation
 *     since they're indexed against the .txt's character offsets. */
function serializePdfSource(source: TextSource): any {
  const obj: any = {
    '@_guid': source.guid,
    '@_path': `internal://${source.guid}.pdf`
  }
  if (source.name) obj['@_name'] = source.name
  if (source.creatingUser) obj['@_creatingUser'] = source.creatingUser
  if (source.creationDateTime) obj['@_creationDateTime'] = source.creationDateTime
  if (source.modifyingUser) obj['@_modifyingUser'] = source.modifyingUser
  if (source.modifiedDateTime) obj['@_modifiedDateTime'] = source.modifiedDateTime
  const reprGuid = representationGuidFor(source.guid)
  const repr: any = {
    '@_guid': reprGuid,
    '@_plainTextPath': `internal://${reprGuid}.txt`
  }
  if (source.name) repr['@_name'] = `Representation_for_${source.name}`
  // Mirror the source's timestamps onto the Representation so the
  // file matches the structure Atlas.ti, NVivo, and MAXQDA produce.
  // Some validators reject Representation elements that omit them.
  if (source.creatingUser) repr['@_creatingUser'] = source.creatingUser
  if (source.creationDateTime) repr['@_creationDateTime'] = source.creationDateTime
  if (source.modifyingUser) repr['@_modifyingUser'] = source.modifyingUser
  if (source.modifiedDateTime) repr['@_modifiedDateTime'] = source.modifiedDateTime
  if (source.selections.length > 0) {
    repr.PlainTextSelection = source.selections.map(serializeSelection)
  }
  obj.Representation = repr
  return obj
}

/** Serialize an image source as REFI-QDA <PictureSource>. The image bytes
 *  are stored separately by writer.ts as `sources/${guid}.${ext}`. */
function serializeImageSource(source: TextSource): any {
  const ext = (source.formatData?.imageExt as string) || 'png'
  const obj: any = {
    '@_guid': source.guid,
    '@_path': `internal://${source.guid}.${ext}`
  }
  if (source.name) obj['@_name'] = source.name
  if (source.creatingUser) obj['@_creatingUser'] = source.creatingUser
  if (source.creationDateTime) obj['@_creationDateTime'] = source.creationDateTime
  if (source.modifyingUser) obj['@_modifyingUser'] = source.modifyingUser
  if (source.modifiedDateTime) obj['@_modifiedDateTime'] = source.modifiedDateTime
  const pictureSelections = source.selections
    .map(serializePictureSelection)
    .filter((s) => s !== null)
  if (pictureSelections.length > 0) {
    obj.PictureSelection = pictureSelections
  }
  return obj
}

/** Serialize one REFI-QDA <Variable>. */
function serializeVariable(v: RefiVariable): any {
  const obj: any = {
    '@_guid': v.guid,
    '@_name': v.name,
    '@_typeOfVariable': v.typeOfVariable
  }
  if (v.description) obj.Description = v.description
  return obj
}

/** Serialize one REFI-QDA <Case> (a survey respondent), with its
 *  <SourceRef>s and typed <VariableValue> children. */
function serializeCase(c: RefiCase): any {
  const obj: any = { '@_guid': c.guid, '@_name': c.name }
  // CaseType's child sequence is fixed: Description?, CodeRef*,
  // VariableValue*, SourceRef*, SelectionRef*. fast-xml-parser emits in
  // object-key insertion order, so VariableValue MUST be assigned before
  // SourceRef — Atlas.ti rejects the whole file ("project file is not
  // valid") on any out-of-order child here.
  if (c.values.length > 0) {
    obj.VariableValue = c.values.map((val) => {
      const vv: any = { VariableRef: { '@_targetGUID': val.variableGuid } }
      if (val.textValue != null) vv.TextValue = val.textValue
      else if (val.booleanValue != null) vv.BooleanValue = val.booleanValue ? 'true' : 'false'
      else if (val.integerValue != null) vv.IntegerValue = String(val.integerValue)
      else if (val.floatValue != null) vv.FloatValue = String(val.floatValue)
      return vv
    })
  }
  if (c.sourceRefGuids.length > 0) {
    obj.SourceRef = c.sourceRefGuids.map((g) => ({ '@_targetGUID': g }))
  }
  return obj
}

/** Serialize a generated per-respondent open-ended document as an inline
 *  <TextSource> (PlainTextContent + coded PlainTextSelection children).
 *  Inline so writer.ts needs no extra zip entries for these synthetic
 *  documents. */
function serializeRespondentDoc(doc: RefiRespondentDoc): any {
  const obj: any = { '@_guid': doc.guid }
  if (doc.name) obj['@_name'] = doc.name
  if (doc.text) obj.PlainTextContent = doc.text
  if (doc.selections.length > 0) {
    obj.PlainTextSelection = doc.selections.map((sel) => {
      const s: any = {
        '@_guid': sel.guid,
        '@_startPosition': sel.startPosition.toString(),
        '@_endPosition': sel.endPosition.toString()
      }
      if (sel.codings.length > 0) s.Coding = sel.codings.map(serializeCoding)
      return s
    })
  }
  return obj
}

/** Aggregate the standards-native survey representation (Variables +
 *  Cases + per-respondent open-ended documents) across every survey
 *  source in the project. Returns empty arrays when there are no
 *  surveys. */
function collectSurveyRefi(
  project: Project
): {
  variables: RefiVariable[]
  cases: RefiCase[]
  respondentDocs: RefiRespondentDoc[]
  /** `${sourceGuid} ${respondentId}` → respondent doc guid, so a tag on
   *  a respondent can be emitted as a <MemberSource> pointing at that
   *  respondent's exported document (REFI Sets can't reference Cases). */
  respondentDocGuid: Record<string, string>
} {
  const variables: RefiVariable[] = []
  const cases: RefiCase[] = []
  const respondentDocs: RefiRespondentDoc[] = []
  const respondentDocGuid: Record<string, string> = {}
  for (const s of project.sources as any[]) {
    if (s.sourceType !== 'survey') continue
    const survey = s.formatData?.survey
    if (!survey) continue
    const refi = surveyToRefi(survey, { guid: s.guid, selections: s.selections ?? [] })
    variables.push(...refi.variables)
    cases.push(...refi.cases)
    respondentDocs.push(...refi.respondentDocs)
    for (const d of refi.respondentDocs) respondentDocGuid[d.sourceGuid + ' ' + d.respondentId] = d.guid
  }
  return { variables, cases, respondentDocs, respondentDocGuid }
}

export function serializeProject(project: Project): string {
  const proj: any = {
    '?xml': { '@_version': '1.0', '@_encoding': 'utf-8', '@_standalone': 'yes' },
    Project: {
      '@_xmlns': 'urn:QDA-XML:project:1.0',
      '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@_xsi:schemaLocation':
        'urn:QDA-XML:project:1.0 http://schema.qdasoftware.org/versions/Project/v1.0/Project.xsd',
      '@_name': project.name,
      '@_origin': project.origin || `Magnolia ${app.getVersion()}`
    }
  }

  const p = proj.Project

  if (project.creatingUserGUID) p['@_creatingUserGUID'] = project.creatingUserGUID
  if (project.creationDateTime) p['@_creationDateTime'] = project.creationDateTime
  if (project.modifyingUserGUID) p['@_modifyingUserGUID'] = project.modifyingUserGUID
  if (project.modifiedDateTime) p['@_modifiedDateTime'] = project.modifiedDateTime

  // Users
  if (project.users.length > 0) {
    p.Users = {
      User: project.users.map((u) => {
        const obj: any = { '@_guid': u.guid }
        if (u.name) obj['@_name'] = u.name
        if (u.id) obj['@_id'] = u.id
        return obj
      })
    }
  }

  // CodeBook
  if (project.codes.length > 0) {
    p.CodeBook = {
      Codes: {
        Code: project.codes.map(serializeCode)
      }
    }
  }

  // Variables + Cases — the standards-native survey representation.
  // Must come before <Sources> in the QDA-XML 1.0 element sequence
  // (Users, CodeBook, Variables, Cases, Sources, …) or the file fails
  // schema validation in Atlas.ti / MAXQDA. Object-key insertion order
  // below is what fast-xml-parser emits, so order matters here.
  const surveyRefi = collectSurveyRefi(project)
  if (surveyRefi.variables.length > 0) {
    p.Variables = { Variable: surveyRefi.variables.map(serializeVariable) }
  }
  if (surveyRefi.cases.length > 0) {
    p.Cases = { Case: surveyRefi.cases.map(serializeCase) }
  }

  // Sources — dispatch by sourceType so each source emits the correct
  // REFI-QDA element (PDFSource / AudioSource / PictureSource /
  // VideoSource / TextSource). Tools like Atlas.ti reject the file
  // outright when, e.g., a PDF is wrapped in a <TextSource>.
  if (project.sources.length > 0) {
    const pdfSources = project.sources.filter((s) => (s as any).sourceType === 'pdf')
    const audioSources = project.sources.filter((s) => (s as any).sourceType === 'audio')
    const imageSources = project.sources.filter((s) => (s as any).sourceType === 'image')
    const videoSources = project.sources.filter((s) => (s as any).sourceType === 'video')
    const textSources = project.sources.filter(
      (s) => (s as any).sourceType !== 'pdf'
        && (s as any).sourceType !== 'audio'
        && (s as any).sourceType !== 'image'
        && (s as any).sourceType !== 'video'
    )
    p.Sources = {}
    // Real text sources plus the generated per-respondent open-ended
    // documents (which carry the promoted survey-cell codings).
    const textSourceXml = [
      ...textSources.map(serializeTextSource),
      ...surveyRefi.respondentDocs.map(serializeRespondentDoc)
    ]
    if (textSourceXml.length > 0) {
      p.Sources.TextSource = textSourceXml
    }
    if (pdfSources.length > 0) {
      p.Sources.PDFSource = pdfSources.map(serializePdfSource)
    }
    if (audioSources.length > 0) {
      p.Sources.AudioSource = audioSources.map(serializeAudioSource)
    }
    if (imageSources.length > 0) {
      p.Sources.PictureSource = imageSources.map(serializeImageSource)
    }
    if (videoSources.length > 0) {
      p.Sources.VideoSource = videoSources.map(serializeVideoSource)
    }
  }

  // Anchor memos to their target with REFI-QDA <NoteRef> so the link
  // survives in other tools. Document memos → a NoteRef on the source.
  // Text content memos (a span on a text source) → a NoteRef-bearing
  // PlainTextSelection (no Coding) carrying the span. Other memo types
  // (survey / analysis / query / PDF-region content) stay project-level.
  if (project.memos && project.memos.length > 0 && p.Sources) {
    const docMemosBySource = new Map<string, string[]>()
    const spanMemosBySource = new Map<string, Memo[]>()
    for (const m of project.memos) {
      if (m.type === 'document' && m.sourceGuids) {
        for (const sg of m.sourceGuids) {
          const a = docMemosBySource.get(sg) ?? []
          a.push(m.guid)
          docMemosBySource.set(sg, a)
        }
      } else if (m.type === 'content' && m.sourceGuid && !m.surveyCell && !m.pdfRegion) {
        const a = spanMemosBySource.get(m.sourceGuid) ?? []
        a.push(m)
        spanMemosBySource.set(m.sourceGuid, a)
      }
    }
    const addDocRefs = (sx: any): void => {
      const refs = docMemosBySource.get(sx['@_guid'])
      if (refs && refs.length > 0) sx.NoteRef = refs.map((g) => ({ '@_targetGUID': g }))
    }
    for (const sx of (p.Sources.TextSource ?? []) as any[]) {
      const spans = spanMemosBySource.get(sx['@_guid'])
      if (spans && spans.length > 0) {
        const sels: any[] = Array.isArray(sx.PlainTextSelection)
          ? sx.PlainTextSelection
          : sx.PlainTextSelection
            ? [sx.PlainTextSelection]
            : []
        for (const m of spans) {
          sels.push({
            '@_guid': representationGuidFor(m.guid),
            '@_startPosition': String(m.startPosition ?? 0),
            '@_endPosition': String(m.endPosition ?? 0),
            '@_name': m.title || 'Memo',
            NoteRef: { '@_targetGUID': m.guid }
          })
        }
        sx.PlainTextSelection = sels
      }
      addDocRefs(sx)
    }
    for (const sx of (p.Sources.PDFSource ?? []) as any[]) addDocRefs(sx)
    for (const sx of (p.Sources.AudioSource ?? []) as any[]) addDocRefs(sx)
    for (const sx of (p.Sources.PictureSource ?? []) as any[]) addDocRefs(sx)
    for (const sx of (p.Sources.VideoSource ?? []) as any[]) addDocRefs(sx)
  }

  // Notes (memos) — emitted as REFI-QDA project-level <Note>s so memos
  // round-trip with other tools (Atlas.ti / MAXQDA), which is how Atlas
  // stores them. Each note's body is a plain-text file the writer adds at
  // sources/<guid>.txt. Must sit AFTER <Sources> and BEFORE <Sets> in the
  // QDA-XML 1.0 element sequence (object-key insertion order is what
  // fast-xml-parser emits). Magnolia also keeps magnolia-memos.json for
  // full-fidelity round-trips of its own (anchors + survey/analysis/query
  // memo types REFI can't express); on load it prefers that side table and
  // falls back to these Notes for files from other tools.
  if (project.memos && project.memos.length > 0) {
    p.Notes = {
      Note: project.memos.map((m) => {
        const obj: any = {
          '@_guid': m.guid,
          '@_name': m.title || 'Memo',
          '@_plainTextPath': `internal://${m.guid}.txt`
        }
        if (project.creatingUserGUID) obj['@_creatingUser'] = project.creatingUserGUID
        if (m.createdDateTime) obj['@_creationDateTime'] = m.createdDateTime
        if (project.creatingUserGUID) obj['@_modifyingUser'] = project.creatingUserGUID
        if (m.modifiedDateTime || m.createdDateTime) {
          obj['@_modifiedDateTime'] = m.modifiedDateTime || m.createdDateTime
        }
        return obj
      })
    }
  }

  // Sets (tags)
  if (project.sets.length > 0) {
    p.Sets = {
      Set: project.sets.map((s) => {
        const obj: any = {
          '@_guid': s.guid,
          '@_name': s.name
        }
        if (s.description) obj.Description = s.description
        // A tag on a survey respondent maps to a <MemberSource> pointing
        // at that respondent's exported open-ended document (REFI Sets
        // have no MemberCase), so Atlas.ti / MAXQDA surface the tag on
        // those respondent documents. Question tags have no analogous
        // single document, so they stay Magnolia-only (side-table).
        const respondentDocGuids = ((s as any).memberSurveyRespondents ?? [])
          .map((m: { sourceGuid: string; id: string }) => surveyRefi.respondentDocGuid[m.sourceGuid + ' ' + m.id])
          .filter((g: string | undefined): g is string => !!g)
        const memberSources = [...s.memberSourceGuids, ...respondentDocGuids]
        if (memberSources.length > 0) {
          obj.MemberSource = memberSources.map((g) => ({
            '@_targetGUID': g
          }))
        }
        if (s.memberCodeGuids.length > 0) {
          obj.MemberCode = s.memberCodeGuids.map((g) => ({
            '@_targetGUID': g
          }))
        }
        return obj
      })
    }
  }

  return uppercaseGuids(builder.build(proj))
}

/** Post-pass that upper-cases the value of every attribute that holds
 *  a GUID. Magnolia generates and stores GUIDs uppercase end-to-end
 *  (see src/renderer/utils/guid.ts), so this pass is normally a no-op.
 *  Kept as defence-in-depth: if any code path ever lowercases a GUID
 *  before it reaches the XML, this guarantees the on-disk format still
 *  satisfies the QDA-XML 1.0 schema (Atlas.ti / MAXQDA reject lowercase
 *  GUIDs as schema-invalid). Targets attributes named guid, targetGUID,
 *  creatingUser(GUID), modifyingUser(GUID). */
function uppercaseGuids(xml: string): string {
  const guidPattern = /\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/g
  return xml.replace(
    /\b(guid|targetGUID|creatingUser(?:GUID)?|modifyingUser(?:GUID)?)="([^"]+)"/g,
    (_m, attr, val) => {
      const upped = val.replace(guidPattern, (g: string) => g.toUpperCase())
      return `${attr}="${upped}"`
    }
  )
}
