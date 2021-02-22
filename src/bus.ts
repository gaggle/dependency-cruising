import Emittery from 'emittery'

import { consoleReporter, Reporter } from './reporters'
import { Bus, BusEventData } from './types/bus'

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
