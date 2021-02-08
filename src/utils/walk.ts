import * as fs from 'fs-extra'
import { join } from 'path'

export async function * walk (dir: string): AsyncGenerator<string> {
  for await (const d of await fs.opendir(dir)) {
    const entry = join(dir, d.name)
    if (d.isDirectory()) yield * await walk(entry)
    else if (d.isFile()) yield entry
  }
}
