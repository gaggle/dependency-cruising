import Emittery from 'emittery'
import { Job } from './job'
import { IModule } from 'dependency-cruiser'
import { Module } from './modules'

type jobDefaults = {
  id: string
}

export type BusEventData = {
  'app.end': { doneInMs: number }
  'app.jobs.created': { jobs: Job[] }
  'app.jobs.done': undefined,
  'app.parse.done': { modules: Module[] }
  'app.scan.done': { exitCode: number, modules: IModule[] }
  'app.started': {
    baseDir: string
    concurrency: number
    cwd: string
    exclude?: string[]
    include?: string[]
    outputTo: string
    relativeRoots: string[]
    roots: string[]
    tmpDir: string
  };
  'job.done': jobDefaults
  'job.progress': undefined
  'job.start': jobDefaults
}
export type Bus = Emittery<BusEventData, BusEventData>
