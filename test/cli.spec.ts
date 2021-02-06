import shellac from 'shellac'
import { join } from 'path'
import { promises as fs } from 'fs'

describe('cli', () => {
  it('README.md shows up-to-date help', async () => {
    await shellac`
      $ PATH=$PATH:$(npm bin) ./src/cli.ts --help
      stdout >> ${async stdout => {
      const README = (await fs.readFile(join(__dirname, '..', 'README.md'))).toString()
      expect(README).toEqual(expect.stringContaining(stdout))
    }}
    `
  })
})
