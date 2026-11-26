'use strict';
// Writes an AI-made scaffold into a folder the user picked. File names and contents come
// from a model, so this side trusts none of them:
//   - paths are re-checked here (no .git, no climbing out);
//   - nothing is written through a link, so nothing lands outside the folder;
//   - a file that gets replaced is copied to a backup folder first.
// Free of Electron imports so it runs under `node --test`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scaffold = require('./scaffold.js');

const randomSuffix = () => crypto.randomBytes(4).toString('hex');

const statOrNull = (p) => {
  try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

// Walks from the chosen folder down to one target. Throws if the route goes through a link
// (Windows junctions included) or is blocked by the wrong kind of thing.
function inspectTarget(root, relPath) {
  const parts = relPath.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = statOrNull(current);
    if (!stat) break;
    const shown = parts.slice(0, i + 1).join('/');
    if (stat.isSymbolicLink()) throw new Error(`"${shown}" is a link, which could lead outside the chosen folder. Nothing was written.`);
    const isLast = i === parts.length - 1;
    if (!isLast && !stat.isDirectory()) throw new Error(`"${shown}" is a file, but the scaffold needs a folder there. Nothing was written.`);
    if (isLast && !stat.isFile()) throw new Error(`"${shown}" is a folder, but the scaffold needs a file there. Nothing was written.`);
  }
  const target = path.join(root, ...parts);
  return { target, stat: statOrNull(target) };
}

function copyForBackup(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  if (!fs.readFileSync(destination).equals(fs.readFileSync(source))) throw new Error('the copy does not match the original');
}

// Written beside the target and moved into place, so a half-written file never replaces a
// good one (and a hard-linked original elsewhere is left alone).
function replaceFile(target, content, mode) {
  const temp = `${target}.vp-${randomSuffix()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    if (mode !== undefined) fs.chmodSync(temp, mode);
    fs.renameSync(temp, target);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch {}
    throw e;
  }
}

// -> { ok: true, written, replaced: [paths], backupDir }
// -> { ok: false, message, needsMergePrompt?, replaces?, backupDir? }
function writeScaffold({ dir, manifest, overwrite = false, backupRoot }) {
  const parsed = scaffold.parseManifest(JSON.stringify(manifest || []));
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const root = path.resolve(String(dir));
  let backupDir = '';
  let written = 0;
  try {
    fs.mkdirSync(root, { recursive: true });
    // Every path is checked before the first write.
    const plan = parsed.manifest.map((file) => {
      const { target, stat } = inspectTarget(root, file.path);
      const changed = !stat || !fs.readFileSync(target).equals(Buffer.from(file.content, 'utf8'));
      return { ...file, target, stat, changed };
    });
    const replaced = plan.filter((f) => f.stat && f.changed);

    if (fs.readdirSync(root).length && !overwrite) {
      return { ok: false, needsMergePrompt: true, message: 'That folder is not empty.', replaces: replaced.map((f) => f.path) };
    }

    // All the old versions are saved before anything changes.
    if (replaced.length) {
      if (!backupRoot) throw new Error('There is nowhere to back up the files that would be replaced.');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupDir = path.join(backupRoot, `${stamp}-${randomSuffix()}`);
      for (const file of replaced) {
        try { copyForBackup(file.target, path.join(backupDir, ...file.path.split('/'))); }
        catch (e) { throw new Error(`Couldn't back up "${file.path}", so nothing was written: ${e.message}`); }
      }
    }

    for (const file of plan) {
      if (file.changed) {
        fs.mkdirSync(path.dirname(file.target), { recursive: true });
        replaceFile(file.target, file.content, file.stat ? file.stat.mode : undefined);
      }
      written++;
    }
    return { ok: true, written, replaced: replaced.map((f) => f.path), backupDir };
  } catch (e) {
    const partly = written ? ` ${written} file(s) had already been written.` : '';
    const saved = written && backupDir ? ` Old versions are in ${backupDir}.` : '';
    return { ok: false, message: `${e.message || e}${partly}${saved}`, backupDir };
  }
}

module.exports = { writeScaffold, inspectTarget };
