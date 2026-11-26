export type Rgb = readonly [number, number, number];

const HEX_PAIRS = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const CHANNEL_MAX = 255;
const CONTRAST_FLARE = 0.05;

export function rgbOfHex(hex: string): Rgb {
  const pairs = HEX_PAIRS.exec(hex.trim());
  if (!pairs) throw new Error(`not a six digit hex colour: ${hex}`);
  return [Number.parseInt(pairs[1] ?? '', 16), Number.parseInt(pairs[2] ?? '', 16), Number.parseInt(pairs[3] ?? '', 16)];
}

export function blendOver(ink: Rgb, inkShare: number, backdrop: Rgb): Rgb {
  const blendChannel = (channel: 0 | 1 | 2) => Math.round(ink[channel] * inkShare + backdrop[channel] * (1 - inkShare));
  return [blendChannel(0), blendChannel(1), blendChannel(2)];
}

const linearChannel = (value: number): number => {
  const unit = value / CHANNEL_MAX;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ([red, green, blue]: Rgb): number => 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);

export function contrastRatio(first: Rgb, second: Rgb): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + CONTRAST_FLARE) / (darker + CONTRAST_FLARE);
}

function oklabOf([red, green, blue]: Rgb): readonly [number, number, number] {
  const [linearRed, linearGreen, linearBlue] = [linearChannel(red), linearChannel(green), linearChannel(blue)];
  const long = Math.cbrt(0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue);
  const medium = Math.cbrt(0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue);
  const short = Math.cbrt(0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue);
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

export function oklabDistance(first: Rgb, second: Rgb): number {
  const [lightnessA, greenRedA, blueYellowA] = oklabOf(first);
  const [lightnessB, greenRedB, blueYellowB] = oklabOf(second);
  return Math.hypot(lightnessA - lightnessB, greenRedA - greenRedB, blueYellowA - blueYellowB);
}
