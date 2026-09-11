import Svg, { Path, Rect } from 'react-native-svg';

// "Plan an Activity": a calendar with a plus inside, in a lighter weight than
// the Material calendar-today glyph used elsewhere, at the same proportions.
//
// Drawn on an 84-unit grid, which is 28px on a 3x iPhone screen: one unit is
// exactly one device pixel. Every edge below is a whole number, so nothing
// lands between pixels and blurs. That's why the grid is 84 and not the usual
// 24; a 24-grid icon at 28px puts edges on half-pixels. Render it at 28.
//
// Geometry, all in device pixels:
//   body     x 7-77, y 11-80, 4px walls, corner radius 6 outside / 2 inside
//   header   solid band y 11-32 like the original glyph's (depth ~8/24)
//   rings    4px posts centred where the glyph's rings sit (x 21 and 63)
//   plus     4px bars, 20px across, centred in the space under the header
//            (x 42, y 54), leaving 12px clear above and below and 21 either side
const R_OUT = 6;
const R_IN = 2;

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}`
    + `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`
    + `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

// Outer outline minus the inside, cut out with evenodd, gives the 4px walls.
const BODY = roundedRect(7, 11, 70, 69, R_OUT) + roundedRect(11, 15, 62, 61, R_IN);

export function CalendarAddIcon({ size = 28, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 84 84">
      <Path d={BODY} fill={color} fillRule="evenodd" />
      <Rect x={11} y={15} width={62} height={17} fill={color} />
      <Rect x={19} y={3} width={4} height={12} fill={color} />
      <Rect x={61} y={3} width={4} height={12} fill={color} />
      <Rect x={40} y={44} width={4} height={20} fill={color} />
      <Rect x={32} y={52} width={20} height={4} fill={color} />
    </Svg>
  );
}
