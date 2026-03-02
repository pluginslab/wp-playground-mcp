import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedReference = null;

/**
 * Load the blueprint reference data from the static JSON file.
 * @returns {object} The blueprint reference object
 */
export function getBlueprintReference() {
  if (!cachedReference) {
    const refPath = join(__dirname, '..', '..', 'data', 'blueprint-reference.json');
    cachedReference = JSON.parse(readFileSync(refPath, 'utf-8'));
  }
  return cachedReference;
}
