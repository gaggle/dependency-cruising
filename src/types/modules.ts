interface BaseModule {
  id: string
  matchesDoNotFollow?: boolean
  output: string
  source: string
}

export type ClusterModule = BaseModule & {
  kind: 'cluster'
}

export type FileModule = BaseModule & {
  kind: 'file'
  cluster: ClusterModule,
}

export type Module = ClusterModule | FileModule
