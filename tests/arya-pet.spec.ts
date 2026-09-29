import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectSpriteVersion, loadPetRegistry } from '../src/registry.js'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('built-in Arya pet', () => {
  it('ships a complete v2 animation atlas and selects Arya by default', async () => {
    const atlas = await readFile(join(packageRoot, 'assets', 'arya', 'spritesheet.webp'))
    expect(detectSpriteVersion(atlas)).toBe(2)

    const registry = loadPetRegistry({ packageRoot, petsDir: join(packageRoot, 'missing-user-pets') })
    expect(registry.warnings).toEqual([])
    expect(registry.defaultEntry()).toMatchObject({
      id: 'arya',
      displayName: 'Arya',
      spriteVersionNumber: 2,
      columns: 8,
      rows: 11,
    })
  })

  it('keeps every bundled source string in English', async () => {
    const sourceDir = join(packageRoot, 'src')
    const source = (await Promise.all((await readdir(sourceDir)).filter(name => name.endsWith('.js'))
      .map(name => readFile(join(sourceDir, name), 'utf8')))).join('\n')
    expect(source).not.toMatch(/\p{Script=Han}/u)
  })
})
