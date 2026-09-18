'use strict';

const fs = require('fs');
const path = require('path');

// Use the same filesystem operations on the Node runtime bundled with MV and MZ.
function ensureDirectory(directory) {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) {
    if (!fs.statSync(resolved).isDirectory()) throw new Error('Update path is not a directory.');
    return;
  }
  ensureDirectory(path.dirname(resolved));
  try {
    fs.mkdirSync(resolved);
  } catch (error) {
    if (error.code !== 'EEXIST' || !fs.statSync(resolved).isDirectory()) throw error;
  }
}

// NW.js shipped with MV predates fs.rmSync. Only traverse real directories;
// symbolic links are unlinked without following their targets.
function removeDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Update cleanup requires a real directory.');
  }
  for (const name of fs.readdirSync(directory)) {
    const entry = path.join(directory, name);
    const info = fs.lstatSync(entry);
    if (info.isDirectory() && !info.isSymbolicLink()) removeDirectory(entry);
    else fs.unlinkSync(entry);
  }
  fs.rmdirSync(directory);
}

module.exports = { ensureDirectory, removeDirectory };
