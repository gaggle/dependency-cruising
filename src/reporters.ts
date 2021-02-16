/* eslint-disable no-case-declarations */
import cliProgress, { SingleBar } from 'cli-progress'
import tree from 'tree-cli'
import { mapValues } from 'lodash'

import { BusEventData } from './bus'

export type Reporter = (eventName: keyof BusEventData, eventData: BusEventData[keyof BusEventData]) => void

export const consoleReporter: Reporter = (eventName, eventData) => {
  console.log(eventName, eventData)
}

type TrackedJob =
  | { state: 'pending' }
  | { state: 'started', startedAt: number }
  | { state: 'done', startedAt: number, completedAt: number }
  | { state: 'unknown', startedAt?: number, completedAt?: number }

class JobTracker {
  private readonly trackedJobs: {
    [key: string]: TrackedJob
  }

  constructor () {
    this.trackedJobs = {}
  }

  addPending (id: string): void {
    const existingJob = this.getJob(id)
    if (existingJob) {
      console.warn(`Duplicate job '${id}' already exists: ${existingJob}`)
      return
    }
    this.setJob(id, { state: 'pending' })
  }

  setStarted (id: string): void {
    const existingJob = this.getJob(id)
    if (!existingJob) {
      console.warn(`Untracked job '${id}' marked as started`)
      this.setJob(id, { state: 'unknown', startedAt: Date.now() })
    } else if (existingJob.state !== 'pending') {
      console.warn(`Non-pending job '${id}' marked as started: ${existingJob}`)
      this.setJob(id, { ...existingJob, state: 'unknown', startedAt: Date.now() })
    } else {
      this.setJob(id, { ...existingJob, state: 'started', startedAt: Date.now() })
    }
  }

  setDone (id: string): void {
    const existingJob = this.getJob(id)
    if (!existingJob) {
      console.warn(`Untracked job '${id}' marked as done`)
      this.setJob(id, { state: 'unknown', completedAt: Date.now() })
    } else if (existingJob.state !== 'started') {
      console.warn(`Non-started job '${id}' marked as done: ${existingJob}`)
      this.setJob(id, { ...existingJob, state: 'unknown', completedAt: Date.now() })
    } else {
      this.setJob(id, { ...existingJob, state: 'done', completedAt: Date.now() })
    }
  }

  getMetrics (): { [key: string]: { duration: number } } {
    const jobMetrics: { [key: string]: { duration: number } } = {}
    for (const [jobId, trackedJob] of Object.entries(this.trackedJobs)) {
      if (trackedJob.state !== 'done') {
        console.warn(`Dangling job '${jobId}': ${trackedJob}`)
        continue
      }
      jobMetrics[jobId] = {
        duration: trackedJob.completedAt - trackedJob.startedAt
      }
    }
    return jobMetrics
  }

  private getJob (id: string): TrackedJob | undefined {
    return this.trackedJobs[id]
  }

  private setJob (id: string, job: TrackedJob) {
    this.trackedJobs[id] = job
  }
}

export class ProgressReporter {
  private appStartedState: Partial<BusEventData['app.started']>
  private readonly bar: SingleBar
  private readonly cancelSignal: AbortSignal
  private readonly jobTracker: JobTracker

  constructor ({ cancelSignal }: Partial<{ cancelSignal: AbortSignal }>) {
    this.appStartedState = {}
    this.bar = new cliProgress.SingleBar({ hideCursor: true }, cliProgress.Presets.shades_classic)
    this.cancelSignal = cancelSignal || new AbortController().signal
    this.jobTracker = new JobTracker()

    this.cancelSignal.onabort = () => {
      if (this.bar) this.bar.stop()
    }
  }

  isCancelled (): boolean {
    return this.cancelSignal.aborted
  }

  handler: Reporter = async (eventName, eventData) => {
    switch (eventName) {
      case 'app.started':
        const appStarted = eventData as BusEventData['app.started']

        this.appStartedState = { ...this.appStartedState, ...appStarted }
        console.log('App started, initial state:', this.appStartedState)
        break
      case 'app.scan.done':
        const appScanDone = eventData as BusEventData['app.scan.done']
        const iModules = appScanDone.modules
        const activeIModules = iModules.filter(m => !m.matchesDoNotFollow)

        console.log(
          'Initial scan done,' +
          ` found ${activeIModules.length} active files to process` +
          ` (out of ${iModules.length} files, so ${iModules.length - activeIModules.length} were marked as do not follow)`
        )
        break
      case 'app.parse.done':
        const appParseDone = eventData as BusEventData['app.parse.done']
        const clusters = appParseDone.modules.filter(m => m.kind === 'cluster' && !m.matchesDoNotFollow)
        const files = appParseDone.modules.filter(m => m.kind === 'file' && !m.matchesDoNotFollow)

        console.log(`Parsed ${files.length + clusters.length} active modules to process,` +
          ` ${files.length} files / ${clusters.length} clusters` +
          ` (out of ${appParseDone.modules.length} possible modules)`)
        break
      case 'app.jobs.created':
        const appJobsCreated = eventData as BusEventData['app.jobs.created']

        if (!this.isCancelled()) this.bar.start(appJobsCreated.jobs.length + 1, 0)
        // ↑ The "+ 1" is to have a step for the "app.jobs.done" events
        for (const job of appJobsCreated.jobs) {
          this.jobTracker.addPending(job.id)
        }
        break
      case 'app.jobs.done':
        if (!this.isCancelled()) this.bar.increment()
        break
      case 'app.end':
        const appEnd = eventData as BusEventData['app.end']

        const metrics = this.jobTracker.getMetrics()
        const [, avg] = sum(Object.values(metrics).map((el) => el.duration))
        metrics.average = { duration: avg }
        metrics.totalTimeElapsed = { duration: appEnd.doneInMs }
        const tmpContent = await tree({ base: this.appStartedState.outputTo, l: Number.MAX_VALUE })

        if (!this.isCancelled()) this.bar.stop()
        console.log('Performance report:')
        console.table(mapValues(metrics, ({ duration }) => `${(duration / 1000).toFixed(2)}s`))
        console.log('Content of output:')
        console.log(tmpContent.report)
        break
      case 'job.start':
        const jobStart = eventData as BusEventData['job.start']

        this.jobTracker.setStarted(jobStart.id)
        break
      case 'job.done':
        const jobDone = eventData as BusEventData['job.done']

        this.jobTracker.setDone(jobDone.id)
        if (!this.isCancelled()) this.bar.increment()
        break
      default:
        break
    }
  }
}

function sum (elements: number[]): [number, number] {
  if (elements.length === 0) return [0, 0]
  const sum = elements.reduce((a, b) => a + b, 0)
  const avg = sum / elements.length
  return [sum, avg]
}
