import { candidatesFromKnown, candidatesFromThumb, imageSignature } from './images';

export type MediaKind = 'image' | 'gif' | 'video-cover';

export type Media = {
  kind: MediaKind;
  candidates: string[];
  width?: number;
  height?: number;
};

export type PinInfo = {
  id: string;
  title: string;
  description: string;
  link: string;
  pinner: string;
  board?: string;
  media: Media[];
  isVideo: boolean;
  /** Same value for the same image saved as different pins. */
  signature: string;
  /** Feed data was too thin (e.g. an Idea Pin without pages); fetch the full pin. */
  needsDetail: boolean;
};

type ImgVariant = { url?: string; width?: number; height?: number };
type ImgMap = Record<string, ImgVariant | null | undefined>;

function bestFrom(images: ImgMap | null | undefined): ImgVariant | null {
  if (!images || typeof images !== 'object') return null;
  const orig = images.orig ?? images.originals;
  if (orig?.url) return orig;
  let best: ImgVariant | null = null;
  for (const v of Object.values(images)) {
    if (v?.url && (!best || (v.width ?? 0) > (best.width ?? 0))) best = v;
  }
  return best;
}

function kindFor(url: string): MediaKind {
  return /\.gif(?:$|[?#])/i.test(url) ? 'gif' : 'image';
}

function toMedia(v: ImgVariant, kind?: MediaKind): Media {
  const url = v.url!;
  return { kind: kind ?? kindFor(url), candidates: candidatesFromKnown(url), width: v.width, height: v.height };
}

function text(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

/** Turn a pin object from Pinterest's internal API into what the downloader needs. */
export function parsePin(raw: any): PinInfo {
  const id = String(raw?.id ?? '');
  const media: Media[] = [];
  const videoList = raw?.videos?.video_list;
  const pages: any[] | undefined = raw?.story_pin_data?.pages;
  const hasVideoBlock = Array.isArray(pages) && pages.some((p) => p?.blocks?.some((b: any) => b?.video));
  const isVideo = !!videoList || hasVideoBlock;

  // Carousel: several images in one pin.
  const slots: any[] | undefined = raw?.carousel_data?.carousel_slots;
  if (Array.isArray(slots)) {
    for (const s of slots) {
      const b = bestFrom(s?.images);
      if (b?.url) media.push(toMedia(b));
    }
  }

  // Idea Pin (story pin): one or more pages, each with image or video blocks.
  if (!media.length && Array.isArray(pages)) {
    for (const page of pages) {
      let found = false;
      for (const block of page?.blocks ?? []) {
        const bi = bestFrom(block?.image?.images);
        if (bi?.url) {
          media.push(toMedia(bi));
          found = true;
          continue;
        }
        const vl = block?.video?.video_list;
        if (vl && typeof vl === 'object') {
          const thumb = Object.values(vl as Record<string, any>).map((v) => v?.thumbnail).find(Boolean);
          if (thumb) {
            media.push({ kind: 'video-cover', candidates: candidatesFromKnown(thumb) });
            found = true;
          }
        }
      }
      if (!found) {
        const pi = bestFrom(page?.image?.images);
        if (pi?.url) media.push(toMedia(pi));
      }
    }
  }

  // Ordinary pin (or the cover image of a video pin).
  if (!media.length) {
    const b = bestFrom(raw?.images);
    if (b?.url) media.push(toMedia(b, videoList ? 'video-cover' : undefined));
  }

  const needsDetail = !!raw?.story_pin_data_id && !Array.isArray(pages);

  return {
    id,
    title: text(raw?.title) || text(raw?.grid_title) || text(raw?.seo_title) || text(raw?.closeup_unified_title),
    description: text(raw?.description) || text(raw?.closeup_unified_description),
    link: text(raw?.link),
    pinner: text(raw?.pinner?.username) || text(raw?.native_creator?.username) || text(raw?.origin_pinner?.username),
    board: text(raw?.board?.name) || undefined,
    media,
    isVideo,
    signature: media[0] ? imageSignature(media[0].candidates[0]) : `pin:${id}`,
    needsDetail,
  };
}

/** Fallback when the API is unavailable: build a pin from what the page shows. */
export function pinFromThumb(id: string, thumbUrl: string, title = ''): PinInfo {
  return {
    id,
    title: text(title),
    description: '',
    link: '',
    pinner: '',
    media: thumbUrl ? [{ kind: kindFor(thumbUrl), candidates: candidatesFromThumb(thumbUrl) }] : [],
    isVideo: false,
    signature: thumbUrl ? imageSignature(thumbUrl) : `pin:${id}`,
    needsDetail: false,
  };
}

/** Is this feed item a pin (feeds also contain stories, ads and board suggestions)? */
export function isPinItem(item: any): boolean {
  if (!item || typeof item !== 'object' || !item.id) return false;
  if (item.type) return item.type === 'pin';
  return !!(item.images || item.carousel_data || item.story_pin_data);
}
