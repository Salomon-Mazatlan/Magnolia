import { XMLParser } from 'fast-xml-parser'
import type {
  Project,
  User,
  Code,
  TextSource,
  PlainTextSelection,
  Coding,
  QDASet
} from '../../renderer/models/types'
import type { RefiVariable, RefiCase, RefiVariableValue, RefiVariableType } from './survey-refi'
import type { RefiGraph, RefiVertex, RefiEdge, RefiEdgeDirection, RefiLineStyle, RefiLink } from './graph-refi'
import type { RefiTranscript, RefiSyncPoint, RefiTranscriptSelection } from './transcript-refi'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => {
    // Elements that can appear multiple times
    return [
      'User', 'Code', 'TextSource', 'PictureSource', 'PDFSource',
      'AudioSource', 'VideoSource', 'PlainTextSelection', 'PDFSelection',
      'PictureSelection', 'VideoSelection',
      'Coding', 'CodeRef', 'NoteRef', 'Set', 'MemberSource', 'MemberCode',
      'Note', 'Link', 'VariableValue', 'Variable', 'Case', 'SourceRef',
      'Graph', 'Vertex', 'Edge', 'Transcript', 'SyncPoint', 'TranscriptSelection'
    ].includes(name)
  }
})

function normalizeGuid(guid: string | undefined): string {
  if (!guid) return ''
  // GUIDs are uppercase end-to-end in Magnolia (renderer state,
  // magnolia-*.json side-tables, sources/<guid>.<ext> filenames, and
  // the on-disk XML attributes). See src/renderer/utils/guid.ts for
  // the rationale.
  return guid.replace(/[{}]/g, '').toUpperCase()
}

/** Media extensions that are audio-only. MAXQDA (and some other tools) store
 *  audio recordings as <VideoSource>, so we trust the file extension over the
 *  element name and route these to Magnolia's audio viewer. Mirrors the audio
 *  format-registry extension list. */
const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'])

function extensionOf(path: string | undefined): string {
  return (String(path || '').split('.').pop() || '').toLowerCase()
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

function parseCode(xmlCode: any): Code {
  const children = ensureArray(xmlCode.Code).map(parseCode)
  return {
    guid: normalizeGuid(xmlCode['@_guid']),
    name: xmlCode['@_name'] ?? '',
    isCodable: xmlCode['@_isCodable'] === 'false' ? false : true,
    color: xmlCode['@_color'],
    description: xmlCode.Description,
    children
  }
}

function parseCoding(xmlCoding: any): Coding {
  const codeRef = xmlCoding.CodeRef
  const codeRefArray = ensureArray(codeRef)
  return {
    guid: normalizeGuid(xmlCoding['@_guid']),
    codeGuid: codeRefArray.length > 0 ? normalizeGuid(codeRefArray[0]['@_targetGUID']) : '',
    creatingUser: normalizeGuid(xmlCoding['@_creatingUser']),
    creationDateTime: xmlCoding['@_creationDateTime']
  }
}

function parseSelection(xmlSel: any): PlainTextSelection {
  return {
    guid: normalizeGuid(xmlSel['@_guid']),
    name: xmlSel['@_name'],
    startPosition: parseInt(xmlSel['@_startPosition'], 10),
    endPosition: parseInt(xmlSel['@_endPosition'], 10),
    creatingUser: normalizeGuid(xmlSel['@_creatingUser']),
    creationDateTime: xmlSel['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSel['@_modifyingUser']),
    modifiedDateTime: xmlSel['@_modifiedDateTime'],
    description: xmlSel.Description,
    codings: ensureArray(xmlSel.Coding).map(parseCoding)
  }
}

/** A <PlainTextSelection> that carries only a <NoteRef> (no <Coding>) is a
 *  memo anchor, not a coding — exclude it from a source's selections so it
 *  doesn't surface as a phantom uncoded highlight. The memo it anchors is
 *  reconstructed from the project's <Notes> + this NoteRef (see reader.ts). */
function isMemoAnchorSelection(xmlSel: any): boolean {
  return !!xmlSel.NoteRef && !xmlSel.Coding
}

function parseTextSource(xmlSource: any): TextSource {
  return {
    guid: normalizeGuid(xmlSource['@_guid']),
    name: xmlSource['@_name'] ?? '',
    plainTextPath: xmlSource['@_plainTextPath'],
    plainTextContent: xmlSource.PlainTextContent,
    richTextPath: xmlSource['@_richTextPath'],
    creatingUser: normalizeGuid(xmlSource['@_creatingUser']),
    creationDateTime: xmlSource['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSource['@_modifyingUser']),
    modifiedDateTime: xmlSource['@_modifiedDateTime'],
    selections: ensureArray(xmlSource.PlainTextSelection)
      .filter((sel: any) => !isMemoAnchorSelection(sel))
      .map(parseSelection)
  }
}

/** Raw PDFSelection attached to a PDF source for later conversion. */
/** A REFI-QDA project-level <Note> (a memo), as parsed from the .qde. */
export interface RawNote {
  guid: string
  name: string
  plainTextPath?: string
  creationDateTime?: string
  modifiedDateTime?: string
}

/** Where a <Note> is anchored, derived from a <NoteRef>. A source-level
 *  ref has no span (document memo); a selection-level ref carries the span
 *  (content memo). */
export interface RawNoteAnchor {
  sourceGuid: string
  startPosition?: number
  endPosition?: number
}

export interface RawPdfSelection {
  guid: string
  name?: string
  page: number
  firstX: number
  firstY: number
  secondX: number
  secondY: number
  creatingUser?: string
  creationDateTime?: string
  modifyingUser?: string
  modifiedDateTime?: string
  codings: Coding[]
}

function parsePDFSelection(xmlSel: any): RawPdfSelection {
  return {
    guid: normalizeGuid(xmlSel['@_guid']),
    name: xmlSel['@_name'],
    page: parseInt(xmlSel['@_page'], 10),
    firstX: parseFloat(xmlSel['@_firstX']),
    firstY: parseFloat(xmlSel['@_firstY']),
    secondX: parseFloat(xmlSel['@_secondX']),
    secondY: parseFloat(xmlSel['@_secondY']),
    creatingUser: normalizeGuid(xmlSel['@_creatingUser']),
    creationDateTime: xmlSel['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSel['@_modifyingUser']),
    modifiedDateTime: xmlSel['@_modifiedDateTime'],
    codings: ensureArray(xmlSel.Coding).map(parseCoding)
  }
}

/** Raw PictureSelection (REFI-QDA: pixel rectangle on an image source). */
export interface RawPictureSelection {
  guid: string
  name?: string
  firstX: number
  firstY: number
  secondX: number
  secondY: number
  creatingUser?: string
  creationDateTime?: string
  modifyingUser?: string
  modifiedDateTime?: string
  codings: Coding[]
}

function parsePictureSelection(xmlSel: any): RawPictureSelection {
  return {
    guid: normalizeGuid(xmlSel['@_guid']),
    name: xmlSel['@_name'],
    firstX: parseFloat(xmlSel['@_firstX']),
    firstY: parseFloat(xmlSel['@_firstY']),
    secondX: parseFloat(xmlSel['@_secondX']),
    secondY: parseFloat(xmlSel['@_secondY']),
    creatingUser: normalizeGuid(xmlSel['@_creatingUser']),
    creationDateTime: xmlSel['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSel['@_modifyingUser']),
    modifiedDateTime: xmlSel['@_modifiedDateTime'],
    codings: ensureArray(xmlSel.Coding).map(parseCoding)
  }
}

/**
 * Parse a <PictureSource>. Returns a TextSource-shaped record with
 * `sourceType: 'image'`, the internal image path in `plainTextPath` (e.g.
 * "internal://GUID.png"), and any raw PictureSelection children in a
 * transient `_rawPictureSelections` field. The reader converts those
 * rectangle selections into Magnolia's region-based selections (page=1)
 * after copying the image to a temp file.
 */
function parsePictureSource(xmlSource: any): TextSource {
  const source: TextSource & { _rawPictureSelections?: RawPictureSelection[] } = {
    guid: normalizeGuid(xmlSource['@_guid']),
    name: xmlSource['@_name'] ?? '',
    sourceType: 'image',
    plainTextPath: xmlSource['@_path'],
    creatingUser: normalizeGuid(xmlSource['@_creatingUser']),
    creationDateTime: xmlSource['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSource['@_modifyingUser']),
    modifiedDateTime: xmlSource['@_modifiedDateTime'],
    selections: []
  }
  const raw = ensureArray(xmlSource.PictureSelection).map(parsePictureSelection)
  if (raw.length > 0) source._rawPictureSelections = raw
  return source
}

/** Raw <VideoSelection> attached to a VideoSource for later conversion. */
export interface RawVideoSelection {
  guid: string
  name?: string
  begin: number   // milliseconds (REFI-QDA spec)
  end: number     // milliseconds
  creatingUser?: string
  creationDateTime?: string
  modifyingUser?: string
  modifiedDateTime?: string
  codings: Coding[]
}

function parseVideoSelection(xmlSel: any): RawVideoSelection {
  return {
    guid: normalizeGuid(xmlSel['@_guid']),
    name: xmlSel['@_name'],
    begin: parseInt(xmlSel['@_begin'] ?? '0', 10),
    end: parseInt(xmlSel['@_end'] ?? '0', 10),
    creatingUser: normalizeGuid(xmlSel['@_creatingUser']),
    creationDateTime: xmlSel['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSel['@_modifyingUser']),
    modifiedDateTime: xmlSel['@_modifiedDateTime'],
    codings: ensureArray(xmlSel.Coding).map(parseCoding)
  }
}

/**
 * Parse a <VideoSource>. Returns a TextSource-shaped record with
 * sourceType 'video', the internal video path in plainTextPath (e.g.
 * "internal://GUID.mp4"), and any raw <VideoSelection> children in a
 * transient _rawVideoSelections field. The reader converts those to
 * Magnolia time-range PlainTextSelections after copying the video to a
 * temp file.
 */
function parseVideoSource(xmlSource: any): TextSource {
  // Trust the media file's extension: an audio-only file (.m4a, .mp3, …)
  // exported as a <VideoSource> is really audio and should open in the audio
  // viewer, not a black-box video player.
  const isAudio = AUDIO_EXTENSIONS.has(extensionOf(xmlSource['@_path']))
  const source: TextSource & {
    _rawVideoSelections?: RawVideoSelection[]
    _refiTranscript?: RefiTranscript
  } = {
    guid: normalizeGuid(xmlSource['@_guid']),
    name: xmlSource['@_name'] ?? '',
    sourceType: isAudio ? 'audio' : 'video',
    plainTextPath: xmlSource['@_path'],
    creatingUser: normalizeGuid(xmlSource['@_creatingUser']),
    creationDateTime: xmlSource['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSource['@_modifyingUser']),
    modifiedDateTime: xmlSource['@_modifiedDateTime'],
    selections: []
  }
  const raw = ensureArray(xmlSource.VideoSelection).map(parseVideoSelection)
  if (raw.length > 0) source._rawVideoSelections = raw
  const transcript = parseTranscript(xmlSource)
  if (transcript) source._refiTranscript = transcript
  return source
}

/** Parse a <Transcript> (child of an audio/video source) into the
 *  RefiTranscript shape — its text path plus the SyncPoints that pin
 *  transcript offsets to media times. The reader uses these to recover
 *  the per-line timings (lineTimes) for files that arrive without
 *  Magnolia's side-table. Only the first <Transcript> is consumed;
 *  Magnolia emits at most one per source. */
function parseTranscript(xmlSource: any): RefiTranscript | undefined {
  const xmlT = ensureArray(xmlSource.Transcript)[0]
  if (!xmlT) return undefined
  const num = (v: any): number | undefined => {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : undefined
  }
  const syncPoints: RefiSyncPoint[] = ensureArray(xmlT.SyncPoint).map((sp: any) => ({
    guid: normalizeGuid(sp['@_guid']),
    timeStamp: num(sp['@_timeStamp']),
    position: num(sp['@_position'])
  }))
  const selections: RefiTranscriptSelection[] = ensureArray(xmlT.TranscriptSelection).map((ts: any) => ({
    guid: normalizeGuid(ts['@_guid']),
    name: ts['@_name'],
    fromSyncPoint: ts['@_fromSyncPoint'] ? normalizeGuid(ts['@_fromSyncPoint']) : undefined,
    toSyncPoint: ts['@_toSyncPoint'] ? normalizeGuid(ts['@_toSyncPoint']) : undefined,
    creatingUser: normalizeGuid(ts['@_creatingUser']) || undefined,
    creationDateTime: ts['@_creationDateTime'],
    codings: ensureArray(ts.Coding).map(parseCoding)
  }))
  return {
    guid: normalizeGuid(xmlT['@_guid']),
    plainTextPath: xmlT['@_plainTextPath'] ?? '',
    syncPoints,
    selections
  }
}

/**
 * Parse an <AudioSource>. Returns a TextSource-shaped record with
 * sourceType 'audio' and the internal audio path stored in
 * plainTextPath so the reader can locate the binary inside the zip. Any
 * <Transcript> child is parsed onto the transient `_refiTranscript`
 * field for the reader to reconcile.
 */
function parseAudioSource(xmlSource: any): TextSource {
  const source: TextSource & { _refiTranscript?: RefiTranscript } = {
    guid: normalizeGuid(xmlSource['@_guid']),
    name: xmlSource['@_name'] ?? '',
    sourceType: 'audio',
    plainTextPath: xmlSource['@_path'],
    creatingUser: normalizeGuid(xmlSource['@_creatingUser']),
    creationDateTime: xmlSource['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSource['@_modifyingUser']),
    modifiedDateTime: xmlSource['@_modifiedDateTime'],
    selections: []
  }
  const transcript = parseTranscript(xmlSource)
  if (transcript) source._refiTranscript = transcript
  return source
}

/**
 * Parse a <PDFSource>. Returns a TextSource-shaped record carrying the
 * internal PDF path in `plainTextPath` (e.g. "internal://GUID.pdf") and any
 * raw PDFSelection children in a transient `_rawPdfSelections` field. The
 * reader converts those rectangle selections to character-offset
 * PlainTextSelections after it has extracted the PDF's text.
 */
function parsePDFSource(xmlSource: any): TextSource {
  // Pick up the Representation's plainTextPath if present so the
  // reader can locate the extracted-text file even when its filename
  // differs from the PDF source's guid (which is the case for files
  // produced by Atlas.ti and by current Magnolia exports — both use a
  // distinct guid for the Representation).
  const repr = ensureArray(xmlSource.Representation)[0]
  const reprPlainTextPath = repr?.['@_plainTextPath']
  const source: TextSource & { _rawPdfSelections?: RawPdfSelection[]; _representationPlainTextPath?: string } = {
    guid: normalizeGuid(xmlSource['@_guid']),
    name: xmlSource['@_name'] ?? '',
    sourceType: 'pdf',
    plainTextPath: xmlSource['@_path'],
    creatingUser: normalizeGuid(xmlSource['@_creatingUser']),
    creationDateTime: xmlSource['@_creationDateTime'],
    modifyingUser: normalizeGuid(xmlSource['@_modifyingUser']),
    modifiedDateTime: xmlSource['@_modifiedDateTime'],
    selections: []
  }
  if (reprPlainTextPath) source._representationPlainTextPath = reprPlainTextPath
  // PDFSelection children are rectangle-based (cross-tool format) and
  // need converting to char offsets after the PDF text is extracted —
  // stored on the transient _rawPdfSelections field.
  const raw = ensureArray(xmlSource.PDFSelection).map(parsePDFSelection)
  if (raw.length > 0) source._rawPdfSelections = raw
  // PlainTextSelection children are already in char-offset form. The
  // schema places these inside the Representation (since they index
  // against the .txt's character offsets), but legacy Magnolia files
  // wrote them at the PDFSource level — accept both for round-trip.
  const reprSelections = repr ? ensureArray(repr.PlainTextSelection).map(parseSelection) : []
  const directSelections = ensureArray(xmlSource.PlainTextSelection).map(parseSelection)
  source.selections = [...reprSelections, ...directSelections]
  return source
}

function parseVariable(xmlVar: any): RefiVariable {
  return {
    guid: normalizeGuid(xmlVar['@_guid']),
    name: xmlVar['@_name'] ?? '',
    typeOfVariable: (xmlVar['@_typeOfVariable'] ?? 'Text') as RefiVariableType,
    description: xmlVar.Description
  }
}

/** Parse a <VariableValue>: a <VariableRef> plus exactly one typed
 *  value element. fast-xml-parser auto-coerces tag values (so
 *  <FloatValue>4</FloatValue> arrives as the number 4 and
 *  <BooleanValue>true</BooleanValue> as the boolean true) — normalise
 *  each back into the RefiVariableValue shape. */
function parseVariableValue(xmlVal: any): RefiVariableValue {
  const variableGuid = normalizeGuid(ensureArray(xmlVal.VariableRef)[0]?.['@_targetGUID'])
  const out: RefiVariableValue = { variableGuid }
  if (xmlVal.TextValue != null) out.textValue = String(xmlVal.TextValue)
  else if (xmlVal.BooleanValue != null) {
    out.booleanValue = xmlVal.BooleanValue === true || xmlVal.BooleanValue === 'true'
  } else if (xmlVal.IntegerValue != null) out.integerValue = Number(xmlVal.IntegerValue)
  else if (xmlVal.FloatValue != null) out.floatValue = Number(xmlVal.FloatValue)
  return out
}

function parseCase(xmlCase: any): RefiCase {
  return {
    guid: normalizeGuid(xmlCase['@_guid']),
    name: xmlCase['@_name'] ?? '',
    sourceRefGuids: ensureArray(xmlCase.SourceRef).map((r: any) =>
      normalizeGuid(r['@_targetGUID'])
    ),
    values: ensureArray(xmlCase.VariableValue).map(parseVariableValue)
  }
}

function parseVertex(xmlV: any): RefiVertex {
  const num = (v: any): number | undefined => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    guid: normalizeGuid(xmlV['@_guid']),
    representedGuid: xmlV['@_representedGUID'] ? normalizeGuid(xmlV['@_representedGUID']) : undefined,
    name: xmlV['@_name'],
    firstX: num(xmlV['@_firstX']) ?? 0,
    firstY: num(xmlV['@_firstY']) ?? 0,
    secondX: num(xmlV['@_secondX']),
    secondY: num(xmlV['@_secondY']),
    shape: xmlV['@_shape'],
    color: xmlV['@_color']
  }
}

function parseEdge(xmlE: any): RefiEdge {
  return {
    guid: normalizeGuid(xmlE['@_guid']),
    representedGuid: xmlE['@_representedGUID'] ? normalizeGuid(xmlE['@_representedGUID']) : undefined,
    name: xmlE['@_name'],
    sourceVertex: normalizeGuid(xmlE['@_sourceVertex']),
    targetVertex: normalizeGuid(xmlE['@_targetVertex']),
    color: xmlE['@_color'],
    direction: xmlE['@_direction'] as RefiEdgeDirection | undefined,
    lineStyle: xmlE['@_lineStyle'] as RefiLineStyle | undefined
  }
}

function parseGraph(xmlG: any): RefiGraph {
  return {
    guid: normalizeGuid(xmlG['@_guid']),
    name: xmlG['@_name'],
    vertices: ensureArray(xmlG.Vertex).map(parseVertex),
    edges: ensureArray(xmlG.Edge).map(parseEdge)
  }
}

function parseLink(xmlL: any): RefiLink {
  return {
    guid: normalizeGuid(xmlL['@_guid']),
    name: xmlL['@_name'],
    direction: xmlL['@_direction'] as RefiEdgeDirection | undefined,
    color: xmlL['@_color'],
    originGuid: xmlL['@_originGUID'] ? normalizeGuid(xmlL['@_originGUID']) : undefined,
    targetGuid: xmlL['@_targetGUID'] ? normalizeGuid(xmlL['@_targetGUID']) : undefined
  }
}

export function deserializeProject(xml: string): Project {
  const parsed = parser.parse(xml)
  const proj = parsed.Project

  const users: User[] = ensureArray(proj.Users?.User).map((u: any) => ({
    guid: normalizeGuid(u['@_guid']),
    name: u['@_name'],
    id: u['@_id']
  }))

  const codes: Code[] = ensureArray(proj.CodeBook?.Codes?.Code).map(parseCode)

  const sources: TextSource[] = [
    ...ensureArray(proj.Sources?.TextSource).map(parseTextSource),
    ...ensureArray(proj.Sources?.PDFSource).map(parsePDFSource),
    ...ensureArray(proj.Sources?.PictureSource).map(parsePictureSource),
    ...ensureArray(proj.Sources?.VideoSource).map(parseVideoSource),
    ...ensureArray(proj.Sources?.AudioSource).map(parseAudioSource)
  ]

  const sets: QDASet[] = ensureArray(proj.Sets?.Set).map((s: any) => ({
    guid: normalizeGuid(s['@_guid']),
    name: s['@_name'] ?? '',
    description: s.Description,
    memberSourceGuids: ensureArray(s.MemberSource).map((ms: any) =>
      normalizeGuid(ms['@_targetGUID'])
    ),
    memberCodeGuids: ensureArray(s.MemberCode).map((mc: any) =>
      normalizeGuid(mc['@_targetGUID'])
    )
  }))

  // REFI-QDA Variables + Cases — the standards-native survey
  // representation. Attached as transient fields (underscore-prefixed,
  // not part of the Project type) for reader.ts to consume when
  // reconstructing surveys that arrived without Magnolia's side-table.
  const refiVariables: RefiVariable[] = ensureArray(proj.Variables?.Variable).map(parseVariable)
  const refiCases: RefiCase[] = ensureArray(proj.Cases?.Case).map(parseCase)

  // REFI-QDA <Graphs> (relationship maps). Transient: reader.ts turns these
  // into relationship-map saved analyses when the file has no
  // magnolia-analyses.json side table (i.e. it came from another tool).
  const refiGraphs: RefiGraph[] = ensureArray(proj.Graphs?.Graph).map(parseGraph)

  // REFI-QDA <Links> (the relations a graph's edges represent). Transient:
  // reader.ts uses them to recover an imported edge's label/direction, which
  // other tools (Atlas) store on the <Link>, not the <Edge>.
  const refiLinks: RefiLink[] = ensureArray(proj.Links?.Link).map(parseLink)

  // REFI-QDA project-level <Note>s (memos). Transient: reader.ts loads each
  // note's text from its plainTextPath and builds Magnolia memos when the
  // file has no magnolia-memos.json side table (i.e. came from another tool).
  const refiNotes: RawNote[] = ensureArray(proj.Notes?.Note).map((n: any) => ({
    guid: normalizeGuid(n['@_guid']),
    name: n['@_name'] ?? 'Memo',
    plainTextPath: n['@_plainTextPath'],
    creationDateTime: n['@_creationDateTime'],
    modifiedDateTime: n['@_modifiedDateTime']
  }))

  // Where each note is anchored, from <NoteRef> elements: on a source =>
  // document memo; inside a (text) selection => content memo at that span.
  // reader.ts uses this to anchor memos built from <Notes> (foreign files).
  const refiNoteAnchors: Record<string, RawNoteAnchor> = {}
  const scanSourceNoteRefs = (sx: any): void => {
    const sourceGuid = normalizeGuid(sx['@_guid'])
    for (const nr of ensureArray(sx.NoteRef)) {
      refiNoteAnchors[normalizeGuid(nr['@_targetGUID'])] = { sourceGuid }
    }
    const scanSelections = (sels: any): void => {
      for (const sel of ensureArray(sels)) {
        for (const nr of ensureArray(sel.NoteRef)) {
          refiNoteAnchors[normalizeGuid(nr['@_targetGUID'])] = {
            sourceGuid,
            startPosition: parseInt(sel['@_startPosition'], 10) || 0,
            endPosition: parseInt(sel['@_endPosition'], 10) || 0
          }
        }
      }
    }
    scanSelections(sx.PlainTextSelection)
    for (const repr of ensureArray(sx.Representation)) scanSelections(repr.PlainTextSelection)
  }
  for (const sx of ensureArray(proj.Sources?.TextSource)) scanSourceNoteRefs(sx)
  for (const sx of ensureArray(proj.Sources?.PDFSource)) scanSourceNoteRefs(sx)
  for (const sx of ensureArray(proj.Sources?.PictureSource)) scanSourceNoteRefs(sx)
  for (const sx of ensureArray(proj.Sources?.AudioSource)) scanSourceNoteRefs(sx)
  for (const sx of ensureArray(proj.Sources?.VideoSource)) scanSourceNoteRefs(sx)

  return {
    name: proj['@_name'] ?? 'Untitled',
    origin: proj['@_origin'] ?? '',
    // Coerce in case the parser turned an all-numeric description into a number.
    ...(proj.Description != null ? { description: String(proj.Description) } : {}),
    creatingUserGUID: normalizeGuid(proj['@_creatingUserGUID']),
    creationDateTime: proj['@_creationDateTime'],
    modifyingUserGUID: normalizeGuid(proj['@_modifyingUserGUID']),
    modifiedDateTime: proj['@_modifiedDateTime'],
    users,
    codes,
    sources,
    sets,
    notes: [],
    ...(refiVariables.length > 0 ? { _refiVariables: refiVariables } : {}),
    ...(refiCases.length > 0 ? { _refiCases: refiCases } : {}),
    ...(refiNotes.length > 0 ? { _refiNotes: refiNotes } : {}),
    ...(Object.keys(refiNoteAnchors).length > 0 ? { _refiNoteAnchors: refiNoteAnchors } : {}),
    ...(refiGraphs.length > 0 ? { _refiGraphs: refiGraphs } : {}),
    ...(refiLinks.length > 0 ? { _refiLinks: refiLinks } : {})
  } as Project
}
