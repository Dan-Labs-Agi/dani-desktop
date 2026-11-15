// ascii-reveal listens on window when it is first imported; loading it here, before any test swaps window for a bare
// stub, keeps that stub from meeting it.
import "ascii-reveal";

// happy-dom has no 2D canvas, and the skeleton's shimmer draws on one: hand it a context that accepts every call.
if (typeof HTMLCanvasElement !== "undefined") {
  const anything: object = new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : anything), set: () => true, apply: () => anything });
  HTMLCanvasElement.prototype.getContext = (() => anything) as never;
}
