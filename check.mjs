#!/usr/bin/env node
// Builds the app, runs the unit tests, drives the app in a real browser, then
// asserts every behaviour the blog post states. Exit code 0 means every line
// printed PASS.
//
//   npm run check
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const NG = require.resolve('@angular/cli/bin/ng.js');
const ANSI = /\u001b\[[0-9;]*m/g;

let failures = 0;
function report(ok, line) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`);
}
function run(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', shell: false });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(ANSI, '') };
}

// 1. The app compiles. Every snippet in the post comes out of src/app.
const build = run(process.execPath, [NG, 'build', '--configuration', 'development', '--no-progress']);
report(build.code === 0, 'ng build (the form, the validator and the wait helper compile)');

// 2. The unit tests.
const test = run(process.execPath, [NG, 'test', '--no-watch', '--no-progress', '--reporters=verbose']);
report(test.code === 0, 'ng test exits 0');
report(/Tests\s+25 passed \(25\)/.test(test.out), 'ng test reports: Tests  25 passed (25)');
for (const line of [
  "RESULT mode=default action=1 onInvalid=0 returned=true errorsAfter=[\"taken\"]",
  "RESULT mode='pending' action=1 onInvalid=0 returned=true errorsAfter=[\"taken\"]",
  "RESULT mode='none' action=0 onInvalid=1 returned=false errorsAfter=[\"taken\"]",
  "RESULT mode='all' action=1 onInvalid=0 returned=true errorsAfter=[\"taken\"]",
  'RESULT during pending=true valid=false invalid=false errors=[]',
  'RESULT after pending=false valid=false invalid=true errors=["taken"]',
  'RESULT fieldDebounce value=free control=khaled pending=false valid=true',
]) {
  report(test.out.includes(line), line);
}

// 3. The versions the post names.
const version = (name) => JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
report(version('@angular/forms') === '22.2.5', `@angular/forms is 22.2.5 (${version('@angular/forms')})`);
report(version('@angular/core') === '22.2.5', `@angular/core is 22.2.5 (${version('@angular/core')})`);
report(version('typescript') === '6.0.3', `typescript is 6.0.3 (${version('typescript')})`);

// 4. Nothing in the public API waits for pending validators.
const dts = readFileSync('node_modules/@angular/forms/types/signals.d.ts', 'utf8');
const exported = (dts.match(/export \{[^}]*\}/g) ?? [])
  .join(' ')
  .replace(/export \{|\}/g, '')
  .split(',')
  .map((s) => s.trim());
const waiters = exported.filter((n) => /wait|settle|whenValid|whenStable|untilValid|pending/i.test(n));
report(exported.length > 50 && waiters.length === 0, `no export of @angular/forms/signals waits for a check (${exported.length} exports read)`);

// 5. The real browser: real timers, real mouse and keyboard.
const e2e = run(process.execPath, ['e2e.mjs']);
report(e2e.code === 0, 'e2e.mjs ran in a real browser');
console.log(e2e.out.split('\n').filter((l) => !/ms {2}input$/.test(l)).join('\n'));
const results = JSON.parse(readFileSync('e2e-results.json', 'utf8'));

const at = (name, re) => results[name].timeline.find((m) => re.test(m.what));
const count = (name, re) => results[name].timeline.filter((m) => re.test(m.what)).length;
const seen = (name) => results[name].seen;
const during = (name) => results[name].during;

function noRequest(name, label) {
  report(count(name, /request left/) === 0, `${name}: ${label ?? 'no request left'}`);
}

{
  const n = 'default click taken';
  const req = at(n, /request left with "khaled"/);
  const ans = at(n, /check answered "khaled"/);
  report(req && req.t <= 30, `${n}: the request left straight after the click (${req?.t} ms)`);
  report(ans && ans.t >= 150, `${n}: the validator's answer came later (${ans?.t} ms)`);
  report(req && ans && req.t < ans.t, `${n}: the request left before the answer`);
  report(seen(n).error === 'That name is taken.' && seen(n).result === 'Sent.', `${n}: "Sent." with the error next to it`);
}
{
  const n = 'none click taken';
  noRequest(n);
  report(count(n, /onInvalid ran/) === 1 && seen(n).result === 'Not sent.', `${n}: onInvalid ran, "Not sent."`);
}
{
  const n = 'none click free';
  noRequest(n);
  report(count(n, /onInvalid ran/) === 1, `${n}: onInvalid ran with nothing wrong`);
  report(seen(n).error === null, `${n}: no error on the screen`);
  report(seen(n).result === 'Not sent.', `${n}: "Not sent."`);
  report(during(n).disabled === false, `${n}: the button stayed enabled`);
}
{
  const n = 'all click taken';
  const req = at(n, /request left with "khaled"/);
  const ans = at(n, /check answered "khaled"/);
  report(req && ans && req.t < ans.t, `${n}: the request left before the answer`);
}
for (const n of ['disabled click free human', 'disabled enter free human']) {
  report(during(n).disabled === true, `${n}: the button was disabled during the check`);
  report(count(n, /click$|submit event/) === 0, `${n}: no click and no submit event reached the app`);
  report(seen(n).disabled === false, `${n}: the button was enabled again afterwards`);
  noRequest(n);
}
noRequest('disabled enter free fast', 'disabled enter free fast: no request left, whatever the timing');
{
  const n = 'wait click taken';
  noRequest(n);
  const inv = at(n, /onInvalid ran/);
  const ans = at(n, /check answered "khaled"/);
  report(inv && ans && inv.t >= ans.t, `${n}: onInvalid ran after the answer`);
  report(seen(n).error === 'That name is taken.', `${n}: the error is on the screen`);
}
for (const n of ['wait click free', 'wait click free human', 'wait enter free']) {
  const req = at(n, /request left with "layla"/);
  const ans = at(n, /check answered "layla"/);
  report(req && ans && req.t >= ans.t, `${n}: the request left after the answer (${ans?.t} ms, ${req?.t} ms)`);
  report(seen(n).result === 'Sent.', `${n}: "Sent."`);
}
{
  const n = 'wait double click free';
  report(count(n, /request left/) === 1, `${n}: one request`);
  report(count(n, /ignored: already waiting/) === 1, `${n}: the second click was ignored`);
}
{
  const n = 'wait server says taken';
  report(seen(n).error === 'The server says that name is taken.' && seen(n).result === 'Not sent.', `${n}: the rejection shows on the field`);
}
{
  const n = 'recommended click taken';
  noRequest(n);
  report(seen(n).error === 'That name is taken.' && seen(n).result === 'Not sent.', `${n}: the error, and "Not sent."`);
}
for (const n of ['recommended click free', 'recommended enter free']) {
  const req = at(n, /request left with "layla"/);
  const ans = at(n, /check answered "layla"/);
  report(req && ans && req.t >= ans.t, `${n}: the request left after the answer (${ans?.t} ms, ${req?.t} ms)`);
  report(seen(n).result === 'Sent.', `${n}: "Sent."`);
}
{
  const n = 'recommended server says taken';
  report(seen(n).error === 'The server says that name is taken.' && seen(n).result === 'Not sent.', `${n}: the rejection shows on the field`);
}
{
  const n = 'validator debounce default enter taken';
  const req = at(n, /request left/);
  const start = at(n, /check started for "khaled"/);
  report(req && start && req.t < start.t && start.t >= 250, `${n}: the request left before the check started (${req?.t} ms, ${start?.t} ms)`);
}
{
  const n = 'validator debounce disabled click free';
  report(during(n).disabled === true, `${n}: the button was disabled during the debounce`);
  noRequest(n);
}
{
  const n = 'validator debounce none same task';
  const req = at(n, /request left with "khaled"/);
  const start = at(n, /check started for "khaled"/);
  report(req && start && req.t < start.t, `${n}: 'none' let it through before the debounce started (${req?.t} ms, ${start?.t} ms)`);
}
{
  const n = 'validator debounce wait same task';
  noRequest(n);
  const inv = at(n, /onInvalid ran/);
  const ans = at(n, /check answered "khaled"/);
  report(inv && ans && inv.t >= ans.t, `${n}: the wait held until after the answer`);
}
for (const n of ['validator debounce wait click taken', 'validator debounce wait enter taken']) {
  noRequest(n);
  const inv = at(n, /onInvalid ran/);
  const ans = at(n, /check answered "khaled"/);
  report(inv && ans && inv.t >= ans.t, `${n}: onInvalid ran after the answer`);
}
for (const n of ['field debounce default enter', 'field debounce none enter', 'field debounce wait enter', 'field debounce disabled enter']) {
  report(count(n, /request left with "layla"/) === 1, `${n}: the old value was sent`);
  report(seen(n).result === 'Sent.' && seen(n).error === 'That name is taken.', `${n}: "Sent." with the error next to it`);
}
report(during('field debounce disabled enter').disabled === false, 'field debounce disabled enter: the button was enabled during the debounce');
report(count('field debounce default click', /request left with "khaled"/) === 1, 'field debounce default click: blur wrote the new value first');
{
  const n = 'field debounce disabled click human';
  report(during(n).disabled === false, `${n}: the button was enabled when the press started`);
  report(count(n, /submit event/) === 0, `${n}: the press never submitted the form`);
}
{
  const n = 'field debounce wait flush enter';
  noRequest(n);
  const inv = at(n, /onInvalid ran/);
  const ans = at(n, /check answered "khaled"/);
  report(inv && ans && inv.t >= ans.t, `${n}: markAsTouched() first, then onInvalid after the answer`);
}

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
