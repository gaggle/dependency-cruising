import * as fs from 'fs-extra'
import tree from 'tree-cli'
import { basename, dirname, join, relative, resolve } from 'path'
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
    console.log((await tree({ base: tmp.path, l: Number.MAX_VALUE })).report)
    await fs.emptyDir(outputTo)
    await fs.copy(tmp.path, outputTo)
  }, { unsafeCleanup: true })
}

async function createGraphs (outputTo: string, baseDir: string, roots: string[]): Promise<void> {
  const scanReport = await runCruise(roots, cruiseOptions({ baseDir }))
  if (typeof scanReport.output === 'string') throw new Error('scan error')
  console.log('scanReport', {
    baseDir,
    cwd: process.cwd(),
    outputTo,
    roots,
    scan: {
      modulesLength: scanReport.output.modules.length,
      exitCode: scanReport.exitCode
    }
  })

  const indexReport = await runCruise(roots, cruiseOptions({
    baseDir,
    collapsePattern: `(node_modules|(${roots.join('|')})/[^/]+)`,
    outputType: 'archi'
  }))
  const prefix = 'files/'
  const html = await graphvizToHtml(indexReport.output.toString(), {
    baseDir,
    prefix: prefix
  })
  const outputPath = join(outputTo, 'index.html')
  await fs.outputFile(outputPath, html)

  // async function fileCruise (path: string) {
  //   console.log('processing file', { path })
  //   const fileReport = await runCruise(roots, cruiseOptions({
  //     baseDir,
  //     collapsePattern: 'node_modules/[^/]+',
  //     focus: [basename(path)],
  //     highlight: path.includes('node_modules/') ? dirname(path) : path,
  //     outputType: 'dot'
  //   }))
  //   const html = await graphvizToHtml(fileReport.output.toString(), {
  //     baseDir,
  //     prefix:
  //       prefix
  //   })
  //   const outputPath = join(outputTo, 'files', `${path}.html`)
  //   await fs.outputFile(outputPath, html)
  // }
  //
  // const files = new Set<string>(scanReport.output.modules.map(m => m.source))
  // console.log(`files to process: ${files.size}`)
  // await Promise.all(Array.from(files).slice(0, 10).map(fileCruise))
}

async function graphvizToHtml (cruiseOutput: string, {
  baseDir,
  prefix
}: Partial<{ baseDir: string, prefix: string }> = {}): Promise<string> {
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
  const hrefs = dom.window.document.getElementsByTagName('a')
  console.log(`rewriting ${hrefs.length} hrefs`)
  for (const el of Array.from(hrefs) as any[]) {
    const href = el.getAttribute('xlink:href')
    el.setAttribute('xlink:href', `/${prefix || ''}${href}.html`)
  }

  return dom.window.document.documentElement.outerHTML
}

async function asyncIterToArray (iterator: AsyncIterable<any>): Promise<any[]> {
  const elements: any[] = []
  for await (const el of iterator) {
    elements.push(el)
  }
  return elements
}
