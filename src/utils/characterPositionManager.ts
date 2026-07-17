interface CharacterState {
  x: number;
  width: number;
  movingRight: boolean;
  isMoving: boolean;
}

const characters = new Map<string, CharacterState>();

export function registerCharacter(name: string, width: number) {
  if (!characters.has(name)) {
    characters.set(name, { x: 0, width, movingRight: true, isMoving: false });
  }
}

export function unregisterCharacter(name: string) {
  characters.delete(name);
}

export function updateCharacterPosition(
  name: string,
  x: number,
  movingRight: boolean,
  isMoving: boolean,
) {
  const c = characters.get(name);
  if (c) {
    c.x = x;
    c.movingRight = movingRight;
    c.isMoving = isMoving;
  }
}

export function getOtherCharacters(name: string): Array<{ name: string } & CharacterState> {
  const result: Array<{ name: string } & CharacterState> = [];
  characters.forEach((state, n) => {
    if (n !== name) {
      result.push({ name: n, ...state });
    }
  });
  return result;
}

export function getCharacterWidth(name: string): number {
  return characters.get(name)?.width ?? 80;
}

export function checkCollision(
  name: string,
  x: number,
  width: number,
  minGap: number = 8,
): { colliding: boolean; pushDir: number; otherName: string | null } {
  const others = getOtherCharacters(name);
  for (const other of others) {
    const myLeft = x - width / 2;
    const myRight = x + width / 2;
    const otherLeft = other.x - other.width / 2;
    const otherRight = other.x + other.width / 2;

    const gap = Math.min(myRight, otherRight) - Math.max(myLeft, otherLeft);
    if (gap + minGap > 0) {
      const pushDir = x < other.x ? -1 : 1;
      return { colliding: true, pushDir, otherName: other.name };
    }
  }
  return { colliding: false, pushDir: 0, otherName: null };
}

export function wouldCollide(
  name: string,
  targetX: number,
  width: number,
  direction: number,
  minGap: number = 12,
): boolean {
  const others = getOtherCharacters(name);
  for (const other of others) {
    const myLeft = targetX - width / 2;
    const myRight = targetX + width / 2;
    const otherLeft = other.x - other.width / 2;
    const otherRight = other.x + other.width / 2;

    const gap = Math.min(myRight, otherRight) - Math.max(myLeft, otherLeft);
    if (gap + minGap > 0) {
      if (direction > 0 && targetX > other.x) return true;
      if (direction < 0 && targetX < other.x) return true;
    }
  }
  return false;
}
