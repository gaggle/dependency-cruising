/* eslint-disable no-case-declarations */
import cliProgress, { SingleBar } from 'cli-progress'
import tree from 'tree-cli'
import { BusEventData } from './bus'
import { performance } from 'perf_hooks'

export type Reporter = (eventName: keyof BusEventData, eventData: BusEventData[keyof BusEventData]) => void

export const consoleReporter: Reporter = (eventName, eventData) => {
  console.log(eventName, eventData)
}

export class ProgressReporter {
  public jobMetrics: { [key: string]: { start: number, end?: number } }
  private bar: SingleBar
  private state: { [key: string]: any }

  constructor () {
    this.bar = new cliProgress.SingleBar({ hideCursor: true }, cliProgress.Presets.shades_classic)
    this.jobMetrics = {}
    this.state = {}
  }

  handler: Reporter = async (eventName, eventData) => {
    switch (eventName) {
      case 'app.started':
        const appStarted = eventData as BusEventData['app.started']
        this.state = { ...this.state, ...appStarted }
        console.log('App started, intial state:', this.state)
        // this.addOutput(eventName, appStarted.baseDir)
        break
      case 'app.scan.done':
        const appScanDone = eventData as BusEventData['app.scan.done']
        console.log(`Initial scan done, found ${appScanDone.modulesCount} files to process`)
        this.bar.start(appScanDone.modulesCount + 1, 0)
        break
      case 'app.end':
        this.bar.stop()
        const appEnd = eventData as BusEventData['app.end']
        const jobDurations = Object.values(this.jobMetrics).map((value) => {
          if (value.end === undefined) throw new Error('oh no')
          return value.end - value.start
        })
        const tmpContent = await tree({ base: this.state.outputTo, l: Number.MAX_VALUE })
        const [, avg] = sum(jobDurations)
        console.log(eventName, `total run took: ${(appEnd.doneInMs / 1000).toFixed(2)}s, average job duration: ${(avg / 1000).toFixed(2)}s`)
        console.log(tmpContent.report)
        break
      case 'app.jobs.done':
        this.bar.increment()
        break
      case 'job.start':
        const jobStart = eventData as BusEventData['job.start']
        this.jobMetrics[jobStart.id] = {
          start: performance.now()
        }
        break
      case 'job.done':
        const jobDone = eventData as BusEventData['job.done']
        this.jobMetrics[jobDone.id].end = performance.now()
        this.bar.increment()
        break
      default:
        // this.addOutput(eventName, eventData)
        break
    }
  }
}

function sum (elements: number[]): [number, number] {
  const sum = elements.reduce((a, b) => a + b)
  const avg = sum / elements.length
  return [sum, avg]
}
