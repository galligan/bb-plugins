// Turns a browser key press into the key Rex expects.
//
// Rex names a physical key after its W3C `KeyboardEvent.code` in snake_case
// and wants, beside it, the text the key typed, the modifiers held, and which
// of those the keyboard layout used up to produce the text. Rex's terminal
// encodes the key from these the way Rex.app's keys are encoded.

import type { RexKey } from "./pane-input.ts";

/** The fields of a DOM `KeyboardEvent` this reads. */
export interface DomKey {
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  capsLock: boolean;
  numLock: boolean;
}

/** The key names Rex documents for `client.key`, besides `unidentified`. */
const REX_KEYS = new Set(
  `backquote backslash bracket_left bracket_right comma digit_0 digit_1 digit_2
  digit_3 digit_4 digit_5 digit_6 digit_7 digit_8 digit_9 equal intl_backslash
  intl_ro intl_yen key_a key_b key_c key_d key_e key_f key_g key_h key_i key_j
  key_k key_l key_m key_n key_o key_p key_q key_r key_s key_t key_u key_v key_w
  key_x key_y key_z minus period quote semicolon slash alt_left alt_right
  backspace caps_lock context_menu control_left control_right enter meta_left
  meta_right shift_left shift_right space tab convert kana_mode non_convert
  delete end help home insert page_down page_up arrow_down arrow_left
  arrow_right arrow_up num_lock numpad_0 numpad_1 numpad_2 numpad_3 numpad_4
  numpad_5 numpad_6 numpad_7 numpad_8 numpad_9 numpad_add numpad_backspace
  numpad_clear numpad_clear_entry numpad_comma numpad_decimal numpad_divide
  numpad_enter numpad_equal numpad_memory_add numpad_memory_clear
  numpad_memory_recall numpad_memory_store numpad_memory_subtract
  numpad_multiply numpad_paren_left numpad_paren_right numpad_subtract
  numpad_separator numpad_up numpad_down numpad_right numpad_left numpad_begin
  numpad_home numpad_end numpad_insert numpad_delete numpad_page_up
  numpad_page_down escape f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 f13 f14 f15
  f16 f17 f18 f19 f20 f21 f22 f23 f24 f25 fn fn_lock print_screen scroll_lock
  pause browser_back browser_favorites browser_forward browser_home
  browser_refresh browser_search browser_stop eject launch_app_1 launch_app_2
  launch_mail media_play_pause media_select media_stop media_track_next
  media_track_previous power sleep audio_volume_down audio_volume_mute
  audio_volume_up wake_up copy cut paste`.split(/\s+/),
);

/** Keys that only change what other keys do. They are not sent on their own. */
const MODIFIER_KEYS = new Set([
  "alt_left",
  "alt_right",
  "caps_lock",
  "control_left",
  "control_right",
  "fn",
  "fn_lock",
  "meta_left",
  "meta_right",
  "num_lock",
  "scroll_lock",
  "shift_left",
  "shift_right",
]);

/** What each key types without shift on a US layout, by Rex key name. */
const US_UNSHIFTED = new Map<string, string>([
  ["backquote", "`"],
  ["backslash", "\\"],
  ["bracket_left", "["],
  ["bracket_right", "]"],
  ["comma", ","],
  ["equal", "="],
  ["minus", "-"],
  ["period", "."],
  ["quote", "'"],
  ["semicolon", ";"],
  ["slash", "/"],
  ["space", " "],
]);

/** The Rex name for a `KeyboardEvent.code`, such as `key_a` for `KeyA`. */
export function rexKeyName(code: string): string {
  const name = /^F\d+$/.test(code)
    ? code.toLowerCase()
    : code
        .replace(/([a-z])([A-Z0-9])/g, "$1_$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
        .toLowerCase();
  return REX_KEYS.has(name) ? name : "unidentified";
}

function usUnshifted(name: string): string | undefined {
  const letterOrDigit = /^(?:key|digit)_([a-z0-9])$/.exec(name)?.[1];
  return letterOrDigit ?? US_UNSHIFTED.get(name);
}

/** The one printable character `key` holds, or null for a named key. */
function typedCharacter(key: string): string | null {
  const [first, ...rest] = [...key];
  if (first === undefined || rest.length > 0) return null;
  const code = first.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f ? null : first;
}

/**
 * Whether the terminal takes a key press, or the app keeps it.
 *
 * Command combinations stay with bb and the browser. That includes copy and
 * paste, which reach the terminal as clipboard events, not as keys. Everything
 * else, Ctrl combinations included, goes to the terminal.
 */
export function terminalTakesKey(event: Pick<DomKey, "metaKey">): boolean {
  return !event.metaKey;
}

/**
 * Builds the Rex key for a key press. Returns null for a press that sends
 * nothing: a modifier on its own, a dead key, or a key that is part of an
 * unfinished composition.
 */
export function keyFromDom(event: DomKey): RexKey | null {
  if (event.isComposing || event.key === "Dead" || event.key === "Process") {
    return null;
  }
  const name = rexKeyName(event.code);
  if (MODIFIER_KEYS.has(name)) return null;

  const typed = typedCharacter(event.key);
  const base = usUnshifted(name);
  // With Ctrl held the key is a control combination, not text.
  const text = typed !== null && !event.ctrlKey ? typed : "";
  if (name === "unidentified" && text === "") return null;

  // On a Mac, Option types another character, such as å. The layout used Alt
  // up to make it. Where Alt leaves the character alone, it stays a modifier.
  const altMadeText =
    event.altKey &&
    text !== "" &&
    text.toLowerCase() !== (base ?? "").toLowerCase();
  const consumed = [
    event.shiftKey && text !== "" ? "shift" : "",
    altMadeText ? "alt" : "",
  ];

  return {
    key: name,
    mods: joinMods([
      event.shiftKey ? "shift" : "",
      event.ctrlKey ? "ctrl" : "",
      event.altKey ? "alt" : "",
      event.metaKey ? "super" : "",
      event.capsLock ? "caps_lock" : "",
      event.numLock ? "num_lock" : "",
    ]),
    consumed_mods: joinMods(consumed),
    text,
    unshifted_codepoint: unshiftedCodepoint(event, typed, base),
    composing: false,
    action: event.repeat ? "repeat" : "press",
  };
}

function joinMods(mods: string[]): string {
  return mods.filter((mod) => mod !== "").join("+");
}

/**
 * The code point the key types without shift, which Rex matches control
 * combinations on. It follows the keyboard layout where the browser shows
 * what the layout typed, and falls back to the US layout elsewhere.
 */
function unshiftedCodepoint(
  event: DomKey,
  typed: string | null,
  base: string | undefined,
): number {
  if (typed !== null && !event.altKey) {
    const lower = typed.toLowerCase();
    const isLetter = lower !== typed.toUpperCase();
    if (!event.shiftKey || isLetter) return lower.codePointAt(0) ?? 0;
  }
  return base?.codePointAt(0) ?? 0;
}
