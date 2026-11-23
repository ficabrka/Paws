import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { getLocales } from 'expo-localization';
import data from './i18n.json';

export const SUPABASE_URL = 'https://zpnpgirlfgpqsaqlpypb.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_I9d-4Axf-hulVOCobmPGSQ_EB9DcdKT';
export const SHARE_BASE = 'https://getpawsapp.com/p/';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

export const photoUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/pet-photos/${path}`;

/* ---------------- i18n ---------------- */
export const I18N = data.I18N;
export const LANG_NAMES = data.NAMES;
export const LANG_FLAGS = { sr: '🇷🇸', en: '🇬🇧', de: '🇩🇪', es: '🇪🇸', fr: '🇫🇷', it: '🇮🇹', pt: '🇵🇹', ru: '🇷🇺', tr: '🇹🇷', pl: '🇵🇱', nl: '🇳🇱', el: '🇬🇷', ja: '🇯🇵' };
const LOCALES = { sr: 'sr-Latn-RS', en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU', tr: 'tr-TR', pl: 'pl-PL', nl: 'nl-NL', el: 'el-GR', ja: 'ja-JP' };

export function deviceLang() {
  try {
    const code = (getLocales()[0]?.languageCode || 'sr').toLowerCase();
    if (I18N[code]) return code;
    if (['hr', 'bs', 'sh', 'cnr', 'mk', 'sl'].includes(code)) return 'sr';
  } catch (e) {}
  return 'en';
}
export function deviceRegion() {
  try { return (getLocales()[0]?.regionCode || 'RS').toUpperCase(); } catch (e) { return 'RS'; }
}
export function makeT(lang) {
  return (k, v) => {
    let s = (I18N[lang] && I18N[lang][k]) || I18N.en[k] || I18N.sr[k] || k;
    if (v) for (const x in v) s = s.split('{' + x + '}').join(String(v[x]));
    return s;
  };
}
export const fmt = (n, lang) => (n >= 10000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : Number(n || 0).toLocaleString(LOCALES[lang] || 'en-GB'));

/* ---------------- data helpers ---------------- */
export const CATS = [['svi', '✨'], ['psi', '🐶'], ['macke', '🐱'], ['glodari', '🐹'], ['ptice', '🦜'], ['ostali', '🐢']];
export const COUNTRIES = ['RS', 'HR', 'BA', 'ME', 'SI', 'MK', 'AT', 'DE', 'CH', 'FR', 'IT', 'ES', 'PT', 'GB', 'IE', 'NL', 'SE', 'NO', 'PL', 'CZ', 'GR', 'TR', 'US', 'CA', 'MX', 'BR', 'AR', 'JP', 'KR', 'AU'];
export const flagOf = (cc) => (cc || 'UN').toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
export function countryName(cc, lang) {
  try { return new Intl.DisplayNames([LOCALES[lang] || 'en'], { type: 'region' }).of(cc); } catch (e) { return cc; }
}
export const LEVELS = [[250, 'm1', '📜'], [500, 'm2', '🥉'], [1000, 'm3', '🥈'], [2500, 'm4', '🥇'], [5000, 'm5', '💎']];
export function levelOf(n) { let l = -1; LEVELS.forEach((m, i) => { if (n >= m[0]) l = i; }); return l; }
export function agoText(iso, t) {
  const h = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3600000));
  return h < 24 ? t('ago_h', { n: h }) : t('ago_d', { n: Math.round(h / 24) });
}

// ImageNet class index (0..999) -> Paws category
export function catOfClass(c) {
  if (c >= 151 && c <= 280) return 'psi';
  if (c >= 281 && c <= 285) return 'macke';
  if (c >= 330 && c <= 338) return 'glodari';
  if ((c >= 7 && c <= 24) || (c >= 80 && c <= 100) || (c >= 127 && c <= 146)) return 'ptice';
  return 'ostali';
}
