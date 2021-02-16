#!/usr/bin/env ts-node
import meow from 'meow'
import { cpus } from 'os'
import { promises as fs, Stats } from 'fs'
import { resolve } from 'path'

import { cancel, cancelSignal } from './cancellation'
import { main } from './main'
import { newBus } from './bus'
import { ProgressReporter } from './reporters'

const DEFAULT_CONCURRENCY = cpus().length
const DEFAULT_OUTPUT = 'dependency-report'
let QUIT_COUNT = 0

process.on('SIGINT', function () {
  console.log('SIGINT')
  QUIT_COUNT += 1
  if (QUIT_COUNT > 1) {
    console.log('Force quitting')
    process.exit(2)
  }
  console.log('Exiting gracefully, ^C again to force quit')
  cancel()
})

const cli = meow(`
  Usage
    $ dependency-cruising [-o output] <paths_to_scan>

  Options
    --output, -o        Directory to output dependency report, default=${DEFAULT_OUTPUT}
    --concurrency, -c   How many jobs to process at a time, default=<number of cpus>

  Examples
    $ dependency-cruising .
    $ dependency-cruising -o ./foo .
    $ dependency-cruising src/services
`, {
  allowUnknownFlags: false,
  autoHelp: false,
  flags: {
    help: {
      type: 'boolean',
      alias: 'h'
    },
    output: {
      type: 'string',
      alias: 'o',
      default: DEFAULT_OUTPUT
    },
    concurrency: {
      type: 'number',
      alias: 'c',
      default: DEFAULT_CONCURRENCY
    }
  }
})

if (cli.flags.help) {
  cli.showHelp(0)
}

async function normalizeFlags (flags: typeof cli.flags): Promise<typeof cli.flags> {
  async function normalizeOutput () {
    let stats: Stats | undefined
    try {
      stats = await fs.stat(flags.output)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      stats = undefined
    }
    if (stats && !stats.isDirectory()) throw new Error(`${flags.output} is not a directory`)
    flags.output = resolve(flags.output)
  }

  function normalizeConcurrency () {
    if (flags.concurrency < 1) throw new Error(`${flags.concurrency} must be at least 1`)
  }

  await normalizeOutput()
  await normalizeConcurrency()
  return flags
}

async function bootstrap (input: typeof cli.input, flags: typeof cli.flags) {
  console.log('booting')
  const reporter = new ProgressReporter({ cancelSignal })
  const bus = newBus(reporter.handler.bind(reporter))
  const normalizedFlags = await normalizeFlags(flags)
  try {
    await main(normalizedFlags.output, input, { bus, concurrency: flags.concurrency })
  } catch (err) {
    if (err.message !== 'dependency-cruising cancelled') throw err
    console.error('Dependency Cruising gracefully exited')
    process.exit(1)
  }
}

bootstrap(cli.input, cli.flags)
  .catch(err => {
    throw err
  })
