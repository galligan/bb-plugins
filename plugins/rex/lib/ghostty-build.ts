// The libghostty-vt build vendored at vendor/ghostty-vt.wasm.
//
// Ghostty's `tip` release is rebuilt nightly, so a later download is a
// different build. This records the one that was vendored and tested. The
// struct layouts in frame-reader.ts and the snapshot format version in
// snapshot.ts belong to this build; revisit both when replacing the file.

export const GHOSTTY_VT_BUILD = {
  /** What `ghostty_version()` reports. */
  version: "1.1.0-dev+f28124c",
  sha256: "1f136e43e2243737d280f7f4d0ed51ae48256ddb66401ba2f7c0eb113b2ce489",
} as const;
