import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { validateXML } from 'xmllint-wasm'

// The serializer pulls the app version from electron for the `origin`
// attribute. Stub it so these run in plain Node (no Electron runtime).
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import { serializeProject } from '../../src/main/qdpx/xml-serializer'
import { deserializeProject } from '../../src/main/qdpx/xml-deserializer'
import type { Project, SurveyData } from '../../src/renderer/models/types'

// The authoritative QDA-XML 1.0 schema, kept in-repo (a tracked copy of the
// REFI-QDA Project.xsd) so this test runs without external assets.
const PROJECT_XSD = readFileSync(join(__dirname, '../fixtures/Project.xsd'), 'utf8')

/** Validate a serialized .qde against Project.xsd. Returns xmllint's result;
 *  the test asserts on `.valid` and surfaces `.errors` on failure. */
async function validate(xml: string): Promise<{ valid: boolean; errors: unknown[] }> {
  const result = await validateXML({
    xml: [{ fileName: 'project.qde', contents: xml }],
    schema: [PROJECT_XSD]
  })
  return { valid: result.valid, errors: result.errors }
}

const U = '00000000-0000-0000-0000-000000000001'
const DT = '2024-01-01T00:00:00Z'

/** A broad project exercising every source type, nested codes, a Set that
 *  carries BOTH code and source members (the ordering regression), memos,
 *  and an image/video region coding. */
function comprehensiveProject(): Project {
  const codeA = '11111111-1111-1111-1111-111111111111'
  const codeChild = '11111111-1111-1111-1111-1111111111AA'
  const textGuid = '22222222-2222-2222-2222-222222222222'
  const pdfGuid = '33333333-3333-3333-3333-333333333333'
  const imgGuid = '44444444-4444-4444-4444-444444444444'
  const audioGuid = '55555555-5555-5555-5555-555555555555'
  const videoGuid = '66666666-6666-6666-6666-666666666666'

  return {
    name: 'Comprehensive Test Project',
    origin: 'Magnolia test',
    description: 'A **markdown** project description with <special> & "chars".',
    creatingUserGUID: U,
    creationDateTime: DT,
    users: [{ guid: U, name: 'Tester', id: 'u1' }],
    codes: [
      {
        guid: codeA,
        name: 'Theme & <Sub>',
        isCodable: true,
        color: '#FF8800',
        description: 'A top-level code with special chars',
        children: [
          { guid: codeChild, name: 'Child code', isCodable: true, color: '#00AA00', children: [] }
        ]
      }
    ],
    sources: [
      {
        guid: textGuid,
        name: 'Interview 1',
        sourceType: 'text',
        plainTextContent: 'The quick brown fox.',
        selections: [
          {
            guid: '22222222-2222-2222-2222-0000000000A1',
            startPosition: 4,
            endPosition: 9,
            creatingUser: U,
            creationDateTime: DT,
            codings: [
              {
                guid: '22222222-2222-2222-2222-0000000000C1',
                codeGuid: codeA,
                creatingUser: U,
                creationDateTime: DT
              }
            ]
          }
        ]
      },
      {
        guid: pdfGuid,
        name: 'Report',
        sourceType: 'pdf',
        creatingUser: U,
        creationDateTime: DT,
        selections: [
          {
            guid: '33333333-3333-3333-3333-0000000000A1',
            startPosition: 0,
            endPosition: 10,
            codings: [
              { guid: '33333333-3333-3333-3333-0000000000C1', codeGuid: codeChild, creatingUser: U, creationDateTime: DT }
            ]
          }
        ]
      },
      {
        guid: imgGuid,
        name: 'Photo',
        sourceType: 'image',
        formatData: { imageExt: 'png' },
        selections: [
          {
            guid: '44444444-4444-4444-4444-0000000000A1',
            startPosition: 0,
            endPosition: 0,
            pdfRegion: { page: 1, x: 10.6, y: 20.2, width: 100.9, height: 50.1 },
            codings: [
              { guid: '44444444-4444-4444-4444-0000000000C1', codeGuid: codeA, creatingUser: U, creationDateTime: DT }
            ]
          }
        ]
      },
      {
        guid: audioGuid,
        name: 'Recording',
        sourceType: 'audio',
        formatData: { audioExt: 'm4a' },
        selections: []
      },
      {
        guid: videoGuid,
        name: 'Clip',
        sourceType: 'video',
        formatData: { videoExt: 'mp4' },
        selections: [
          {
            guid: '66666666-6666-6666-6666-0000000000A1',
            startPosition: 0,
            endPosition: 0,
            timeRange: { startTime: 1.5, endTime: 3.25 },
            codings: [
              { guid: '66666666-6666-6666-6666-0000000000C1', codeGuid: codeA, creatingUser: U, creationDateTime: DT }
            ]
          }
        ]
      }
    ],
    sets: [
      {
        guid: '77777777-7777-7777-7777-777777777777',
        name: 'Mixed set',
        description: 'Carries both code and source members',
        memberCodeGuids: [codeA, codeChild],
        memberSourceGuids: [textGuid, pdfGuid]
      }
    ],
    notes: [],
    memos: [
      {
        guid: '88888888-8888-8888-8888-888888888888',
        type: 'project',
        title: 'Project memo',
        content: 'Some thoughts about the project.',
        createdDateTime: DT,
        modifiedDateTime: DT
      }
    ]
  }
}

/** A survey project — exercises the standards-native Variables / Cases /
 *  per-respondent TextSource representation produced by survey-refi. */
function surveyProject(): Project {
  const survey: SurveyData = {
    name: 'Survey',
    columns: [
      { id: 'm1', index: 0, rawHeader: 'Country', rawSubhead: '', cleanHeader: 'Country', cleanSubhead: '', type: 'metadata' },
      { id: 'c1', index: 1, rawHeader: 'Gender', rawSubhead: 'Response', cleanHeader: 'Gender', cleanSubhead: 'Response', type: 'single-choice' },
      { id: 'n1', index: 2, rawHeader: 'Age', rawSubhead: 'Response', cleanHeader: 'Age', cleanSubhead: 'Response', type: 'numeric' },
      { id: 'o1', index: 3, rawHeader: 'Why?', rawSubhead: 'Response', cleanHeader: 'Why?', cleanSubhead: 'Response', type: 'open-ended' }
    ],
    questions: [
      { id: 'q-gender', text: 'Gender', rawText: 'Gender', type: 'single-choice', columns: [{ columnId: 'c1', optionLabel: 'Response' }] },
      { id: 'q-age', text: 'Age', rawText: 'Age', type: 'numeric', columns: [{ columnId: 'n1', optionLabel: 'Response' }] },
      { id: 'q-why', text: 'Why?', rawText: 'Why?', type: 'open-ended', columns: [{ columnId: 'o1', optionLabel: 'Response' }] }
    ],
    metadataColumnIds: ['m1'],
    respondents: [
      { id: 'r1', displayName: 'Alice', metadata: { m1: 'Australia' }, answers: { 'q-gender': 'F', 'q-age': '30', 'q-why': 'Because reasons' } }
    ]
  }
  return {
    name: 'Survey Project',
    origin: 'Magnolia test',
    creatingUserGUID: U,
    creationDateTime: DT,
    users: [{ guid: U, name: 'Tester' }],
    codes: [],
    sources: [
      { guid: '99999999-9999-9999-9999-999999999999', name: 'Survey', sourceType: 'survey', selections: [], formatData: { survey, rawCsv: '' } }
    ],
    sets: [],
    notes: []
  }
}

describe('REFI-QDA Project.xsd compliance', () => {
  it('serializes a comprehensive project that validates against Project.xsd', async () => {
    const xml = serializeProject(comprehensiveProject())
    const { valid, errors } = await validate(xml)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('serializes a survey project (Variables/Cases) that validates against Project.xsd', async () => {
    const xml = serializeProject(surveyProject())
    const { valid, errors } = await validate(xml)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('emits Set <MemberCode> before <MemberSource> (regression: SetType child order)', async () => {
    const xml = serializeProject(comprehensiveProject())
    const codeIdx = xml.indexOf('<MemberCode')
    const sourceIdx = xml.indexOf('<MemberSource')
    expect(codeIdx).toBeGreaterThan(-1)
    expect(sourceIdx).toBeGreaterThan(-1)
    // SetType sequence is Description?, MemberCode*, MemberSource*, MemberNote*.
    expect(codeIdx).toBeLessThan(sourceIdx)
  })

  it('rejects a Set whose members are in the wrong order (proves the validator catches it)', async () => {
    const wrongOrder = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<Project xmlns="urn:QDA-XML:project:1.0" name="T">
  <Sets>
    <Set guid="22222222-2222-2222-2222-222222222222" name="S">
      <MemberSource targetGUID="33333333-3333-3333-3333-333333333333"/>
      <MemberCode targetGUID="11111111-1111-1111-1111-111111111111"/>
    </Set>
  </Sets>
</Project>`
    const { valid } = await validate(wrongOrder)
    expect(valid).toBe(false)
  })

  it('round-trips a comprehensive project through serialize → deserialize', () => {
    const original = comprehensiveProject()
    const restored = deserializeProject(serializeProject(original))

    expect(restored.name).toBe(original.name)
    // Project <Description> (markdown, with special chars) round-trips.
    expect(restored.description).toBe(original.description)
    expect(restored.codes).toHaveLength(1)
    expect(restored.codes[0].children).toHaveLength(1)
    expect(restored.sources).toHaveLength(original.sources.length)

    const set = restored.sets[0]
    expect(set.memberCodeGuids).toHaveLength(2)
    expect(set.memberSourceGuids).toHaveLength(2)
  })
})
