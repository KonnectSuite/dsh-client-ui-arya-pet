export interface PetEntry {
  readonly id: string
  readonly displayName: string
  readonly spriteVersionNumber: number
  readonly columns: number
  readonly rows: number
}

export interface PetRegistry {
  readonly warnings: readonly string[]
  defaultEntry(): PetEntry
}

export function detectSpriteVersion(buffer: Uint8Array): number | null

export function loadPetRegistry(options: {
  readonly packageRoot: string
  readonly petsDir?: string
}): PetRegistry
