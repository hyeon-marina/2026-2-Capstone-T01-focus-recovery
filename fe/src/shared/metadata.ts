// This marker is a storage identifier, never a URL to navigate or fetch.
export const PAGE_MARKER = '/__focus_page__/';
export const OMITTED_QUERY = '[NOT_COLLECTED]';
export const METADATA_TITLE = 'Public browsing metadata';
export const METADATA_CONTENT = 'METADATA_ONLY: public browsing activity; page text, title and search terms were not collected.';
export function metadataPath(path: string) {
  return /^(?:\/[A-Za-z0-9_.-]+)*\/__focus_page__\/[a-f0-9]{64}$/.test(path) && path.indexOf(PAGE_MARKER) === path.lastIndexOf(PAGE_MARKER);
}

export const TOPICS = ['GIT','ACCESSIBILITY','PYTHON','HTTP_CACHE','RECYCLING','ENERGY','URBAN_CLIMATE','LIGHTING','MATERIALS','HANGUL','ART','LIBRARY','ARCHIVE','MUSIC','GEOLOGY','ASTRONOMY','WEATHER','TRANSPORT','BIOLOGY','TRAVEL','COOKING','HOBBY','OTHER'] as const;
const topicWords = [/\b(?:git|github|merge|rebase)\b/i,/accessibility|접근성|keyboard|대체 텍스트/i,/python|파이썬|venv/i,/cache|etag|캐시/i,/recycl|재활용|분리배출/i,/solar|wind|energy|태양광|풍력|에너지/i,/heat island|열섬|차열/i,/\bled\b|fluorescent|형광등/i,/container|용기|stainless|스테인리스/i,/hangul|한글|훈민정음/i,/impression|인상주의|painting|회화|\bart\b/i,/library|도서관|십진분류/i,/archive|아카이브|museum|박물관/i,/orchestra|오케스트라|악기|music/i,/volcano|earthquake|화산|지진|plate/i,/planet|행성|태양계/i,/humidity|rainfall|습도|강수/i,/\b(?:rail|railway|bus)\b|철도|버스|환승/i,/photosynthesis|respiration|광합성|호흡/i,/travel|여행/i,/recipe|요리|음식/i,/hobby|취미|review|사용기/i];
// A bounded vocabulary is the only title-derived information allowed out of the document.
export function topicTitle(title: string) { const index = topicWords.findIndex(re => re.test(title)); return 'Topic: ' + TOPICS[index < 0 ? TOPICS.length - 1 : index]; }
export function validMetadataTitle(title: string) { return title === METADATA_TITLE || TOPICS.some(topic => title === 'Topic: ' + topic); }
