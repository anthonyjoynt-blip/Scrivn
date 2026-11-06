/**
 * A sketch to try the drop-a-sketch page with in development (2026-11-05): a bedroom with a closet
 * cut into one corner, drawn on graph paper the way an estimator sketches one, and what reading it
 * gives. Nothing ships it: the page offers it only outside production. The reading is
 * test/handSketch/fixtures/sample.model.json too, so "Read it for me" can be tried with no call.
 *
 * The numbers close: 9'3" plus the closet's 2'9" is the 12' across, and 3' plus 8'2" is the 11'2"
 * down, so the build holds every one of them.
 */
import type { HandSketchRead } from "./handSketch";

export const SAMPLE_SIZE = { width: 1050, height: 1400 };

export const SAMPLE_READ: HandSketchRead = {
  version: 1,
  kind: "hand",
  rotate: 0,
  ignored: [],
  rooms: [
    {
      name: null,
      guess: "bedroom",
      corners: [
        { x: 860, y: 330 },
        { x: 420, y: 330 },
        { x: 420, y: 560 },
        { x: 190, y: 560 },
        { x: 190, y: 1060 },
        { x: 860, y: 1060 },
      ],
      walls: [{ length: "9'3" }, { length: "3'" }, { length: "2'9" }, { length: "8'2" }, { length: "12'" }, { length: "11'2" }],
      ceiling: "8'",
      openings: [
        { kind: "window", wall: 0, at: 0.4545, size: "4' x 3'", orWall: null, sure: true },
        { kind: "door", wall: 4, at: 0.12, size: null, orWall: null, sure: true },
      ],
      items: [],
    },
    {
      name: null,
      guess: "closet",
      corners: [
        { x: 190, y: 330 },
        { x: 420, y: 330 },
        { x: 420, y: 560 },
        { x: 190, y: 560 },
      ],
      walls: [{ length: null }, { length: null }, { length: null }, { length: null }],
      ceiling: null,
      openings: [],
      items: [],
    },
  ],
};

/** The sample drawn: graph paper, the two rooms, the numbers by their walls. A JPEG, as a photo would come. */
export function drawSample(): { dataUrl: string; width: number; height: number } {
  const { width, height } = SAMPLE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas to draw the sample on.");
  ctx.fillStyle = "#f3f6fa";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#b8cbe3";
  ctx.lineWidth = 2;
  for (let x = 12; x < width; x += 46) line(ctx, x, 0, x, height);
  for (let y = 20; y < height; y += 46) line(ctx, 0, y, width, y);

  // The walls, a little unsteady, as a pen draws them.
  ctx.strokeStyle = "#1f1f1f";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  const pen = (pts: [number, number][]) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i] as [number, number];
      const [bx, by] = pts[i + 1] as [number, number];
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2 + (i % 2 ? 4 : -3), (ay + by) / 2 + (i % 2 ? -3 : 4), bx, by);
      ctx.stroke();
    }
  };
  pen([[176, 330], [870, 330], [860, 1060], [190, 1066], [190, 330]]);
  pen([[420, 330], [420, 560], [190, 560]]);
  // A window marked on the top wall, and a door at the bottom-left corner.
  ctx.lineWidth = 4;
  line(ctx, 550, 352, 570, 308);
  line(ctx, 750, 352, 770, 308);
  line(ctx, 250, 1060, 330, 982);

  ctx.fillStyle = "#1f1f1f";
  ctx.font = "italic 58px 'Segoe Print', 'Comic Sans MS', cursive";
  const say = (text: string, x: number, y: number) => ctx.fillText(text, x, y);
  say("4' x 3' window", 470, 280);
  say("9'3", 590, 400);
  say("3'", 440, 470);
  say("2'9", 245, 630);
  say("8'2", 210, 830);
  say("12'", 480, 1140);
  say("11'2", 700, 720);
  say("8' C", 480, 860);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), width, height };
}

function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}
