# angular-signal-forms-submit-pending-demo

Companion to the post **"How to make an Angular Signal Forms submit wait for its
async validator"**.

One username field, a validator that takes 200 ms to answer, one button. It runs
`submit()` while the check is still going, in each `ignoreValidators` mode, and
counts what ran. Then it tries the two ways out: disabling the button while the
form is pending, and holding the submit until the check has finished.

## What it proves

Angular 22.2.5. `src/app/submit-pending.spec.ts` and `src/app/signup-form.spec.ts`
use fake timers, so every number is exact. `e2e.mjs` repeats the cases that depend
on a browser, in real Edge, with real timers, a real mouse and a real keyboard.

A taken name, `submit()` called while the 200 ms check is running:

| `ignoreValidators` | action ran | `onInvalid` ran | returned | errors after the check |
| --- | --- | --- | --- | --- |
| default (not set) | 1 | 0 | `true` | `['taken']` |
| `'pending'` (the same as the default) | 1 | 0 | `true` | `['taken']` |
| `'none'` | 0 | 1 | `false` | `['taken']` |
| `'all'` | 1 | 0 | `true` | `['taken']` |

While the check runs: `pending()` is `true`, `valid()` and `invalid()` are both
`false`, and `errorSummary()` is empty.

- `'none'` with a free name still refuses. `onInvalid` runs, nothing is on the
  screen, the button stays enabled, and the request never leaves.
- A button bound to `[disabled]="f().pending() || f().submitting()"` blocks the
  click and Enter in Edge. The press is lost, so the user has to press again.
- `checksFinished()` (`src/app/checks-finished.ts`) followed by
  `submit(f, { ignoreValidators: 'none', ... })` keeps the click and the Enter key.
  A free name is sent after the answer. A taken name sends nothing.
- No export of `@angular/forms/signals` waits for a running check.
- The `debounce` option on `validateAsync` keeps `pending()` true during its
  window, from the next tick on.
- The `debounce()` rule on the field leaves `pending()` false and `valid()` true
  during its window, with the old value in the model.
- A rejection returned from the action lands on the field, and `submit()` returns
  `false`.

## Run it

```
npm ci
npm run check      # build, unit tests, then the browser run; every line must say PASS
npm start          # http://localhost:4200/?page=recommended
                   # http://localhost:4200/?strategy=default  (or none, all, disabled, wait)
```

The test bench also takes `&checkMs=200`, `&validatorDebounceMs=300`,
`&fieldDebounceMs=300`, `&start=name` and `&flush=1`. Type `khaled` for a taken
name, and `raced` for a name the check calls free and the server then rejects.

`e2e.mjs` needs Edge installed. Set `BROWSER_CHANNEL=chrome` to use Chrome. It closes
the browser in `finally`, which removes the temporary profile Playwright made.

## One browser run

Times are milliseconds from the click. They move by a few milliseconds per run;
`check.mjs` asserts the order and wide bounds, never the exact figure.

```
--- default click taken   (?strategy=default)
      0 ms  click
      0 ms  submit event
      1 ms  request left with "khaled"
     11 ms  check started for "khaled"
     55 ms  request answered
     55 ms  submit returned true
    227 ms  check answered "khaled": taken
  on screen: error="That name is taken." result="Sent."

--- recommended click free   (?page=recommended)
      0 ms  click
      0 ms  submit event
      1 ms  check started for "layla"
    209 ms  check answered "layla": free
    210 ms  request left with "layla"
    271 ms  request answered
  on screen: error=null result="Sent."
```

## Versions

| tool | version |
| --- | --- |
| `@angular/core`, `@angular/forms` | 22.2.5 |
| `@angular/cli`, `@angular/build` | 22.2.6 |
| TypeScript | 6.0.3 |
| Vitest | 5.1.0 |
| jsdom | 31.0.0 |
| playwright-core | 1.65.0 |
| Microsoft Edge | 157.0.4341.42 |
| Node.js | 26.1.0 |
| npm | 11.13.0 |

Run on Windows 11.

## What the post leaves out

- **A one-tick gap with the validator's `debounce` option.** Right after the write,
  and until the next tick, `pending()` is `false` and `valid()` is `true`, because
  the debounce is started by an effect. A click in the same script task gets
  through, even with `'none'` (`validator debounce none same task` in `e2e.mjs`).
  `checksFinished()` closes it, because its effect reads `pending()` in that tick.
  A person can't click inside it, but a script or a barcode reader could.
- **`[disabled]` lands with the next render.** In one early run, typing and pressing
  Enter within the same frame beat the render, and `'none'` was what refused the
  submit. Keep `'none'` behind a disabled button for that reason.
- **The `debounce()` rule and the mouse.** Pressing the mouse on the button blurs
  the input first. The blur writes the value and starts the check, so with a
  `pending()` button it turns grey during the press and the press never submits
  (`field debounce disabled click human`).
- **The `debounce()` rule and `submit()`.** `submit()` on the form calls
  `markAsTouched()` on the form. That marks the children touched, but it only
  writes the form's own pending value, and the form has none (see `flushSync` in
  `node.ts`). A field's waiting write stays waiting, so Enter sends the old value.
  `markAsTouched()` on the field first writes it (`&flush=1`).
- **The fake loader isn't cancelled.** `resource` drops the answer of a superseded
  check, but the timer inside `isTaken` still runs, so timelines can show an answer
  for a partial name like `"la"`. `httpResource` would cancel the request.
- **The validator uses `validateAsync`, not `validateHttp`.** That keeps the timing
  under the test's control. `validateHttp` is `validateAsync` with an `httpResource`
  behind it, so the `pending()` logic is the same code.
- **If the component is destroyed during the wait,** the promise never resolves and
  nothing is sent.
- **Two submits waiting at once** run one action. The second `submit()` finds the
  first one in progress and returns `false`.
- **`'none'` on its own stays right for a save nobody is waiting on,** like autosave.
  Skipping one is fine when the next one picks the change up.

## License

MIT.
