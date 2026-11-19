/** Pinterest country domains. Subdomains such as br.pinterest.com are covered by the *. wildcard. */
export const PINTEREST_DOMAINS = [
  'pinterest.com', 'pinterest.ca', 'pinterest.co.uk', 'pinterest.com.au', 'pinterest.de', 'pinterest.fr',
  'pinterest.es', 'pinterest.it', 'pinterest.pt', 'pinterest.jp', 'pinterest.co.kr', 'pinterest.com.mx',
  'pinterest.cl', 'pinterest.at', 'pinterest.ch', 'pinterest.dk', 'pinterest.ie', 'pinterest.nz',
  'pinterest.ph', 'pinterest.se', 'pinterest.ru',
];

export const PINTEREST_MATCHES = PINTEREST_DOMAINS.flatMap((d) => [`https://${d}/*`, `https://*.${d}/*`]);

export const IMAGE_HOSTS = ['https://i.pinimg.com/*', 'https://*.pinimg.com/*'];

export function isPinterestUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return PINTEREST_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
