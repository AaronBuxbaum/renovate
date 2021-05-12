import { id as npmId } from '../../datasource/npm';
import { logger } from '../../logger';
import type { PackageDependency, PackageFile } from '../types';

export function extractPackageFile(content: string): PackageFile | null {
  let deps: PackageDependency[] = [];
  const npmDepends = /\nNpm\.depends\({([\s\S]*?)}\);/.exec(content);
  if (!npmDepends) {
    return null;
  }
  try {
    deps = npmDepends[1]
      .replace(/(\s|\\n|\\t|'|")/g, '')
      .split(',')
      .map((dep) => dep.trim())
      .filter((dep) => dep.length)
      .map((dep) => dep.split(/:(.*)/))
      .map((arr) => {
        const [depName, currentValue] = arr;
        /* c8 ignore next 3 */
        if (!(depName && currentValue)) {
          logger.warn({ content }, 'Incomplete npm.depends match');
        }
        return {
          depName,
          currentValue,
          datasource: npmId,
        };
      })
      .filter((dep) => dep.depName && dep.currentValue);
  } catch (err) /* c8 ignore start */ {
    logger.warn({ content }, 'Failed to parse meteor package.js');
  } /* c8 ignore stop */

  /* c8 ignore next 3 */
  if (!deps.length) {
    return null;
  }
  return { deps };
}
