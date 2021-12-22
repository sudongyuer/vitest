import { existsSync, readdirSync } from 'fs'
import { basename, dirname, resolve } from 'pathe'
import { spies, spyOn } from '../integrations/jest-mock'
import { mergeSlashes } from '../utils'

export interface SuiteMocks {
  [suitePath: string]: {
    [originalPath: string]: string | null
  }
}

function resolveMockPath(mockPath: string, root: string, nmName: string | null) {
  // it's a node_module alias
  // all mocks should be inside <root>/__mocks__
  if (nmName) {
    const mockFolder = resolve(root, '__mocks__')
    const files = readdirSync(mockFolder)

    for (const file of files) {
      const [basename] = file.split('.')
      if (basename === nmName)
        return resolve(mockFolder, file).replace(root, '')
    }

    return null
  }

  const dir = dirname(mockPath)
  const baseId = basename(mockPath)
  const fullPath = resolve(dir, '__mocks__', baseId)
  return existsSync(fullPath) ? fullPath.replace(root, '') : null
}

function getObjectType(value: unknown): string {
  return Object.prototype.toString.apply(value).slice(8, -1)
}

function mockPrototype(proto: any) {
  if (!proto) return null

  const newProto: any = {}

  const protoDescr = Object.getOwnPropertyDescriptors(proto)

  // eslint-disable-next-line no-restricted-syntax
  for (const d in protoDescr) {
    Object.defineProperty(newProto, d, protoDescr[d])

    if (typeof protoDescr[d].value === 'function')
      spyOn(newProto, d).mockImplementation(() => {})
  }

  return newProto
}

function mockObject(obj: any) {
  const type = getObjectType(obj)

  if (Array.isArray(obj))
    return []
  else if (type !== 'Object' && type !== 'Module')
    return obj

  const newObj = { ...obj }

  const proto = mockPrototype(Object.getPrototypeOf(obj))
  Object.setPrototypeOf(newObj, proto)

  // eslint-disable-next-line no-restricted-syntax
  for (const k in obj) {
    newObj[k] = mockObject(obj[k])
    const type = getObjectType(obj[k])

    if (type.includes('Function') && !obj[k].__isSpy) {
      spyOn(newObj, k).mockImplementation(() => {})
      Object.defineProperty(newObj[k], 'length', { value: 0 }) // tinyspy retains length, but jest doesnt
    }
  }
  return newObj
}

export function createMocker(root: string, mockMap: SuiteMocks) {
  function getSuiteFilepath() {
    return process.__vitest_worker__?.filepath
  }

  function getActualPath(path: string, nmName: string) {
    return nmName ? mergeSlashes(`/@fs/${path}`) : path.replace(root, '')
  }

  function unmockPath(path: string, nmName: string) {
    const suitefile = getSuiteFilepath()

    if (suitefile) {
      const fsPath = getActualPath(path, nmName)
      mockMap[suitefile] ??= {}
      delete mockMap[suitefile][fsPath]
    }
  }

  function mockPath(path: string, nmName: string) {
    const suitefile = getSuiteFilepath()

    if (suitefile) {
      const mockPath = resolveMockPath(path, root, nmName)
      const fsPath = getActualPath(path, nmName)
      mockMap[suitefile] ??= {}
      mockMap[suitefile][fsPath] = mockPath
    }
  }

  function clearMocks({ clearMocks, mockReset, restoreMocks }: { clearMocks: boolean; mockReset: boolean; restoreMocks: boolean}) {
    if (!clearMocks && !mockReset && !restoreMocks)
      return

    spies.forEach((s) => {
      if (restoreMocks)
        s.mockRestore()
      else if (mockReset)
        s.mockReset()
      else if (clearMocks)
        s.mockClear()
    })
  }

  return {
    mockPath,
    unmockPath,
    clearMocks,
    getActualPath,

    mockObject,
    getSuiteFilepath,
    resolveMockPath,
  }
}
