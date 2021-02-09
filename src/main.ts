import * as fs from 'fs-extra'
import tree from 'tree-cli'
import { dirname, join, relative, resolve } from 'path'
import { isEqual, uniqWith } from 'lodash'
import { JSDOM } from 'jsdom'
import { spawn } from 'child_process'
import { withDir } from 'tmp-promise'

import { cruiseOptions, runCruise } from './cruise'
import { streamToBuffer } from './utils/io'

export async function main (outputTo: string, fileDirectoryArray: string[]): Promise<void> {
  const baseDir = resolve(join(fileDirectoryArray[0], '..'))
  await withDir(async tmp => {
    await fs.emptyDir(tmp.path)
    await createGraphs(tmp.path, baseDir, fileDirectoryArray.map(el => {
      const r = relative(baseDir, el)
      return r === '' ? '.' : r
    }))
    console.log('tmp', (await tree({ base: tmp.path, l: Number.MAX_VALUE })).report)
    await fs.emptyDir(outputTo)
    await fs.copy(tmp.path, outputTo)
  }, { unsafeCleanup: true })
}

async function createGraphs (outputTo: string, baseDir: string, roots: string[]): Promise<void> {
  const scanReport = await runCruise(roots, cruiseOptions({ baseDir }))
  if (typeof scanReport.output === 'string') throw new Error('scan error')
  const scannedModules = scanReport.output.modules
  console.log('scanReport', JSON.stringify({
    baseDir,
    cwd: process.cwd(),
    outputTo,
    roots,
    scan: {
      exitCode: scanReport.exitCode,
      modules: scannedModules.map(el => ({
        source: el.source, dependenciesLength: el.dependencies.length
      })),
      modulesLength: scannedModules.length
    }
  }, null, 2))

  function getData () {
    const data: any[] = []
    for (const m of scannedModules) {
      let parentCluster: any
      if (m.source.includes('/')) {
        parentCluster = {
          type: 'cluster',
          source: dirname(m.source)
        }

        const paths = dirname(m.source).split('/')
        for (const [i] of paths.entries()) {
          const p = paths.slice(0, i + 1).join('/')
          const cluster = {
            type: 'cluster',
            source: p
          }
          data.push(cluster)
        }
      } else {
        // stdlib entry
      }

      data.push({
        type: 'file',
        source: m.source,
        cluster: parentCluster,
        dependencies: m.dependencies
      })
    }
    return uniqWith(data, isEqual)
  }

  const data = getData()
  console.log('got data', data.length)

  function getClusterSources ({ except }: Partial<{ except: string }> = {}) {
    const clusterSources = data.filter(el => el.type === 'cluster').map(el => el.source)
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

  const allClusterSources = getClusterSources()

  async function renderCluster (clusterModule: { source: string }) {
    const otherClusterSources = getClusterSources({ except: clusterModule.source })
    const indexReport = await runCruise(roots, cruiseOptions({
      baseDir,
      focus: [clusterModule.source],
      // collapsePattern: '^(node_modules|packages|src|lib|app|test|spec)/[^/]+', // <- default pattern
      collapsePattern: `^(${otherClusterSources.join('|')})`,
      outputType: 'archi'
    }))
    const document = await graphvizToHtml(indexReport.output.toString(), { baseDir })

    const hrefElements = document.getElementsByTagName('a')
    for (const el of Array.from(hrefElements) as HTMLAnchorElement[]) {
      const href = el.getAttribute('xlink:href')
      const prefix = allClusterSources.includes(href) ? 'clusters/' : 'files/'
      el.setAttribute('xlink:href', `/${prefix || ''}${href}.html`)
    }

    const clusterElements = document.getElementsByClassName('cluster')
    for (const el of Array.from(clusterElements) as Element[]) {
      const rawTextContent = el.getElementsByTagName('title')[0].innerHTML
      const textContent = rawTextContent.slice('cluster_'.length)
      if (textContent === clusterModule.source) {
        const pElement = el.getElementsByTagName('path')[0]
        pElement.setAttribute('fill', 'rgb(218,112,214,0.25)')
      }
      const parent = el.parentElement!
      const a = document.createElement('a')
      parent.replaceChild(a, el)
      a.appendChild(el)
      a.setAttribute('xlink:href', `/clusters/${textContent}.html`)
      a.setAttribute('xlink:title', `/clusters/${textContent}.html`)
    }

    const outputPath = join(outputTo, 'clusters', `${clusterModule.source}.html`)
    await fs.outputFile(outputPath, document.documentElement.outerHTML)
    process.stdout.write('o')
  }

  async function renderFile (el: { source: string, cluster: { source: string } }) {
    const otherClusterSources = getClusterSources({ except: el.cluster.source })
    const indexReport = await runCruise(roots, cruiseOptions({
      baseDir,
      collapsePattern: `^(${otherClusterSources.join('|')})`,
      focus: [el.source],
      highlight: el.source,
      outputType: 'dot'
    }))
    const document = await graphvizToHtml(indexReport.output.toString(), { baseDir })

    const hrefs = document.getElementsByTagName('a')
    for (const el of Array.from(hrefs) as any[]) {
      const href = el.getAttribute('xlink:href')
      const prefix = allClusterSources.includes(href) ? 'clusters/' : 'files/'
      el.setAttribute('xlink:href', `/${prefix || ''}${href}.html`)
    }

    const clusterElements = document.getElementsByClassName('cluster')
    for (const el of Array.from(clusterElements) as Element[]) {
      const rawTextContent = el.getElementsByTagName('title')[0].innerHTML
      const textContent = rawTextContent.slice('cluster_'.length)
      const parent = el.parentElement!
      const a = document.createElement('a')
      parent.replaceChild(a, el)
      a.appendChild(el)
      a.setAttribute('xlink:href', `/clusters/${textContent}.html`)
      a.setAttribute('xlink:title', `/clusters/${textContent}.html`)
    }

    const outputPath = join(outputTo, 'files', `${el.source}.html`)
    await fs.outputFile(outputPath, document.documentElement.outerHTML)
    process.stdout.write('x')
  }

  await Promise.all(data.map(el => {
    process.stdout.write('.')
    switch (el.type) {
      case 'cluster':
        return renderCluster(el)
      case 'file':
        return renderFile(el)
    }
    return undefined
  }))
  console.log('done')
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
