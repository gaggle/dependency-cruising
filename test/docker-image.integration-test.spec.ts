import shellac from 'shellac'
import packageJson from '../package.json'
import { join } from 'path'

const runCmd = 'docker run --rm -i --user "$(id -u):$(id -g)" -v "$(pwd)":/code -w /code dependency-cruising'
const fixtures = join(__dirname, 'fixtures')

describe('docker image', () => {
  it('shows help', async () => {
    await shellac`
      $ ${runCmd} --help
      stdout >> ${stdout => expect(stdout).toEqual(expect.stringContaining(packageJson.description))}
    `
    // ↑ FYI the cli parser pulls package.json's description into the usage help screen, so we can assert that here
  })

  it('can generate a report without errors', async () => {
    await shellac.in(fixtures)`
      $ ${runCmd} simple
      $ mv ./dependency-report ../../dependency-report
    `
  })
})
