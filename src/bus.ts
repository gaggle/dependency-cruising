import Emittery from 'emittery'
import { consoleReporter, Reporter } from './reporters'

type jobDefaults = {
  id: string
}

export type BusEventData = {
  'app.end': { doneInMs: number },
  'app.jobs.done': undefined,
  'app.scan.done': { exitCode: number, modulesCount: number },
  'app.started': {
    baseDir: string,
    cwd: string,
    outputTo:string,
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
