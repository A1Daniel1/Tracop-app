import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'src/modules/catalog/application/catalog-service.ts');
const source = readFileSync(target, 'utf8');
const lines = source.split(/\r?\n/).map((line) => line.trim());
const duplicates: string[] = [];

for (let index = 0; index < lines.length - 3; index += 1) {
  const line = lines[index];
  if (!line) continue;
  let runLength = 1;
  while (lines[index + runLength] === line) runLength += 1;
  if (runLength > 3) {
    duplicates.push(`línea ${index + 1}: "${line}" repetida ${runLength} veces`);
  }
  index += runLength - 1;
}

if (duplicates.length > 0) {
  console.error(`Se encontraron líneas idénticas consecutivas:\n${duplicates.join('\n')}`);
  process.exit(1);
}

console.log('catalog-service.ts: sin líneas idénticas consecutivas mayores a 3');
