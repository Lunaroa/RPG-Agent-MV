export type ProjectGitChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'
export type ProjectGitConflictChoice = 'local' | 'remote'

export interface ProjectGitChange {
  path: string
  kind: ProjectGitChangeKind
  size: number | null
}

export interface ProjectGitStatus {
  available: boolean
  enabled: boolean
  lfsReady: boolean
  branch: string | null
  changes: ProjectGitChange[]
  ahead: number
  behind: number
  remoteUrl: string | null
  merging: boolean
}

export interface ProjectGitCommit {
  hash: string
  message: string
  author: string
  time: string
}

export interface ProjectGitProjectRequest {
  project?: string
}

export interface ProjectGitCommitRequest extends ProjectGitProjectRequest {
  message?: string
}

export interface ProjectGitRemoteRequest extends ProjectGitProjectRequest {
  url?: string
}

export interface ProjectGitSyncRequest extends ProjectGitProjectRequest {
  token?: string
}

export interface ProjectGitPathRequest extends ProjectGitProjectRequest {
  path?: string
}

export interface ProjectGitResolveRequest extends ProjectGitPathRequest {
  choice?: ProjectGitConflictChoice
}

export interface ProjectGitDiffRequest extends ProjectGitPathRequest {}

export type ProjectGitDiffLineType = 'add' | 'del' | 'ctx' | 'hunk'

export interface ProjectGitDiffLine {
  type: ProjectGitDiffLineType
  text: string
}

export interface ProjectGitFileDiff {
  path: string
  kind: ProjectGitChangeKind
  binary: boolean
  tooLarge: boolean
  lines: ProjectGitDiffLine[]
}

export interface ProjectGitFileResult<T> {
  status: 'success' | 'idle' | 'error'
  message: string
  value?: T
  path?: string
}
