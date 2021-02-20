import { isEqual } from 'lodash'

export class Referencer<El> {
  modulesById: { [key: string]: El } = {}

  create<T extends El> (id: string, el: T): T {
    switch (true) {
      case (this.modulesById[id] === undefined):
        this.modulesById[id] = el
        return el
      case (isEqual(this.modulesById[id], el)):
        return this.modulesById[id] as T
      default:
        throw new Error(`error creating element ${id}\n:${JSON.stringify(el)}`)
    }
  }

  get (): { [key: string]: El } {
    return { ...this.modulesById }
  }
}
