import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const mode = process.argv[2];
if (!['participant','pilot'].includes(mode)) throw new Error('Usage: npm run package:collection -- participant|pilot');
const dir = resolve(`dist-${mode}`);
const info = JSON.parse(await readFile(join(dir, 'build-info.json'), 'utf8'));
if (info.actualCollection !== 'BLOCKED' || info.mode !== (mode === 'pilot' ? 'collection-pilot' : 'participant')) throw new Error('Build mode mismatch');
const head = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim();
if (info.sourceCommit !== head) throw new Error('Rebuild after changing HEAD');
const files = [];
async function walk(path, prefix = '') { for (const entry of await readdir(path, { withFileTypes: true })) {
  const name = prefix + entry.name;
  if (entry.isDirectory()) await walk(join(path,entry.name), `${name}/`);
  else { if (entry.isSymbolicLink() || /\.(map|env)$|secret|credential/i.test(name)) throw new Error('Unexpected package file');
    const bytes = await readFile(join(path,entry.name)); files.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') }); }
} }
await walk(dir);
await writeFile(join(dir,'checksums.json'), JSON.stringify(files.filter(f => f.path !== 'checksums.json'), null, 2));
await mkdir(resolve('packages'), { recursive: true });
// Python zipfile is available on macOS, Linux and Windows (use a python3 alias there).
const target = resolve(`packages/focus-v2-${mode}-${info.version}-${head.slice(0,12)}${info.dirty ? '-dirty' : ''}.zip`);
execFileSync(process.env.PYTHON || 'python3', ['-c', 'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file(): z.write(f,f.relative_to(p))', dir, target]);
console.log(JSON.stringify({ ...info, package: target, sha256: createHash('sha256').update(await readFile(target)).digest('hex') }, null, 2));
