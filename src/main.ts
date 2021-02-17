import * as fs from 'fs-extra'
import pMap from 'p-map'
import { join, relative, resolve } from 'path'
import { performance } from 'perf_hooks'
import { withDir } from 'tmp-promise'

import { Bus, defaultBus } from './bus'
import { createJobs, parseDependencyCruiserModules } from './cruiseParser'
import { Job } from './types'
import { scan } from './cruise'

interface MainOpts {
  bus: Bus;
  concurrency: number;
  include?: string[];
  exclude?: string[];
}

export function main (outputTo: string, roots: string[], opts: Partial<MainOpts> = {}): Promise<void> {
  const resolvedOpts: MainOpts = {
    bus: defaultBus(),
    concurrency: 1,
    ...opts
  }
  return main_(outputTo, roots, resolvedOpts)
}

export async function main_ (outputTo: string, roots: string[], { bus, concurrency, include, exclude }: MainOpts) {
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
      concurrency,
      cwd: process.cwd(),
      outputTo,
      relativeRoots,
      roots,
      tmpDir: tmp.path,
      include,
      exclude
    })

    const scanReport = await scan(baseDir, relativeRoots, { include, exclude })
    await bus.emit('app.scan.done', {
      exitCode: scanReport.exitCode,
      modules: scanReport.output.modules
    })

    const modules = parseDependencyCruiserModules(scanReport.output.modules)
    await bus.emit('app.parse.done', { modules })

    const jobs = await createJobs(modules, tmp.path, baseDir, relativeRoots, { bus, include, exclude })
    await bus.emit('app.jobs.created', { jobs })
    await jobRunner(jobs, concurrency)
    await bus.emit('app.jobs.done')

    await fs.emptyDir(outputTo)
    await fs.copy(tmp.path, outputTo)
    // ↑ Since the report got generated fine it's time to pour tmp into the desired output directory

    const end = performance.now()
    await bus.emit('app.end', { doneInMs: end - start })
  }, { unsafeCleanup: true })
}

async function jobRunner (jobs: Job[], concurrency: number) {
  await pMap<Job, void>(jobs, job => job.fn(), { concurrency: concurrency })
}
