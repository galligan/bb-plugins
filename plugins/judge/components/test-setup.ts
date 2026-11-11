// jsdom does not perform layout; live host checks cover sizing. Radix's
// form-control observer and pointer handling still need these browser
// interfaces to mount in behavior tests.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView = function () {};
HTMLElement.prototype.hasPointerCapture = function () {
  return false;
};
