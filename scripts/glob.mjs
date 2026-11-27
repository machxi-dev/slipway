// Path globs, as config areas and the budget file write them (docs/design.md §3.3, §14).
// `**` matches any number of path segments, `*` anything within one segment, `?` one character.
// Paths are repository-relative with forward slashes.

const cache = new Map();

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const atStart = i === 0 || glob[i - 1] === '/';
      const atEnd = i + 2 === glob.length || glob[i + 2] === '/';
      if (atStart && atEnd) {
        // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
        if (i + 2 === glob.length) re += '.*';
        else {
          re += '(?:[^/]*/)*';
          i++;
        }
        i++;
        continue;
      }
      re += '[^/]*';
      i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const isGlob = (p) => /[*?]/.test(p);

/** True when the repository-relative path matches the glob. */
export function matches(glob, file) {
  let re = cache.get(glob);
  if (!re) cache.set(glob, (re = globToRegExp(glob)));
  return re.test(file.replaceAll('\\', '/'));
}
