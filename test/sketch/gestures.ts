import type Konva from "konva";

/**
 * Driving pointer gestures at a Konva stage from a test.
 *
 * Three things about this are non-obvious, and each one cost a round of debugging. They are the
 * reason this file exists rather than the tests dispatching events themselves.
 *
 * 1. Events go to the CANVAS, never to `window`. Konva reads the pointer position from the stage's
 *    own listener on its container, so a `mousemove` dispatched at `window` promotes the drag but
 *    leaves the pointer where it was — the node "drags" without moving. A stray `mouseup` at
 *    `window` is worse: it corrupts Konva's drag bookkeeping so only the first press of a run works
 *    and every later one silently does nothing.
 *
 * 2. A drag needs TWO moves. `Konva.dragDistance` is 3, so the first qualifying move only promotes
 *    the gesture past the threshold; the second is the one that translates anything.
 *
 * 3. The hit canvas is redrawn by hand. Konva repaints inside `requestAnimationFrame`, which the
 *    browser pauses whenever the page is hidden — as it is when these run in a background tab. The
 *    scene then keeps hit-testing against wherever things were BEFORE the last drag, so probes at
 *    correct coordinates miss and the failure looks like a bug in the code under test.
 */

export interface Gesture {
  /** Press at a world point, move by (dx, dy), release. */
  drag(world: { x: number; y: number }, dx: number, dy: number): void;
  /** Press and release at a world point without moving — a tap. */
  tap(world: { x: number; y: number }): void;
}

export function gesturesFor(stage: Konva.Stage): Gesture {
  const container = stage.container();
  const canvas = () => container.querySelector("canvas");

  function send(type: string, clientX: number, clientY: number) {
    const target = canvas();
    if (!target) throw new Error("stage has no canvas");
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 }));
  }

  /** World coordinates to client coordinates, honouring the stage's own pan and zoom. */
  function toClient(world: { x: number; y: number }) {
    const box = container.getBoundingClientRect();
    const t = stage.getAbsoluteTransform().copy().point(world);
    return { x: box.left + t.x, y: box.top + t.y };
  }

  function settle() {
    // See note 3. drawHit is synchronous; batchDraw would wait for a frame that never comes.
    stage.getLayers().forEach((layer) => layer.drawHit());
  }

  return {
    drag(world, dx, dy) {
      settle();
      const p = toClient(world);
      send("mousedown", p.x, p.y);
      send("mousemove", p.x + Math.sign(dx) * 5, p.y + Math.sign(dy) * 5); // note 2
      send("mousemove", p.x + dx, p.y + dy);
      send("mouseup", p.x + dx, p.y + dy);
      settle();
    },
    tap(world) {
      settle();
      const p = toClient(world);
      send("mousedown", p.x, p.y);
      send("mouseup", p.x, p.y);
      settle();
    },
  };
}
