import * as fs from 'fs-extra'
import pMap from 'p-map'
import { join, relative, resolve } from 'path'
import { performance } from 'perf_hooks'
import { withDir } from 'tmp-promise'

import { Bus, defaultBus } from './bus'
import { scan } from './cruise'
import { createJobs, parseDependencyCruiserModules } from './cruiseParser'
import { Job } from './types'

export function main (outputTo: string, roots: string[], { bus }: Partial<{ bus: Bus }> = {}): Promise<void> {
  return main_(outputTo, roots, { bus: bus || defaultBus() })
}

async function jobRunner (jobs: Job[]) {
  await pMap<Job, void>(jobs, job => job.fn(), { concurrency: 4 })
}

export async function main_ (outputTo: string, roots: string[], { bus }: { bus: Bus }) {
  const start = performance.now()
  const baseDir = resolve(join(roots[0], '..'))
  // ↑ For now lets assume the first root is the directory from which we should do our scanning.
  // There is support here for multiple roots and the basedir assumption will fall together
  // when the first root is not a shared base for the rest.
  // But it's a bit of an obscure use of the tool, so, right now let's just live with this simplification
  // until the limitations crystallize.

  await withDir(async tmp => {
    await fs.emptyDir(tmp.path)
    // ↑ Output everything into this folder and only flip it to the real `outputTo` on success,
    // to avoid partial overwrites of user's files.

    const relativeRoots = roots.map(el => {
      const r = relative(baseDir, el)
      return r === '' ? '.' : r
    })
    // ↑ Turn all the roots into paths relative to baseDir, because our report will be centered on baseDir

    await bus.emit('app.started', {
      baseDir,
      cwd: process.cwd(),
      outputTo,
      relativeRoots,
      roots,
      tmpDir: tmp.path
    })

    const scanReport = await scan(baseDir, relativeRoots)
    await bus.emit('app.scan.done', {
      modulesCount: scanReport.output.modules.length,
      exitCode: scanReport.exitCode
    })

    const modules = parseDependencyCruiserModules(scanReport.output.modules)
    const jobs = await createJobs(modules, tmp.path, baseDir, relativeRoots, { bus })
    await jobRunner(jobs)
    await bus.emit('app.jobs.done')

    await fs.emptyDir(outputTo)
    await fs.copy(tmp.path, outputTo)
    // ↑ Since the report got generated fine it's time to pour tmp into the desired output directory

    const end = performance.now()
    await bus.emit('app.end', { doneInMs: end - start })
  }, { unsafeCleanup: true })
}
