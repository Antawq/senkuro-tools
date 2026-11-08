import type { PosterCell } from './poster-layout';

export const SHARD_LIGHT_STROKE = '#F1F1F1A1';
export const SHARD_DARK_STROKE = '#111113';
export const SHARD_STROKE_RATIO = 0.02;

const R_CRACKS = [
  'M0 .322H.231V.293H.388L.378.253.487.308.439.182H.539L.454.116H.547L.498.052.487 0',
  'M0 .335.146.386H.549L.621.333H.727V.23L.682.158.580.139H.685L.56.078.63.048.55 0',
  'M0 .355.145.428.571.403.626.359.765.344.898.198.842.154H.879L.838.047.887 0',
  'M0 .399.151.465.428.465.57.441.639.397.753.428.932.428 1 .438',
  'M0 .935.140.665.209.5H.566L.648.43.76.471H.95L1 .504',
  'M.05 1 .17.707.367.669.434.545.532.593.675.658.757.541.954.541.99.595',
  'M.248 1 .300.744.440.7.480.621.620.686.78.67.881.622 1 .716',
  'M.289 1 .441.841.545.761.587.702.808.702.892.688.949.777 1 .797',
  'M.345 1 .661.810.683.750.759.728.836.752.900.750.940.831 1 .848',
  'M.390 1 .706.865.74.801.816.806.869.831.915.908 1 .935',
  'M.460 1 .541.985.766.95.832.909.867.93.915.985 1 .99',
] as const;

export const SHARD_CRACKS: Readonly<Record<string, readonly string[]>> = {
  D: ['M0 .68.09.61.22.65.33.56.61.59.610.43.75.57.81.5.9.55 1 .48'],
  C: [
    'M0 .54.08.52.15.55.33.47.54.52.641.421.83.396.56.307.629.25.486.186H.576L.496.026.58 0',
    'M0 .54.08.52.15.55.33.47.54.52.641.42.8.4 1 .42',
    'M0 .54.08.52.15.55.33.47.528.52.45.745.965 1',
  ],
  B: [
    'M0 .466.331.465.375.318.470.29.340.172.375.16.375.013.453 0',
    'M0 .467.32.466.555.500.584.418.725.418.690.306.835.305.725.211.835.056 1 .036',
    'M0 .464.321.464.546.503.777.488.940.505.965.390 1 .415',
    'M0 .464.32.464.536.501.557.617.458.704.717.789.673.85.618.970.745 1',
    'M0 .491.178.656.177.803.27.848.175.990.22 1',
  ],
  A: [
    'M0 .373.195.329.194 .232.33.232.328.167.450.150.430.069.523 0',
    'M0 .373.188.330.413.349.553.33.685.256.600.196.699.165.679.115.800.095.800.01.81 0',
    'M0 .374.188.331.411.349.594.379.733.331.861.349.97.349 1 .367',
    'M0 .374.188.331.405.349.558.556.678.556.744.636.884.636.965.663 1 .667',
    'M0 .374.178.334.207.547.349.609.455.61.455.659.647.687.648.747.772.714.894.742 1 .751',
    'M0 .832.052.832.175.754.341.754.478.773.658.743.772.714.894.743 1 .75',
    'M.418 1 .590.888.778.713.894.742 1 .752',
  ],
  S: [
    'M0 .334.249.271.190.246.245.193.228.082.29.084V0',
    'M0 .353.271.353.460.257.433.235.470.175.427.075.325 0',
    'M0 .353.518.339.644.263.723.263.723.163.803.135.803.053.87.024.87.00.898 0',
    'M0 .353.511.34.749.369.786.306 1 .315',
    'M0 .549.095.528.095.490.195.48.260.385.516.34.747.369.786.306 1 .314',
    'M0 .68.015.656.095.633.191.621.332.574.445.575.531.49.645.487.700.393.8.38 1 .337',
    'M0 .727.074.676.235.66.276.622.510.607.609.524.938.418 1 .382',
    'M0 .777.111.735.185.694.272.694.338.651.428.664.8.559.827.503.933.482 1 .41',
    'M.130 1 .599.867.502.683.695.643.856.591.886.525.992.496.998.486V.458',
  ],
  R: R_CRACKS,
  X: R_CRACKS,
};

const PATH_TOKENS = /[MLHV]|(?:\d+\.\d*|\.\d+|\d+)/g;
const SLUG_RANK_SUFFIX = /-([dcbasrx])$/i;

export function rankOfCard(rank: string | undefined, slug: string): string {
  const candidate = rank?.toUpperCase() ?? SLUG_RANK_SUFFIX.exec(slug)?.[1]?.toUpperCase() ?? 'D';
  return candidate in SHARD_CRACKS ? candidate : 'D';
}

export function parseCrackPoints(pathData: string): (readonly [number, number])[] {
  const tokens = pathData.match(PATH_TOKENS) ?? [];
  const points: (readonly [number, number])[] = [];
  let command = 'L';
  let x = 0;
  let y = 0;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === 'M' || token === 'L' || token === 'H' || token === 'V') {
      command = token;
      index++;
      continue;
    }
    if (command === 'H') x = Number(tokens[index++]);
    else if (command === 'V') y = Number(tokens[index++]);
    else {
      x = Number(tokens[index++]);
      y = Number(tokens[index++]);
      if (command === 'M') command = 'L';
    }
    points.push([x, y]);
  }
  return points;
}

function strokeCrackPath(drawing: CanvasRenderingContext2D, cell: PosterCell, pathData: string, strokeStyle: string): void {
  const [first, ...rest] = parseCrackPoints(pathData);
  if (!first) return;
  drawing.strokeStyle = strokeStyle;
  drawing.beginPath();
  drawing.moveTo(cell.x + first[0] * cell.width, cell.y + first[1] * cell.height);
  for (const [x, y] of rest) drawing.lineTo(cell.x + x * cell.width, cell.y + y * cell.height);
  drawing.stroke();
}

export function drawShardCracks(drawing: CanvasRenderingContext2D, cell: PosterCell, rank: string | undefined, slug: string, quantity: number): void {
  const paths = SHARD_CRACKS[rankOfCard(rank, slug)] ?? SHARD_CRACKS.D ?? [];
  const stage = Math.min(paths.length - 1, Math.max(paths.length > 1 ? 1 : 0, quantity - 1));
  const lightPath = paths[stage];
  const darkPath = paths[Math.max(0, stage - 1)];
  drawing.lineWidth = cell.width * SHARD_STROKE_RATIO;
  drawing.lineCap = 'square';
  drawing.lineJoin = 'miter';
  if (lightPath) strokeCrackPath(drawing, cell, lightPath, SHARD_LIGHT_STROKE);
  if (darkPath) strokeCrackPath(drawing, cell, darkPath, SHARD_DARK_STROKE);
}
