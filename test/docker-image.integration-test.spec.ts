import { promises as fs } from 'fs'
import { join } from 'path'
import shellac from 'shellac'

const runCmd = 'docker run --rm -i --user "$(id -u):$(id -g)" -v "$(pwd)":/code -w /code dependency-cruising'

describe('docker image', () => {
  it('shows help', async () => {
    await shellac`
      $$ ${runCmd} --help
      stdout >> ${stdout => expect(stdout).toEqual(expect.stringContaining('foo'))}
    `
  })

  it('README.md has up-to-date help', async () => {
    await shellac`
      $$ ${runCmd} --help
      stdout >> ${async stdout => {
      const README = (await fs.readFile(join(__dirname, '..', 'README.md'))).toString()
      expect(README).toEqual(expect.stringContaining(stdout))
    }}
    `
  })
})
