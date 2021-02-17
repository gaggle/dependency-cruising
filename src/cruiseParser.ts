import * as fs from 'fs-extra'
import { dirname, join, relative } from 'path'
import { IModule } from 'dependency-cruiser'
import { isEqual, uniqWith } from 'lodash'

import { Bus } from './bus'
import { cruiseOptions, graph } from './cruise'
import { Job } from './types'
import { JSDOM } from 'jsdom'
import { spawn } from 'child_process'
import { streamToBuffer } from './utils/io'

export interface ClusterModule {
  kind: 'cluster'
  source: string
  matchesDoNotFollow?: boolean
}

export type FileModule = IModule & {
  kind: 'file'
  cluster: ClusterModule,
}

export type Module = ClusterModule | FileModule

export function parseDependencyCruiserModules (cruiserModules: IModule[]): Module[] {
  function add<T extends Module> (collection: { [key: string]: T }, el: T): void {
    switch (true) {
      case (collection[el.source] === undefined):
        collection[el.source] = el
        break
      case (isEqual(collection[el.source], el)):
        break
      default:
        throw new Error(`error adding element\ncollection:${JSON.stringify(collection[el.source])}\nelement: ${JSON.stringify(el)}`)
    }
  }

  function create<T extends Module> (collection: { [key: string]: T }, el: T): T {
    switch (true) {
      case (collection[el.source] === undefined):
        collection[el.source] = el
        return el
      case (isEqual(collection[el.source], el)):
        return collection[el.source]
      default:
        throw new Error(`error creating element\ncollection:${collection[el.source]}\nelement: ${el}`)
    }
  }

  const clusters: { [key: string]: ClusterModule } = {}
  const files: { [key: string]: FileModule } = {}
  for (const cruiserModule of cruiserModules) {
    if (!cruiserModule.source.includes('/')) continue
    // ↑ Only stdlib entries have no slashes

    const parentSource = dirname(cruiserModule.source)
    const parentCluster = create(clusters, {
      kind: 'cluster',
      source: parentSource,
      matchesDoNotFollow: cruiserModule.matchesDoNotFollow
    })

    const splitted = parentSource.split('/')
    for (const [idx] of splitted.entries()) {
      const sourceChunk = splitted.slice(0, idx + 1).join('/')
      add(clusters, {
        kind: 'cluster',
        source: sourceChunk,
        matchesDoNotFollow: cruiserModule.matchesDoNotFollow
      })
    }

    add(files, {
      ...cruiserModule,
      kind: 'file',
      cluster: parentCluster
    })
  }
  return [...(Object.values(clusters)), ...(Object.values(files))]
}

export async function createJobs (modules: Module[], outputTo: string, baseDir: string, roots: string[], {
  bus,
  include,
  exclude
}: { bus: Bus, include?: string[], exclude?: string[] }): Promise<Job[]> {
  const allClusterSources = getClusterSources(modules)

  async function unifiedRender (id: string, el: Module) {
    await bus.emit('job.start', { id, source: el.source, kind: el.kind })

    const otherClusterSources = getClusterSources(modules, { except: el.kind === 'cluster' ? el.source : el.cluster.source })

    const output = await graph(roots, cruiseOptions({
      baseDir,
      focus: [el.source],
      collapsePattern: otherClusterSources.length ? `^(${otherClusterSources.join('|')})` : undefined,
      highlight: el.kind === 'file' ? el.source : undefined,
      outputType: el.kind === 'file' ? 'dot' : 'archi',
      includeOnly: include,
      exclude
    }))
    await bus.emit('job.progress.ran-graph', {
      id,
      exitCode: output.exitCode,
      outputLength: output.output.length
    })

    const document = await graphvizToHtml(output.output, { baseDir })
    await bus.emit('job.progress.ran-to-html', { id, childrenCount: document.children.length })

    const hrefElements = document.getElementsByTagName('a')
    await bus.emit('job.progress.hrefs', { id, count: hrefElements.length })
    for (const el of Array.from(hrefElements) as Element[]) {
      const href = el.getAttribute('xlink:href') as string
      const prefix = allClusterSources.includes(href) ? 'clusters/' : 'files/'
      el.setAttribute('xlink:href', `/${prefix || ''}${href}.html`)
    }

    const clusterElements = document.getElementsByClassName('cluster')
    await bus.emit('job.progress.clusters', { id, count: clusterElements.length })
    for (const element of Array.from(clusterElements) as Element[]) {
      const rawTextContent = element.getElementsByTagName('title')[0].innerHTML
      const textContent = rawTextContent.slice('cluster_'.length)
      if (el.kind === 'cluster' && textContent === el.source) {
        const pElement = element.getElementsByTagName('path')[0]
        pElement.setAttribute('fill', 'rgb(218,112,214,0.25)')
      }
      const parent = element.parentElement!
      const a = document.createElement('a')
      parent.replaceChild(a, element)
      a.appendChild(element)
      a.setAttribute('xlink:href', `/clusters/${textContent}.html`)
      a.setAttribute('xlink:title', `/clusters/${textContent}.html`)
    }

    const outputPath = join(outputTo, el.kind === 'file' ? 'files' : 'clusters', `${el.source}.html`)
    await fs.outputFile(outputPath, document.documentElement.outerHTML)
    await bus.emit('job.done', { id, kind: el.kind })
  }

  return modules.filter(m => !m.matchesDoNotFollow).map(module => {
    const id = `${module.kind}:${module.source}`
    return {
      id,
      source: module.source,
      fn: () => unifiedRender(id, module)
    }
  })
}

function getClusterSources (modules: Module[], { except }: Partial<{ except: string }> = {}) {
  const clusterSources = modules.filter(el => el.kind === 'cluster').map(el => el.source)
  if (except === undefined) return clusterSources

  const exceptComponents = except.split('/')
  const removedNonshared = clusterSources.filter(el => {
    const parts = el.split('/')
    if (parts.length === 1) return true
    return exceptComponents[0] === parts[0]
  })
  let noneOfThese: string[] = []
  for (const [i] of removedNonshared.entries()) {
    noneOfThese.push(exceptComponents.slice(0, i + 1).join('/'))
  }
  noneOfThese = uniqWith(noneOfThese, isEqual)
  return removedNonshared.filter(el => !noneOfThese.includes(el))
}

async function graphvizToHtml (cruiseOutput: string, { baseDir }: Partial<{ baseDir: string }> = {}): Promise<Document> {
  // depcruise | dot
  const dot = spawn('dot', ['-T', 'svg'], { cwd: baseDir, shell: true })
  dot.stdin.write(cruiseOutput)
  dot.stdin.end()

  // dot | html
  const dotBinFolder = relative(baseDir || process.cwd(), join(__dirname, '..', 'node_modules', '.bin'))
  const html = spawn(join(dotBinFolder, 'depcruise-wrap-stream-in-html'), { cwd: baseDir, shell: true })
  dot.stdout.pipe(html.stdin)

  // html -> dom
  const dom = new JSDOM(await streamToBuffer(html.stdout))
  return dom.window.document
}
