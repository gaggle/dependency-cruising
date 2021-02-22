import * as fs from 'fs-extra'
import { join, relative } from 'path'
import { first, groupBy } from 'lodash'

import { cruiseOptions, graph } from './cruise'
import { Job } from './types/job'
import { JSDOM } from 'jsdom'
import { ClusterModule, Module } from './types/modules'
import { spawn } from 'child_process'
import { streamToBuffer } from './utils/io'

export async function createJobs ({
  baseDir,
  exclude,
  include,
  modules,
  outputTo,
  root,
  ...opts
}: {
  baseDir: string,
  exclude?: string[]
  include?: string[],
  modules: Module[],
  outputTo: string,
  reportProgress?: (id: string, params: any) => void,
  root: string,
}): Promise<Job[]> {
  const reportProgress = opts.reportProgress || (() => {})
  const modulesBySource = groupBy(modules, 'source')

  const clusterPrefix = 'clusters/'
  const filePrefix = 'files/'

  async function renderModule (id: string, module: Module) {
    const otherClusters = calculateCollapsedClusters(module, Object.values(modules))
    const collapsePatten = otherClusters.map(module => module.source)
    collapsePatten.push('node_modules')
    const opts = cruiseOptions({
      baseDir,
      focus: [module.source],
      collapsePattern: collapsePatten.length ? `^(${collapsePatten.join('|')})` : undefined,
      highlight: module.kind === 'file' ? module.source : undefined,
      outputType: 'dot',
      // outputType: module.kind === 'file' ? 'dot' : 'archi',
      includeOnly: include,
      exclude
    })
    const output = await graph([root], opts)
    await reportProgress('ran-graph', {
      id,
      exitCode: output.exitCode,
      outputLength: output.output.length
    })

    const document = await graphvizToHtml(output.output, { baseDir })
    await reportProgress('ran-to-html', { id, childrenCount: document.children.length })

    const hrefElements = document.getElementsByTagName('a')
    await reportProgress('hrefs', { id, count: hrefElements.length })
    for (const anchorEl of Array.from(hrefElements) as Element[]) {
      const href = anchorEl.getAttribute('xlink:href') as string
      const anchorModule = first(modulesBySource[href])
      if (anchorModule) {
        const prefix = anchorModule.kind === 'file' ? filePrefix : clusterPrefix
        anchorEl.setAttribute('xlink:href', `/${prefix}${href}.html`)
      } else {
        anchorEl.removeAttribute('xlink:href')
      }
    }

    const clusterElements = document.getElementsByClassName('cluster')
    await reportProgress('clusters', { id, count: clusterElements.length })
    for (const clusterEl of Array.from(clusterElements) as Element[]) {
      const title = clusterEl.getElementsByTagName('title')[0].innerHTML
      const source = title.slice('cluster_'.length)
      const clusterModule = first(modulesBySource[source])
      if (clusterModule) {
        if (module.kind === 'cluster' && source === module.source) {
          const pathElement = clusterEl.getElementsByTagName('path')[0]
          pathElement.setAttribute('fill', 'rgb(218,112,214,0.25)')
          // ↑ Files can get highlighted directly from Dependency Cruiser, but not clusters.
          // So here we manually set the color on the cluster to mimic a highlight.
        }
        const clusterElParent = clusterEl.parentElement!
        const a = document.createElement('a')
        clusterElParent.replaceChild(a, clusterEl)
        a.appendChild(clusterEl)
        a.setAttribute('xlink:href', `/${clusterPrefix}${clusterModule.source}.html`)
        a.setAttribute('xlink:title', `cluster ${clusterModule.source}`)
      }
    }

    const outputPath = join(outputTo, module.output)
    await fs.outputFile(outputPath, document.documentElement.outerHTML)
  }

  const moduleJobs: Job[] = Object.values(modules)
    .filter(m => m.kind === 'cluster' || !m.matchesDoNotFollow)
    .map(module => {
      const id = `${module.kind}:${module.source}`
      return { id, fn: () => renderModule(id, module) }
    })
  const rootCluster: ClusterModule = modules.find(m => m.kind === 'cluster' && m.clusters.length === 0) as ClusterModule
  return moduleJobs.concat({
    id: 'index.html',
    fn: async (): Promise<void> => {
      const outputPath = join(outputTo, 'index.html')
      return fs.outputFile(outputPath, `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Redirecting...</title>
    <meta http-equiv="refresh" content="0; url='/${clusterPrefix}${rootCluster.source}'" />
  </head>
  <body>
    <p>Redirected to <a href="/${clusterPrefix}${rootCluster.source}">this link</a>.</p>
  </body>
</html>`)
    }
  })
}

function calculateCollapsedClusters (currentModule: Module, modules: Module[]): ClusterModule[] {
  const myClusterSources = [currentModule.source, ...currentModule.clusters.map(c => c.source)]
  const clusterSources = modules
    .filter(el => el.kind === 'cluster')
    .filter(el => !myClusterSources.includes(el.source))
  return clusterSources as ClusterModule[]
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
