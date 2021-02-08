#!/usr/bin/env ts-node
import meow from 'meow'
import { promises as fs, Stats } from 'fs'
import { resolve } from 'path'
import { main } from './main'

const DEFAULT_OUTPUT = 'dependency-report'

const cli = meow(`
  Usage
    $ dependency-cruising [-o output] <paths_to_scan>

  Options
    --output, -o  Directory to output dependency report, default=${DEFAULT_OUTPUT}

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
    await fs.mkdir(flags.output, { recursive: true })
    flags.output = resolve(flags.output)
  }

  await normalizeOutput()
  return flags
}

async function bootstrap (input: typeof cli.input, flags: typeof cli.flags) {
  const normalizedFlags = await normalizeFlags(flags)
  console.time('main')
  await main(normalizedFlags.output, input)
  console.timeEnd('main')
}

bootstrap(cli.input, cli.flags)
  .catch(err => {
    throw err
  })
