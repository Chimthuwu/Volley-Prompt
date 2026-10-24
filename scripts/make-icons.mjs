import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'build/icon.svg'));
mkdirSync(join(root, 'site'), { recursive: true });

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

writeFileSync(join(root, 'build/icon.png'), await png(512));
writeFileSync(join(root, 'site/icon.png'), await png(256));
writeFileSync(join(root, 'site/icon.svg'), svg);
writeFileSync(join(root, 'renderer/icon.svg'), svg);
const sizes = await Promise.all([16, 32, 48, 64, 128, 256].map(png));
writeFileSync(join(root, 'build/icon.ico'), await pngToIco(sizes));
console.log('icons written');
