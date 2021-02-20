import { IModule } from 'dependency-cruiser'
import { ClusterModule, Module } from './types/modules'
import { Referencer } from './utils/referencer'
import { dirname, join } from 'path'

export function cruiseParser (cruiserModules: IModule[]): Module[] {
  const r = new Referencer<Module>()

  for (const cruiserModule of cruiserModules) {
    if (cruiserModule.matchesDoNotFollow ||
      // ↑ If we shouldn't follow it there's nothing to create a module for
      cruiserModule.couldNotResolve ||
      // ↑ If we can't resolve it there's nothing to create a module for
      !cruiserModule.source.includes('/')) {
      // ↑ Only stdlib entries have no slashes and we can only create modules for real files
      continue
    }

    const clusterSource = dirname(cruiserModule.source)
    const split = clusterSource.split('/')
    const clusters: ClusterModule[] = []
    for (const [idx] of split.entries()) {
      const sourceChunk = split.slice(0, idx + 1).join('/')

      const clusterId = `cluster:${sourceChunk}`
      clusters.push(r.create(clusterId, {
        kind: 'cluster',
        id: clusterId,
        clusters: [...clusters],
        output: join('clusters', `${sourceChunk}.html`),
        source: sourceChunk
      }))
    }

    const fileId = `file:${cruiserModule.source}`
    r.create(fileId, {
      kind: 'file',
      id: fileId,
      clusters,
      dependencies: cruiserModule.dependencies,
      matchesDoNotFollow: cruiserModule.matchesDoNotFollow,
      output: join('files', `${cruiserModule.source}.html`),
      source: cruiserModule.source
    })
  }

  return Object.values(r.get())
}
