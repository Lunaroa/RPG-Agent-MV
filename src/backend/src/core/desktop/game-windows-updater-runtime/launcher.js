'use strict';

// NW.js runs a .js command-line entrypoint in Node mode, independently of the
// game package beside its executable. Do not launch the game UI for an update.
require('./updater.cjs');
