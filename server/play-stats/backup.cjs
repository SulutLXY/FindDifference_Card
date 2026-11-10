'use strict';
const fs = require('node:fs'), path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const target = process.argv[2];
if (!target || fs.existsSync(target)) throw Error('Provide a new backup file path; existing files will not be overwritten');
const source = process.env.DATA_PATH || path.join(__dirname, 'data', 'plays.sqlite');
if (!fs.existsSync(source)) throw Error('Statistics database does not exist');
const db = new DatabaseSync(source, { readOnly: true });
backup(db, target).then(() => { db.close(); console.log('Backup complete:', target); }).catch(error => { db.close(); console.error(error); process.exitCode = 1; });
