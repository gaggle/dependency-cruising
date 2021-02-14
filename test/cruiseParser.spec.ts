import { ClusterModule, FileModule, Module, parseDependencyCruiserModules } from '../src/cruiseParser'
import { IDependency, IModule } from 'dependency-cruiser'

function getCruiserDependency (override: Partial<IDependency> = {}): IDependency {
  return {
    circular: false,
    coreModule: false,
    couldNotResolve: false,
    dependencyTypes: ['local'],
    dynamic: false,
    exoticallyRequired: false,
    followable: true,
    module: './bar',
    moduleSystem: 'es6',
    resolved: 'src/bar.ts',
    valid: true,
    ...override
  }
}

function getCruiserModule (override: Partial<IModule> = {}): IModule {
  return {
    dependencies: [],
    source: 'src/foo.ts',
    valid: true,
    ...override
  }
}

describe('parseDependencyCruiserModules', () => {
  it('adds cluster from a file inside a folder', () => {
    const result = parseDependencyCruiserModules([
      getCruiserModule({ source: 'src/foo.ts' })
    ])
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining<Partial<FileModule>>({
        kind: 'file',
        source: 'src/foo.ts',
        cluster: {
          kind: 'cluster',
          source: 'src'
        }
      }),
      expect.objectContaining<Partial<ClusterModule>>({
        kind: 'cluster',
        source: 'src'
      })
    ]))
  })

  it('captures file dependencies', () => {
    const result = parseDependencyCruiserModules([
      getCruiserModule({ source: 'src/bar.ts' }),
      getCruiserModule({
        source: 'src/foo.ts',
        dependencies: [getCruiserDependency({ module: './bar', resolved: 'src/bar.ts' })]
      })
    ])
    expect(result).toEqual(expect.arrayContaining<Partial<Module>>([
      expect.objectContaining<Partial<FileModule>>({
        kind: 'file',
        source: 'src/foo.ts',
        dependencies: [
          expect.objectContaining<Partial<IDependency>>({
            module: './bar',
            resolved: 'src/bar.ts'
          })
        ]
      }),
      expect.objectContaining<Partial<FileModule>>({
        kind: 'file',
        source: 'src/bar.ts'
      }),
      expect.objectContaining<Partial<ClusterModule>>({
        kind: 'cluster',
        source: 'src'
      })
    ]))
  })
})
