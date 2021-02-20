#!/usr/bin/env ts-node
import meow from 'meow'
import { cpus } from 'os'
import { promises as fs, Stats } from 'fs'
import { resolve } from 'path'

import { newBus } from './bus'
import { main } from './main'
import { ProgressReporter } from './reporters'

const DEFAULT_CONCURRENCY = Math.round(cpus().length / 2)
const DEFAULT_OUTPUT = 'dependency-report'

if (process.pid === 1) {
  process.on('SIGINT', function () {
    process.exit(2)
  })
  console.log('Interrupt handling initialized')
}

const cli = meow(`
  Usage
    $ dependency-cruising [-o output] [-i regex]... [-x regex]... [-c concurrency] <path_to_scan>

  Options
    --output, -o        Directory to output dependency report, default=${DEFAULT_OUTPUT}
    --include, -i       Only include modules matching the regex (can be specified multiple times)
    --exclude, -x       Exclude all modules matching the regex (can be specified multiple times)
    --concurrency, -c   How many jobs to process at a time, default=<number of cpus / 2>

  Examples
    $ dependency-cruising .
    $ dependency-cruising --output report .
    $ dependency-cruising src/services
    $ dependency-cruising --concurrency 1 .
    $ dependency-cruising --include src --exclude node_modules .
    $ dependency-cruising --exclude ^src/*.spec --exclude src/.*/*.d.ts src/services
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
    include: {
      type: 'string',
      alias: 'i',
      isMultiple: true
    },
    exclude: {
      type: 'string',
      alias: 'x',
      isMultiple: true
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

interface ParsedCli {
  scan: string,
  flags: typeof cli.flags
}

async function parseCli ({ input, flags }: { input: typeof cli.input, flags: typeof cli.flags }): Promise<ParsedCli> {
  function parseConcurrency () {
    if (flags.concurrency < 1) throw new Error(`${flags.concurrency} must be at least 1`)
    return flags.concurrency
  }

  async function parseOutput () {
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

  async function parseScanPath () {
    const scan = input.shift()
    if (!scan) throw new Error('must specify a scan path')
    await fs.stat(scan)
    return scan
  }

  await parseConcurrency()
  await parseOutput()
  const scan = await parseScanPath()
  return { scan, flags }
}

async function bootstrap ({ scan, flags }: ParsedCli) {
  const reporter = new ProgressReporter()
  const bus = newBus(reporter.handler.bind(reporter))
  await main(flags.output, scan, {
    bus,
    concurrency: flags.concurrency,
    include: flags.include,
    exclude: flags.exclude
  })
}

parseCli(cli)
  .then(bootstrap)
  .catch(err => {
    throw err
  })
