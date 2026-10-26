// Day counters and pause files shared by the two person-clicked model paths (director.mjs, generate.mjs).
import fs from 'node:fs';
import { readJson, writeJson } from '../engine/core.mjs';

// Local calendar day, so a daily cap resets at the person's midnight.
export const runDay = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function runsToday(file, now = new Date()) {
  const r = readJson(file, null);
  return r && r.day === runDay(now) && Number.isInteger(r.count) ? r.count : 0;
}

export function countRun(file, now = new Date()) {
  writeJson(file, { day: runDay(now), count: runsToday(file, now) + 1 });
}

export const runMonth = (now = new Date()) => runDay(now).slice(0, 7);

/** Uses today and this month from `{ day, count, month, monthCount }`; each part resets on its own rollover. */
export function usage(file, now = new Date()) {
  const r = readJson(file, null) || {};
  const n = (v) => (Number.isInteger(v) ? v : 0);
  return { day: r.day === runDay(now) ? n(r.count) : 0, month: r.month === runMonth(now) ? n(r.monthCount) : 0 };
}

export function countUse(file, now = new Date()) {
  const u = usage(file, now);
  writeJson(file, { day: runDay(now), count: u.day + 1, month: runMonth(now), monthCount: u.month + 1 });
}

export function readPause(file) {
  const p = readJson(file, null);
  return p && Date.parse(p.until) > Date.now() ? p : null;
}

export const clearPause = (file) => fs.rmSync(file, { force: true });
