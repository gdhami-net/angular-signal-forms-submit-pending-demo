// What submit() does while an async validator is running. Angular 22.2.5.
// Time is faked so every number below is exact. e2e.mjs repeats the important
// cases in a real browser, with real timers and a real mouse and keyboard.
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree, form, submit } from '@angular/forms/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checksFinished } from './checks-finished';
import { Signup, SignupOptions, signupSchema } from './signup';

const CHECK_MS = 200;

function build(options: SignupOptions = {}, start = '') {
  const model = signal<Signup>({ username: start });
  const f = TestBed.runInInjectionContext(() => form(model, signupSchema(options)));
  return { model, f };
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(0);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(0);
}

const kinds = (f: FieldTree<Signup>) => f().errorSummary().map((e) => e.kind);

function counters() {
  const seen = { actions: 0, invalids: 0, sent: [] as string[] };
  return seen;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('submit() while a 200 ms check is running, name already taken', () => {
  const MODES = [
    { name: 'default', extra: {}, actions: 1, invalids: 0, returned: true },
    { name: "'pending'", extra: { ignoreValidators: 'pending' as const }, actions: 1, invalids: 0, returned: true },
    { name: "'none'", extra: { ignoreValidators: 'none' as const }, actions: 0, invalids: 1, returned: false },
    { name: "'all'", extra: { ignoreValidators: 'all' as const }, actions: 1, invalids: 0, returned: true },
  ];

  for (const mode of MODES) {
    it(`${mode.name}: action ${mode.actions}, onInvalid ${mode.invalids}, returns ${mode.returned}`, async () => {
      const { f } = build({ checkMs: CHECK_MS });
      f.username().value.set('khaled');
      TestBed.tick();
      const seen = counters();

      const returned = await submit(f, {
        action: async () => {
          seen.actions++;
          return undefined;
        },
        onInvalid: () => {
          seen.invalids++;
        },
        ...mode.extra,
      });

      // The action has run or been refused, and the check still hasn't answered.
      expect(f().pending()).toBe(true);
      expect(kinds(f)).toEqual([]);

      await advance(CHECK_MS);

      console.log(
        `RESULT mode=${mode.name} action=${seen.actions} onInvalid=${seen.invalids} returned=${returned} errorsAfter=${JSON.stringify(kinds(f))}`,
      );
      expect(seen.actions).toBe(mode.actions);
      expect(seen.invalids).toBe(mode.invalids);
      expect(returned).toBe(mode.returned);
      expect(kinds(f)).toEqual(['taken']);
    });
  }

  it("default: the action starts before the validator's answer", async () => {
    const order: string[] = [];
    const { f } = build({ checkMs: CHECK_MS, onCheckAnswered: () => order.push('answer') });
    f.username().value.set('khaled');
    TestBed.tick();

    await submit(f, {
      action: async () => {
        order.push('action');
        return undefined;
      },
    });
    await advance(CHECK_MS);

    expect(order).toEqual(['action', 'answer']);
  });

  it("'none' refuses even when the name turns out to be free", async () => {
    const { f } = build({ checkMs: CHECK_MS });
    f.username().value.set('layla');
    TestBed.tick();
    const seen = counters();

    const returned = await submit(f, {
      ignoreValidators: 'none',
      action: async () => {
        seen.actions++;
        return undefined;
      },
      onInvalid: () => {
        seen.invalids++;
      },
    });

    expect(returned).toBe(false);
    expect(seen.invalids).toBe(1);
    expect(f.username().errors()).toEqual([]);

    await advance(CHECK_MS);

    expect(seen.actions).toBe(0);
    expect(f().valid()).toBe(true);
    expect(f.username().errors()).toEqual([]);
  });

  it('a sync error still stops the default mode, and not the all mode', async () => {
    const { f } = build({ checkMs: CHECK_MS });
    const seen = counters();
    const options = {
      action: async () => {
        seen.actions++;
        return undefined;
      },
      onInvalid: () => {
        seen.invalids++;
      },
    };

    expect(await submit(f, options)).toBe(false);
    expect(seen).toMatchObject({ actions: 0, invalids: 1 });

    expect(await submit(f, { ...options, ignoreValidators: 'all' })).toBe(true);
    expect(seen).toMatchObject({ actions: 1, invalids: 1 });
  });
});

describe('the state of the form during the check', () => {
  it('is neither valid nor invalid while the check runs', async () => {
    const { f } = build({ checkMs: CHECK_MS });
    f.username().value.set('khaled');

    // Straight after the write, without waiting for anything.
    console.log(
      `RESULT during pending=${f().pending()} valid=${f().valid()} invalid=${f().invalid()} errors=${JSON.stringify(kinds(f))}`,
    );
    expect(f().pending()).toBe(true);
    expect(f().valid()).toBe(false);
    expect(f().invalid()).toBe(false);
    expect(kinds(f)).toEqual([]);

    TestBed.tick();
    expect(f().pending()).toBe(true);
    expect(f().valid()).toBe(false);
    expect(f().invalid()).toBe(false);

    await advance(CHECK_MS);

    console.log(
      `RESULT after pending=${f().pending()} valid=${f().valid()} invalid=${f().invalid()} errors=${JSON.stringify(kinds(f))}`,
    );
    expect(f().pending()).toBe(false);
    expect(f().valid()).toBe(false);
    expect(f().invalid()).toBe(true);
    expect(kinds(f)).toEqual(['taken']);
  });
});

describe('the debounce option on the validator', () => {
  async function settled(options: SignupOptions) {
    const built = build(options, 'free');
    TestBed.tick();
    await advance(1000);
    return built;
  }

  it('is pending during the debounce window, from the next tick on', async () => {
    const started: string[] = [];
    const { f } = await settled({ checkMs: CHECK_MS, validatorDebounceMs: 300, onCheckStarted: (n) => started.push(n) });
    started.length = 0;

    f.username().controlValue.set('khaled');

    // One tick where the form still looks valid.
    expect(f().pending()).toBe(false);
    expect(f().valid()).toBe(true);

    TestBed.tick();
    expect(f().pending()).toBe(true);
    expect(f().valid()).toBe(false);
    expect(started).toEqual([]);

    await advance(299);
    expect(f().pending()).toBe(true);
    expect(started).toEqual([]);

    await advance(1);
    expect(started).toEqual(['khaled']);
    expect(f().pending()).toBe(true);

    await advance(CHECK_MS);
    expect(f().pending()).toBe(false);
    expect(kinds(f)).toEqual(['taken']);
  });

  it('does not stop the default submit, which runs before the check has even started', async () => {
    const order: string[] = [];
    const { f } = await settled({ checkMs: CHECK_MS, validatorDebounceMs: 300, onCheckStarted: () => order.push('check') });
    order.length = 0;

    f.username().controlValue.set('khaled');
    TestBed.tick();
    await submit(f, {
      action: async () => {
        order.push('action');
        return undefined;
      },
    });
    await advance(300 + CHECK_MS);

    expect(order).toEqual(['action', 'check']);
  });
});

describe('the debounce() rule on the field', () => {
  async function typedDuringWindow() {
    const started: string[] = [];
    const built = build({ checkMs: CHECK_MS, fieldDebounceMs: 300, onCheckStarted: (n) => started.push(n) }, 'free');
    TestBed.tick();
    await advance(1000);
    started.length = 0;
    built.f.username().controlValue.set('khaled');
    TestBed.tick();
    await advance(100);
    return { ...built, started };
  }

  it('leaves the form valid and not pending during the window, with the old value in the model', async () => {
    const { f, started } = await typedDuringWindow();

    console.log(
      `RESULT fieldDebounce value=${f.username().value()} control=${f.username().controlValue()} pending=${f().pending()} valid=${f().valid()}`,
    );
    expect(f.username().value()).toBe('free');
    expect(f.username().controlValue()).toBe('khaled');
    expect(f().pending()).toBe(false);
    expect(f().valid()).toBe(true);
    expect(started).toEqual([]);
  });

  for (const ignoreValidators of ['pending', 'none'] as const) {
    it(`submit on the root sends the old value (${ignoreValidators})`, async () => {
      const { f } = await typedDuringWindow();
      const seen = counters();

      const returned = await submit(f, {
        ignoreValidators,
        action: async () => {
          seen.actions++;
          seen.sent.push(f.username().value());
          return undefined;
        },
      });

      expect(returned).toBe(true);
      expect(seen.actions).toBe(1);
      expect(seen.sent).toEqual(['free']);
    });
  }

  it('markAsTouched() on the field writes the new value and starts the check', async () => {
    const { f, started } = await typedDuringWindow();

    f.username().markAsTouched();

    expect(f.username().value()).toBe('khaled');
    expect(f().pending()).toBe(true);
    TestBed.tick();
    await advance(0);
    expect(started).toEqual(['khaled']);
  });
});

describe('waiting for checksFinished() and then submitting', () => {
  function sendAfterCheck(f: FieldTree<Signup>, action: () => Promise<unknown>, onInvalid?: () => void) {
    const injector = TestBed.inject(Injector);
    return (async () => {
      await checksFinished(f, injector);
      return submit(f, { ignoreValidators: 'none', action: action as () => Promise<undefined>, onInvalid });
    })();
  }

  it('sends nothing when the check says the name is taken', async () => {
    const { f } = build({ checkMs: CHECK_MS });
    f.username().value.set('khaled');
    TestBed.tick();
    const seen = counters();

    const done = sendAfterCheck(
      f,
      async () => {
        seen.actions++;
        return undefined;
      },
      () => seen.invalids++,
    );

    await advance(CHECK_MS - 1);
    expect(seen).toMatchObject({ actions: 0, invalids: 0 });

    await advance(1);
    expect(await done).toBe(false);
    expect(seen).toMatchObject({ actions: 0, invalids: 1 });
    expect(kinds(f)).toEqual(['taken']);
  });

  it('sends once the check says the name is free, and after the answer', async () => {
    const order: string[] = [];
    const { f } = build({ checkMs: CHECK_MS, onCheckAnswered: () => order.push('answer') });
    f.username().value.set('layla');
    TestBed.tick();

    const done = sendAfterCheck(f, async () => {
      order.push('action');
      return undefined;
    });

    await advance(CHECK_MS);
    expect(await done).toBe(true);
    expect(order).toEqual(['answer', 'action']);
  });

  it('goes straight through when no check is running', async () => {
    const { f } = build({ checkMs: CHECK_MS }, 'layla');
    TestBed.tick();
    await advance(CHECK_MS);
    let actions = 0;

    const done = sendAfterCheck(f, async () => {
      actions++;
      return undefined;
    });

    await advance(0);
    expect(await done).toBe(true);
    expect(actions).toBe(1);
  });

  it('closes the one-tick gap of the validator debounce', async () => {
    const { f } = build({ checkMs: CHECK_MS, validatorDebounceMs: 300 }, 'free');
    TestBed.tick();
    await advance(1000);
    const seen = counters();

    f.username().controlValue.set('khaled');
    expect(f().valid()).toBe(true);

    const done = sendAfterCheck(
      f,
      async () => {
        seen.actions++;
        return undefined;
      },
      () => seen.invalids++,
    );

    // The next tick starts the debounce. The wait must still be holding here,
    // and nothing may have been refused yet.
    TestBed.tick();
    expect(f().pending()).toBe(true);
    await advance(299);
    expect(seen).toMatchObject({ actions: 0, invalids: 0 });

    await advance(1);
    await advance(CHECK_MS);
    expect(await done).toBe(false);
    expect(seen).toMatchObject({ actions: 0, invalids: 1 });
  });

  it('checks the newest value when the user edits during the wait', async () => {
    const { f } = build({ checkMs: CHECK_MS });
    f.username().value.set('khaled');
    TestBed.tick();
    const seen = counters();

    const done = sendAfterCheck(f, async () => {
      seen.sent.push(f.username().value());
      return undefined;
    });

    await advance(100);
    f.username().value.set('layla');
    TestBed.tick();
    await advance(CHECK_MS - 1);
    expect(seen.sent).toEqual([]);

    await advance(1);
    expect(await done).toBe(true);
    expect(seen.sent).toEqual(['layla']);
  });

  it('runs one action for two submits waiting at the same time', async () => {
    const { f } = build({ checkMs: CHECK_MS });
    f.username().value.set('layla');
    TestBed.tick();
    let actions = 0;
    const action = () =>
      new Promise<undefined>((done) => {
        actions++;
        setTimeout(() => done(undefined), 50);
      });

    const first = sendAfterCheck(f, action);
    const second = sendAfterCheck(f, action);

    await advance(CHECK_MS);
    await advance(50);
    expect(await Promise.all([first, second])).toEqual([true, false]);
    expect(actions).toBe(1);
  });

  it("puts the server's rejection on the field and returns false", async () => {
    const { f } = build({ checkMs: CHECK_MS });
    f.username().value.set('layla');
    TestBed.tick();

    const done = sendAfterCheck(f, async () => ({
      kind: 'taken',
      message: 'The server says that name is taken.',
      fieldTree: f.username,
    }));

    await advance(CHECK_MS);
    expect(await done).toBe(false);
    expect(f.username().errors().map((e) => e.message)).toEqual(['The server says that name is taken.']);
    expect(f().submitting()).toBe(false);
  });
});
