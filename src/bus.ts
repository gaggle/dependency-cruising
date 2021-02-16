import Emittery from 'emittery'
import { IModule } from 'dependency-cruiser'

import { consoleReporter, Reporter } from './reporters'
import { Module } from './cruiseParser'
import { Job } from './types'

type jobDefaults = {
  id: string
}

export type BusEventData = {
  'app.end': { doneInMs: number },
  'app.jobs.created': { jobs: Job[] },
  'app.jobs.done': undefined,
  'app.parse.done': { modules: Module[] },
  'app.scan.done': { exitCode: number, modules: IModule[] },
  'app.started': {
    baseDir: string,
    concurrency: number,
    cwd: string,
    outputTo: string,
    relativeRoots: string[],
    roots: string[],
    tmpDir: string,
  };
  'job.done': jobDefaults & { kind: string },
  'job.progress.clusters': jobDefaults & { count: number },
  'job.progress.hrefs': jobDefaults & { count: number },
  'job.progress.ran-graph': jobDefaults & { outputLength: number, exitCode: number },
  'job.progress.ran-to-html': jobDefaults & { childrenCount: number },
  'job.start': jobDefaults & { source: string, kind: string },
}

export type Bus = Emittery<BusEventData, BusEventData>

export function newBus (reporter?: Reporter): Bus {
  const bus = new Emittery<BusEventData>()
  if (reporter) {
    bus.onAny(reporter)
  }
  return bus
}

export function defaultBus (): Bus {
  return newBus(consoleReporter)
}
