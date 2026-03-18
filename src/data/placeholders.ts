interface PlaceholderOptions {
  title: string;
  subtitle: string;
  width?: number;
  height?: number;
  from: string;
  to: string;
  badge?: string;
}

export function createPlaceholderDataUri({
  title,
  subtitle,
  width = 900,
  height = 1400,
  from,
  to,
  badge = 'VIP',
}: PlaceholderOptions) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${from}" />
          <stop offset="100%" stop-color="${to}" />
        </linearGradient>
        <filter id="blur">
          <feGaussianBlur stdDeviation="36" />
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="#050507" />
      <rect width="100%" height="100%" fill="url(#bg)" opacity="0.88" />
      <circle cx="${width * 0.82}" cy="${height * 0.16}" r="${width * 0.22}" fill="rgba(255,255,255,0.26)" filter="url(#blur)" />
      <circle cx="${width * 0.16}" cy="${height * 0.82}" r="${width * 0.18}" fill="rgba(0,0,0,0.24)" filter="url(#blur)" />
      <rect x="${width * 0.08}" y="${height * 0.08}" width="${width * 0.2}" height="${height * 0.04}" rx="${height * 0.02}" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.18)" />
      <text x="${width * 0.18}" y="${height * 0.105}" text-anchor="middle" font-size="${width * 0.04}" fill="white" font-family="Arial, sans-serif" letter-spacing="3">${badge}</text>
      <rect x="${width * 0.06}" y="${height * 0.7}" width="${width * 0.88}" height="${height * 0.2}" rx="${width * 0.045}" fill="rgba(5,5,7,0.34)" stroke="rgba(255,255,255,0.16)" />
      <text x="${width * 0.1}" y="${height * 0.79}" font-size="${width * 0.08}" font-weight="700" fill="white" font-family="Arial, sans-serif">${title}</text>
      <text x="${width * 0.1}" y="${height * 0.845}" font-size="${width * 0.037}" fill="rgba(255,255,255,0.84)" font-family="Arial, sans-serif">${subtitle}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
