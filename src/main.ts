import * as fs from 'fs-extra'
import pMap from 'p-map'
import { join, relative, resolve } from 'path'
import { performance } from 'perf_hooks'
import { withDir } from 'tmp-promise'

import { Bus } from './types/bus'
import { createJobs } from './jobCreator'
import { defaultBus } from './bus'
import { Job } from './types/job'
import { scan } from './cruise'
import { cruiseParser } from './cruiseParser'

interface MainOpts {
  bus: Bus;
  concurrency: number;
  include?: string[];
  exclude?: string[];
}

export function main (outputTo: string, root: string, opts: Partial<MainOpts> = {}): Promise<void> {
  const resolvedOpts: MainOpts = {
    bus: defaultBus(),
    concurrency: 1,
    ...opts
  }
  return main_(outputTo, root, resolvedOpts)
}

export async function main_ (outputTo: string, root: string, { bus, concurrency, include, exclude }: MainOpts) {
  const start = performance.now()
  const baseDir = resolve(join(root, '..'))
  // ↑ For now lets assume the first root is the directory from which we should do our scanning.
  // There is support here for multiple roots and the basedir assumption will fall together
  // when the first root is not a shared base for the rest.
  // But it's a bit of an obscure use of the tool, so, right now let's just live with this simplification
  // until the limitations crystallize.

  await withDir(async tmp => {
    await fs.emptyDir(tmp.path)
    // ↑ Output everything into this folder and only flip it to the real `outputTo` on success,
    // to avoid partial overwrites of user's files.

    let relativeRoot = relative(baseDir, root)
    if (relativeRoot === '') relativeRoot = '.'
    // ↑ Turn the root into paths relative to baseDir, because our report will be centered on baseDir

    await bus.emit('app.started', {
      baseDir,
      concurrency,
      cwd: process.cwd(),
      exclude,
      include,
      outputTo,
      relativeRoot,
      root,
      tmpDir: tmp.path
    })

    const scanReport = await scan(baseDir, [relativeRoot], { include, exclude })
    await bus.emit('app.scan.done', {
      exitCode: scanReport.exitCode,
      modules: scanReport.output.modules
    })

    const modules = cruiseParser(scanReport.output.modules)
    const rootModule = modules.filter(m => m.source === relativeRoot)[0]
    if (!rootModule) throw new Error('Error identifying root module')
    await bus.emit('app.parse.done', { modules, rootModule })

    const jobs = await createJobs({
      baseDir: baseDir,
      exclude,
      include,
      modules,
      outputTo: tmp.path,
      reportProgress: (id: string, params: any) => bus.emit('job.progress', { ...params, id }),
      root: relativeRoot
    })
    await bus.emit('app.jobs.created', { jobs })

    await jobRunner(jobs, { bus, concurrency })
    await bus.emit('app.jobs.done')

    await fs.emptyDir(outputTo)
    await fs.copy(tmp.path, outputTo)
    // ↑ Since the report got generated fine it's time to pour tmp into the desired output directory

    const end = performance.now()
    await bus.emit('app.end', { doneInMs: end - start })
  }, { unsafeCleanup: true })
}

async function jobRunner (jobs: Job[], { bus, concurrency }: { bus: Bus, concurrency: number }) {
  await pMap<Job, void>(jobs, async job => {
    await bus.emit('job.start', { id: job.id })
    const result = await job.fn()
    await bus.emit('job.done', { id: job.id })
    return result
  }, { concurrency: concurrency })
}
