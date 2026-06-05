import { create } from 'zustand'
import type { User, SavedAnalysis } from '../models/types'
import { generateGuid } from '../utils/guid'
import { makeHmrSafe } from './hmr-preserve'

/** Strip directory and .qdpx extension from a file path. */
function deriveNameFromPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath
  return base.replace(/\.qdpx$/i, '')
}

interface ProjectState {
  name: string
  origin: string
  users: User[]
  creatingUserGUID?: string
  creationDateTime?: string
  modifyingUserGUID?: string
  modifiedDateTime?: string
  filePath: string | null
  isDirty: boolean
  savedAnalyses?: SavedAnalysis[]

  createNewProject: () => void
  loadProject: (data: {
    name: string
    origin: string
    users: User[]
    creatingUserGUID?: string
    creationDateTime?: string
    modifyingUserGUID?: string
    modifiedDateTime?: string
    filePath?: string
    savedAnalyses?: SavedAnalysis[]
  }) => void
  setFilePath: (path: string) => void
  markDirty: () => void
  markClean: () => void
  setName: (name: string) => void
  setSavedAnalyses: (analyses: SavedAnalysis[]) => void
}

const defaultUserGuid = generateGuid()

export const useProjectStore = create<ProjectState>((set) => ({
  name: 'Untitled Project',
  origin: `Magnolia ${__APP_VERSION__}`,
  users: [{ guid: defaultUserGuid, name: 'User' }],
  creatingUserGUID: defaultUserGuid,
  creationDateTime: new Date().toISOString(),
  filePath: null,
  isDirty: false,
  savedAnalyses: [],

  createNewProject: () => {
    const userGuid = generateGuid()
    set({
      name: 'Untitled Project',
      origin: `Magnolia ${__APP_VERSION__}`,
      users: [{ guid: userGuid, name: 'User' }],
      creatingUserGUID: userGuid,
      creationDateTime: new Date().toISOString(),
      modifyingUserGUID: undefined,
      modifiedDateTime: undefined,
      filePath: null,
      isDirty: false,
      savedAnalyses: []
    })
  },

  loadProject: (data) =>
    set({
      name: data.name && data.name.trim() ? data.name : (data.filePath ? deriveNameFromPath(data.filePath) : 'Untitled Project'),
      origin: data.origin,
      users: data.users,
      creatingUserGUID: data.creatingUserGUID,
      creationDateTime: data.creationDateTime,
      modifyingUserGUID: data.modifyingUserGUID,
      modifiedDateTime: data.modifiedDateTime,
      filePath: data.filePath ?? null,
      isDirty: false,
      savedAnalyses: data.savedAnalyses ?? []
    }),

  setFilePath: (path) =>
    set((state) => ({
      filePath: path,
      name: !state.name || state.name === 'Untitled Project' ? deriveNameFromPath(path) : state.name
    })),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),
  setName: (name) => set({ name, isDirty: true }),
  setSavedAnalyses: (analyses) => set({ savedAnalyses: analyses, isDirty: true })
}))

makeHmrSafe('projectStore', useProjectStore)
