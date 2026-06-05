/**
 * Live equivalents of the snapshot fields on AnalysisInitData that are
 * vulnerable to staleness. Originally each analysis tool consumed a
 * frozen snapshot built by buildAnalysisInitData() at the moment the
 * tool was opened — fine for popped-out windows (now retired), but
 * inside an inline tab it meant codes / tags / categories / folders
 * created or renamed *after* the tool opened were missing or wrong.
 *
 * Pop-outs are gone, so every analysis tool runs in the main renderer
 * where the zustand stores already live. This hook subscribes the tool
 * to those stores and reshapes them into the same flat structures the
 * snapshot used, so all downstream code (group-by builder, code maps,
 * tag chips) keeps working unchanged.
 *
 * Fields we DON'T make live yet: sources, sourceContents,
 * sourceSelections — they're large and the staleness-sensitive Group
 * By + code-drop bugs don't depend on them.
 */
import { useMemo } from 'react'
import type { AnalysisInitData, Code } from '../../models/types'
import { useCodeStore } from '../../stores/code-store'
import { useTagStore } from '../../stores/tag-store'
import { useDocumentStore } from '../../stores/document-store'

function flattenCodesWithParent(
  codes: Code[],
  parentGuid?: string
): { guid: string; name: string; color?: string; isCodable: boolean; parentGuid?: string }[] {
  const result: { guid: string; name: string; color?: string; isCodable: boolean; parentGuid?: string }[] = []
  for (const c of codes) {
    result.push({ guid: c.guid, name: c.name, color: c.color, isCodable: c.isCodable, parentGuid })
    result.push(...flattenCodesWithParent(c.children, c.guid))
  }
  return result
}

export type LiveAnalysisData = Pick<
  AnalysisInitData,
  'codes' | 'tags' | 'categories' | 'folders' | 'tagMembers' | 'sourceFolder'
  | 'respondentTagMembers' | 'questionTagMembers'
>

export function useLiveAnalysisData(): LiveAnalysisData {
  const codesTree = useCodeStore((s) => s.codes)
  const tags = useTagStore((s) => s.tags)
  const categories = useTagStore((s) => s.categories)
  const docFolders = useDocumentStore((s) => s.folders)
  const sourceFolder = useDocumentStore((s) => s.sourceFolder)

  const codes = useMemo(() => flattenCodesWithParent(codesTree), [codesTree])
  const folders = useMemo(
    () => docFolders.map((f) => ({ guid: f.guid, name: f.name, parentGuid: f.parentGuid ?? null })),
    [docFolders]
  )
  const tagMembers = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const t of tags) m[t.guid] = t.memberSourceGuids
    return m
  }, [tags])
  const respondentTagMembers = useMemo(() => {
    const m: Record<string, import('../../models/types').SurveyEntityRef[]> = {}
    for (const t of tags) if (t.memberSurveyRespondents?.length) m[t.guid] = t.memberSurveyRespondents
    return m
  }, [tags])
  const questionTagMembers = useMemo(() => {
    const m: Record<string, import('../../models/types').SurveyEntityRef[]> = {}
    for (const t of tags) if (t.memberSurveyQuestions?.length) m[t.guid] = t.memberSurveyQuestions
    return m
  }, [tags])
  const slimTags = useMemo(
    () => tags.map((t) => ({ guid: t.guid, name: t.name, categoryGuid: t.categoryGuid, value: t.value })),
    [tags]
  )
  const slimCategories = useMemo(
    () => categories.map((c) => ({ guid: c.guid, name: c.name, type: c.type, listOptions: c.listOptions })),
    [categories]
  )

  return { codes, tags: slimTags, categories: slimCategories, folders, tagMembers, respondentTagMembers, questionTagMembers, sourceFolder }
}
