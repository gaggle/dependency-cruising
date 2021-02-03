#!/usr/bin/env ts-node
import meow from 'meow'
import { main } from './main'

const cli = meow(`
  Usage
    $ dependency-cruising [-o output] <files_to_scan>

  Options
    --output, -o  Directory to output dependency report

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
      alias: 'o'
    }
  }
})

if (cli.flags.help) {
  cli.showHelp(0)
}

async function bootstrap (input: typeof cli.input, flags: typeof cli.flags) {
  await main(flags.output || 'dependency-report', input)
}

bootstrap(cli.input, cli.flags)
  .catch(err => {
    throw err
  })
