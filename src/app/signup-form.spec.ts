// The recommended form, driven through its real template in jsdom.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignupForm } from './signup-form';

const CHECK_MS = 200;

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(0);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(0);
}

function setup() {
  const fixture = TestBed.createComponent(SignupForm);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const input = root.querySelector<HTMLInputElement>('#username')!;
  const button = root.querySelector<HTMLButtonElement>('#send')!;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const text = (selector: string) => root.querySelector(selector)?.textContent ?? null;
  return { fixture, input, button, type, text };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.timeline = [];
});
afterEach(() => vi.useRealTimers());

const requests = () => (window.timeline ?? []).filter((m) => m.what.startsWith('request left'));

describe('the recommended form', () => {
  it('keeps a click made during the check and sends after the answer', async () => {
    const { type, button, text } = setup();
    type('layla');
    await advance(10);

    button.click();
    await advance(0);
    expect(text('#checking')).toBe('Checking that name...');
    expect(button.disabled).toBe(false);
    expect(requests()).toEqual([]);

    await advance(CHECK_MS);
    expect(requests().map((m) => m.what)).toEqual(['request left with "layla"']);

    await advance(50);
    expect(text('#result')).toBe('Sent.');
  });

  it('sends nothing when the name is taken, and shows the error', async () => {
    const { type, button, text } = setup();
    type('khaled');
    await advance(10);

    button.click();
    await advance(CHECK_MS);
    await advance(0);

    expect(requests()).toEqual([]);
    expect(text('#error')).toBe('That name is taken.');
    expect(text('#result')).toBe('Not sent.');
  });

  it("puts the server's rejection on the field", async () => {
    const { type, button, text } = setup();
    type('raced');
    await advance(10);

    button.click();
    await advance(CHECK_MS);
    await advance(50);
    await advance(0);

    expect(requests().map((m) => m.what)).toEqual(['request left with "raced"']);
    expect(text('#error')).toBe('The server says that name is taken.');
    expect(text('#result')).toBe('Not sent.');
  });

  it('sends one request for a double click', async () => {
    const { type, button } = setup();
    type('layla');
    await advance(10);

    button.click();
    button.click();
    await advance(CHECK_MS);
    await advance(50);

    expect(requests()).toHaveLength(1);
  });
});
