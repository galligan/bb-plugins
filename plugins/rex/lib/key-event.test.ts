import assert from "node:assert/strict";
import { test } from "node:test";

import {
  arrowKey,
  keyFromDom,
  rexKeyName,
  terminalTakesKey,
  type DomKey,
} from "./key-event.ts";

function dom(
  code: string,
  key: string,
  overrides: Partial<DomKey> = {},
): DomKey {
  return {
    code,
    key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

test("names keys the way Rex does", () => {
  const names: [string, string][] = [
    ["KeyA", "key_a"],
    ["Digit1", "digit_1"],
    ["Enter", "enter"],
    ["ArrowUp", "arrow_up"],
    ["BracketLeft", "bracket_left"],
    ["IntlBackslash", "intl_backslash"],
    ["IntlRo", "intl_ro"],
    ["PageDown", "page_down"],
    ["F1", "f1"],
    ["F12", "f12"],
    ["Numpad0", "numpad_0"],
    ["NumpadEnter", "numpad_enter"],
    ["NumpadParenLeft", "numpad_paren_left"],
    ["ShiftLeft", "shift_left"],
    ["MetaRight", "meta_right"],
    ["AudioVolumeUp", "audio_volume_up"],
    ["LaunchApp1", "launch_app_1"],
    ["MediaPlayPause", "media_play_pause"],
    ["Backquote", "backquote"],
  ];
  for (const [code, name] of names) assert.equal(rexKeyName(code), name, code);
});

test("calls a key Rex has no name for unidentified", () => {
  assert.equal(rexKeyName(""), "unidentified");
  assert.equal(rexKeyName("Lang1"), "unidentified");
  assert.equal(rexKeyName("Unidentified"), "unidentified");
});

test("sends a letter with its text", () => {
  assert.deepEqual(keyFromDom(dom("KeyN", "n")), {
    key: "key_n",
    mods: "",
    consumed_mods: "",
    text: "n",
    unshifted_codepoint: 110,
    composing: false,
    action: "press",
  });
});

test("marks shift as used up by the text it made", () => {
  const capital = keyFromDom(dom("KeyK", "K", { shiftKey: true }));
  assert.deepEqual(
    [
      capital?.mods,
      capital?.consumed_mods,
      capital?.text,
      capital?.unshifted_codepoint,
    ],
    ["shift", "shift", "K", 107],
  );
  const bang = keyFromDom(dom("Digit1", "!", { shiftKey: true }));
  assert.deepEqual(
    [bang?.consumed_mods, bang?.text, bang?.unshifted_codepoint],
    ["shift", "!", 49],
  );
});

test("sends a Ctrl combination with no text, for Rex to encode", () => {
  const interrupt = keyFromDom(dom("KeyC", "c", { ctrlKey: true }));
  assert.deepEqual(interrupt, {
    key: "key_c",
    mods: "ctrl",
    consumed_mods: "",
    text: "",
    unshifted_codepoint: 99,
    composing: false,
    action: "press",
  });
  const shifted = keyFromDom(
    dom("KeyC", "C", { ctrlKey: true, shiftKey: true }),
  );
  assert.deepEqual(
    [shifted?.mods, shifted?.consumed_mods, shifted?.unshifted_codepoint],
    ["shift+ctrl", "", 99],
  );
});

test("follows the layout for the unshifted character where the browser shows it", () => {
  // The physical C key on a Dvorak layout types j.
  const dvorak = keyFromDom(dom("KeyC", "j", { ctrlKey: true }));
  assert.equal(dvorak?.unshifted_codepoint, 106);
});

test("sends named keys without text", () => {
  for (const [code, key, name] of [
    ["Enter", "Enter", "enter"],
    ["Tab", "Tab", "tab"],
    ["Escape", "Escape", "escape"],
    ["Backspace", "Backspace", "backspace"],
    ["ArrowLeft", "ArrowLeft", "arrow_left"],
    ["F5", "F5", "f5"],
    ["Delete", "Delete", "delete"],
  ] as const) {
    const sent = keyFromDom(dom(code, key));
    assert.deepEqual([sent?.key, sent?.text], [name, ""], code);
  }
  assert.deepEqual(keyFromDom(dom("Space", " "))?.text, " ");
  assert.equal(keyFromDom(dom("Space", " "))?.unshifted_codepoint, 32);
});

test("treats Option as part of the text when it changed the character", () => {
  const composed = keyFromDom(dom("KeyA", "å", { altKey: true }));
  assert.deepEqual(
    [
      composed?.mods,
      composed?.consumed_mods,
      composed?.text,
      composed?.unshifted_codepoint,
    ],
    ["alt", "alt", "å", 97],
  );
});

test("keeps Alt a modifier when it left the character alone", () => {
  const meta = keyFromDom(dom("KeyB", "b", { altKey: true }));
  assert.deepEqual(
    [meta?.mods, meta?.consumed_mods, meta?.text],
    ["alt", "", "b"],
  );
  const arrow = keyFromDom(dom("ArrowLeft", "ArrowLeft", { altKey: true }));
  assert.deepEqual(
    [arrow?.key, arrow?.mods, arrow?.consumed_mods, arrow?.text],
    ["arrow_left", "alt", "", ""],
  );
});

test("lists held modifiers in Rex's order, with the locks", () => {
  const sent = keyFromDom(
    dom("ArrowUp", "ArrowUp", {
      shiftKey: true,
      ctrlKey: true,
      altKey: true,
      capsLock: true,
      numLock: true,
    }),
  );
  assert.equal(sent?.mods, "shift+ctrl+alt+caps_lock+num_lock");
});

test("reports a held key as a repeat", () => {
  assert.equal(
    keyFromDom(dom("KeyX", "x", { repeat: true }))?.action,
    "repeat",
  );
});

test("sends nothing for a modifier on its own, a dead key, or composition", () => {
  assert.equal(keyFromDom(dom("ShiftLeft", "Shift", { shiftKey: true })), null);
  assert.equal(
    keyFromDom(dom("ControlLeft", "Control", { ctrlKey: true })),
    null,
  );
  assert.equal(keyFromDom(dom("MetaLeft", "Meta", { metaKey: true })), null);
  assert.equal(keyFromDom(dom("CapsLock", "CapsLock")), null);
  assert.equal(keyFromDom(dom("Backquote", "Dead")), null);
  assert.equal(keyFromDom(dom("KeyA", "a", { isComposing: true })), null);
  assert.equal(keyFromDom(dom("KeyA", "Process")), null);
  assert.equal(keyFromDom(dom("", "Unidentified")), null);
});

test("still sends text from a key Rex has no name for", () => {
  const sent = keyFromDom(dom("", "é"));
  assert.deepEqual([sent?.key, sent?.text], ["unidentified", "é"]);
});

test("leaves Command combinations to the app and takes everything else", () => {
  assert.equal(terminalTakesKey({ metaKey: true }), false);
  assert.equal(terminalTakesKey({ metaKey: false }), true);
});

test("makes the plain arrow key the wheel sends a full-screen program", () => {
  assert.deepEqual(arrowKey("up"), keyFromDom(dom("ArrowUp", "ArrowUp")));
  assert.deepEqual(arrowKey("down"), keyFromDom(dom("ArrowDown", "ArrowDown")));
});
