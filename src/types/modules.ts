/* eslint-disable no-use-before-define */

import { IDependency } from 'dependency-cruiser'

interface BaseModule {
  /** Unique Id */
  id: string
  clusters: ClusterModule[],
  output: string
  source: string
}

export type ClusterModule = BaseModule & {
  kind: 'cluster'
}

export type FileModule = BaseModule & {
  kind: 'file'
  dependencies: IDependency[],
  matchesDoNotFollow?: boolean
}

export type Module = ClusterModule | FileModule
