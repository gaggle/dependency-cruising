import { dirname, join, relative, resolve } from 'path'
import { futureCruise, ICruiseOptions, IReporterOutput, OutputType } from 'dependency-cruiser'
import { IDotThemeEntry } from 'dependency-cruiser/types/reporter-options'
import { JSDOM } from 'jsdom'
import { promises as fs } from 'fs'
import { Readable } from 'stream'
import { spawn } from 'child_process'
import { ICruiseResult } from 'dependency-cruiser/types/cruise-result'

type CruiseOptions = ICruiseOptions & { baseDir?: string }

export async function main (outputTo: string, fileDirectoryArray: string[]): Promise<void> {
  const baseDir = resolve(join(fileDirectoryArray[0], '..'))
  return _main(outputTo, baseDir, fileDirectoryArray.map(el => {
    const r = relative(baseDir, el)
    return r === '' ? '.' : r
  }))
}

async function _main (outputTo: string, baseDir: string, roots: string[]): Promise<void> {
  const scanReport = await runCruise(roots, cruiseOptions({ baseDir })) as {
    output: ICruiseResult;
    exitCode: number;
  }
  console.log('main', {
    baseDir,
    cwd: process.cwd(),
    outputTo,
    roots,
    scan: {
      modulesLength: scanReport.output.modules.length,
      exitCode: scanReport.exitCode
    }
  })

  const indexReport = await runCruise(roots, cruiseOptions({
    baseDir,
    collapsePattern: `(node_modules|(${roots.join('|')})/[^/]+)`,
    outputType: 'archi'
  }))
  const html = await toHtml(indexReport.output.toString(), {
    prefix: 'dependency-cruising/dependency-report/files/',
    baseDir
  })
  await writeFile(join(outputTo, 'index.html'), html)

  const files = new Set<string>()
  for (const root of roots) {
    for await (const path of walk(join(baseDir, root))) {
      files.add(path)
    }
  }

  // TODO: Look at scanReport, not the filesystem
  // async function fileCruise (path: string) {
  //   const relativePath = relative(baseDir, path)
  //   const outputPath = join(outputTo, 'files', `${relativePath}.html`)
  //   const fileReport = await runCruise(roots, cruiseOptions({
  //     baseDir,
  //     collapsePattern: 'node_modules/[^/]+',
  //     focus: [basename(path)],
  //     highlight: relativePath,
  //     outputType: 'dot'
  //   }))
  //   const html = await toHtml(fileReport.output.toString(), {
  //     prefix:
  //       'dependency-cruising/dependency-report/files/',
  //     baseDir
  //   })
  //   await writeFile(outputPath, html)
  // }

  // console.log(`files to process (but currently capped at 10): ${files.size}`)
  // await Promise.all(Array.from(files).slice(0, 10).map(fileCruise))
}

async function writeFile (path: string, data: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, data)
}

async function runCruise (pFileDirectoryArray: string[], pCruiseOptions: CruiseOptions): Promise<IReporterOutput> {
  const lCruiseOptions = { ...pCruiseOptions, validate: false }
  return futureCruise(
    pFileDirectoryArray,
    lCruiseOptions,
    {},
    {
      tsConfig: {},
      babelConfig: {}
    }
  )
}

async function toHtml (cruiseOutput: string, {
  baseDir,
  prefix
}: Partial<{ baseDir: string, prefix: string }> = {}): Promise<string> {
  // depcruise | dot
  const dot = spawn('dot', ['-T', 'svg'], { cwd: baseDir, shell: true })
  dot.stdin.write(cruiseOutput)
  dot.stdin.end()

  // dot | html
  const dotBinFolder = relative(baseDir || process.cwd(), join(__dirname, '..', 'node_modules', '.bin'))
  const html = spawn(join(dotBinFolder, 'depcruise-wrap-stream-in-html'), { cwd: baseDir, shell: true })
  dot.stdout.pipe(html.stdin)

  // html -> dom
  const dom = new JSDOM(await streamToBuffer(html.stdout))
  const hrefs = dom.window.document.getElementsByTagName('a')
  console.log(`rewriting ${hrefs.length} hrefs`)
  for (const el of Array.from(hrefs) as any[]) {
    const href = el.getAttribute('xlink:href')
    el.setAttribute('xlink:href', `/${prefix || ''}${href}.html`)
  }

  return dom.window.document.documentElement.outerHTML
}

function cruiseOptions ({ baseDir, collapsePattern, focus, highlight, outputType, prefix }: Partial<{
  baseDir: string, collapsePattern: string, focus: string[], highlight: string, outputType: OutputType, prefix: string
}> = {}): CruiseOptions {
  const modules: IDotThemeEntry[] = [
    {
      criteria: {
        source: '.(controller).(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee.md)$'
      },
      attributes: { fillcolor: 'pink' }
    },
    {
      criteria: {
        source: '.(module).(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee.md)$'
      },
      attributes: { fillcolor: 'peachpuff' }
    },
    {
      criteria: {
        source: '.(service).(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee.md)$'
      },
      attributes: { fillcolor: 'lightyellow' }
    },
    {
      criteria: {
        source: '.(spec|test).(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee.md)$'
      },
      attributes: { fillcolor: 'palegreen' }
    }
  ]
  if (highlight) {
    modules.unshift({
      criteria: {
        source: highlight
      },
      attributes: { color: 'orchid', penwidth: 2 }
    })
  }
  return {
    baseDir,
    prefix,
    ruleSet: {
      forbidden: [
        /* rules from the 'recommended' preset: */
        {
          name: 'no-circular',
          severity: 'warn',
          comment:
            'This dependency is part of a circular relationship. You might want to revise ' +
            'your solution (i.e. use dependency inversion, make sure the modules have a single responsibility) ',
          from: {},
          to: {
            circular: true
          }
        },
        {
          name: 'no-deprecated-core',
          comment:
            'A module depends on a node core module that has been deprecated. Find an alternative - these are ' +
            'bound to exist - node doesn\'t deprecate lightly.',
          severity: 'warn',
          from: {},
          to: {
            dependencyTypes: ['core'],
            path: [
              '^(v8/tools/codemap)$',
              '^(v8/tools/consarray)$',
              '^(v8/tools/csvparser)$',
              '^(v8/tools/logreader)$',
              '^(v8/tools/profile_view)$',
              '^(v8/tools/profile)$',
              '^(v8/tools/SourceMap)$',
              '^(v8/tools/splaytree)$',
              '^(v8/tools/tickprocessor-driver)$',
              '^(v8/tools/tickprocessor)$',
              '^(node-inspect/lib/_inspect)$',
              '^(node-inspect/lib/internal/inspect_client)$',
              '^(node-inspect/lib/internal/inspect_repl)$',
              '^(async_hooks)$',
              '^(assert)$',
              '^(punycode)$',
              '^(domain)$',
              '^(constants)$',
              '^(sys)$',
              '^(_linklist)$',
              '^(_stream_wrap)$'
            ]
          }
        },
        {
          name: 'not-to-deprecated',
          comment:
            'This module uses a (version of an) npm module that has been deprecated. Either upgrade to a later ' +
            'version of that module, or find an alternative. Deprecated modules are a security risk.',
          severity: 'warn',
          from: {},
          to: {
            dependencyTypes: ['deprecated']
          }
        },
        {
          name: 'no-non-package-json',
          severity: 'error',
          comment:
            'This module depends on an npm package that isn\'t in the \'dependencies\' section of your package.json. ' +
            'That\'s problematic as the package either (1) won\'t be available on live (2 - worse) will be ' +
            'available on live with an non-guaranteed version. Fix it by adding the package to the dependencies ' +
            'in your package.json.',
          from: {},
          to: {
            dependencyTypes: ['npm-no-pkg', 'npm-unknown']
          }
        },
        {
          name: 'not-to-unresolvable',
          comment:
            'This module depends on a module that cannot be found (\'resolved to disk\'). If it\'s an npm ' +
            'module: add it to your package.json. In all other cases you likely already know what to do.',
          severity: 'error',
          from: {},
          to: {
            couldNotResolve: true
          }
        },
        {
          name: 'no-duplicate-dep-types',
          comment:
            'Likely this module depends on an external (\'npm\') package that occurs more than once ' +
            'in your package.json i.e. bot as a devDependencies and in dependencies. This will cause ' +
            'maintenance problems later on.',
          severity: 'warn',
          from: {},
          to: {
            moreThanOneDependencyType: true
          }
        },

        /* rules you might want to tweak for your specific situation: */
        {
          name: 'not-to-spec',
          comment:
            'This module depends on a spec (test) file. The sole responsibility of a spec file is to test code. ' +
            'If there\'s something in a spec that\'s of use to other modules, it doesn\'t have that single ' +
            'responsibility anymore. Factor it out into (e.g.) a separate utility/ helper or a mock.',
          severity: 'error',
          from: {},
          to: {
            path:
              '\\.(spec|test)\\.(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee\\.md)$'
          }
        },
        {
          name: 'not-to-dev-dep',
          severity: 'error',
          comment:
            'This module depends on an npm package from the \'devDependencies\' section of your ' +
            'package.json. It looks like something that ships to production, though. To prevent problems ' +
            'with npm packages that aren\'t there on production declare it (only!) in the \'dependencies\'' +
            'section of your package.json. If this module is development only - add it to the ' +
            'from.pathNot re of the not-to-dev-dep rule in the dependency-cruiser configuration',
          from: {
            path: '^(src)',
            pathNot:
              '\\.(spec|test)\\.(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee\\.md)$'
          },
          to: {
            dependencyTypes: ['npm-dev']
          }
        },
        {
          name: 'optional-deps-used',
          severity: 'info',
          comment:
            'This module depends on an npm package that is declared as an optional dependency ' +
            'in your package.json. As this makes sense in limited situations only, it\'s flagged here. ' +
            'If you\'re using an optional dependency here by design - add an exception to your' +
            'dependency-cruiser configuration.',
          from: {},
          to: {
            dependencyTypes: ['npm-optional']
          }
        },
        {
          name: 'peer-deps-used',
          comment:
            'This module depends on an npm package that is declared as a peer dependency ' +
            'in your package.json. This makes sense if your package is e.g. a plugin, but in ' +
            'other cases - maybe not so much. If the use of a peer dependency is intentional ' +
            'add an exception to your dependency-cruiser configuration.',
          severity: 'warn',
          from: {},
          to: {
            dependencyTypes: ['npm-peer']
          }
        }
      ]
    },
    tsPreCompilationDeps: true,
    outputType,
    focus: focus ? `(${focus.join('|')})` : undefined,
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: [
        'npm',
        'npm-dev',
        'npm-optional',
        'npm-peer',
        'npm-bundled',
        'npm-no-pkg'
      ]
    },
    enhancedResolveOptions: {
      /* List of strings to consider as 'exports' fields in package.json. Use
         ['exports'] when you use packages that use such a field and your environment
         supports it (e.g. node ^12.19 || >=14.7 or recent versions of webpack).

        If you have an `exportsFields` attribute in your webpack config, that one
         will have precedence over the one specified here.
      */
      exportsFields: ['exports'],
      /* List of conditions to check for in the exports field. e.g. use ['imports']
         if you're only interested in exposed es6 modules, ['require'] for commonjs,
         or all conditions at once `(['import', 'require', 'node', 'default']`)
         if anything goes for you. Only works when the 'exportsFields' array is
         non-empty.

        If you have a 'conditionNames' attribute in your webpack config, that one will
        have precedence over the one specified here.
      */
      conditionNames: ['import', 'require', 'node', 'default']
    },
    reporterOptions: {
      dot: {
        /* pattern of modules that can be consolidated in the detailed
           graphical dependency graph. The default pattern in this configuration
           collapses everything in node_modules to one folder deep so you see
           the external modules, but not the innards your app depends upon.
         */
        collapsePattern,

        /* Options to tweak the appearance of your graph.See
           https://github.com/sverweij/dependency-cruiser/blob/master/doc/options-reference.md#reporteroptions
           for details and some examples. If you don't specify a theme
           don't worry - dependency-cruiser will fall back to the default one.
        */
        theme: {
          graph: {
            /* use splines: "ortho" for straight lines. Be aware though
              graphviz might take a long time calculating ortho(gonal)
              routings.
           */
            // splines: 'ortho'
          },
          modules,
          dependencies: [
            {
              criteria: { 'rules[0].severity': 'error' },
              attributes: { fontcolor: 'red', color: 'red' }
            },
            {
              criteria: { 'rules[0].severity': 'warn' },
              attributes: { fontcolor: 'orange', color: 'orange' }
            },
            {
              criteria: { 'rules[0].severity': 'info' },
              attributes: { fontcolor: 'blue', color: 'blue' }
            }
            // {
            //   criteria: { resolved: '^src/model' },
            //   attributes: { color: '#0000ff77' }
            // },
            // {
            //   criteria: { resolved: '^src/view' },
            //   attributes: { color: '#00770077' }
            // }
          ]
        }
      }
    }
  }
}

async function streamToBuffer (stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const data: Uint8Array[] = []

    stream.on('data', (chunk) => {
      data.push(chunk)
    })

    stream.on('end', () => {
      resolve(Buffer.concat(data))
    })

    stream.on('error', (err) => {
      reject(err)
    })
  })
}

async function * walk (dir: string): AsyncGenerator<string> {
  for await (const d of await fs.opendir(dir)) {
    const entry = join(dir, d.name)
    if (d.isDirectory()) yield * await walk(entry)
    else if (d.isFile()) yield entry
  }
}
