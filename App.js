import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, FlatList, Linking, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
import * as Clipboard from 'expo-clipboard';
import Detector from './src/Detector';
import INTRO from './src/introFrames';
import {
  supabase, photoUrl, SHARE_BASE, I18N, LANG_NAMES, LANG_FLAGS, deviceLang, deviceRegion, makeT, fmt,
  CATS, COUNTRIES, flagOf, countryName, LEVELS, levelOf, agoText, catOfClass,
  searchSongs, playSong, stopSong, monthStartISO,
} from './src/lib';

const C = { bg: '#0C0B10', bg2: '#131218', card: '#18171F', line: 'rgba(255,255,255,0.08)', txt: '#F5F3F8', mut: '#9B97A8', g1: '#FF4F7B', g2: '#FF9248', ok: '#3DDC97' };
const GRAD = [C.g1, C.g2];
const PAGE = 15;
const PET_FIELDS = 'id,owner_id,name,category,city,country_code,caption,photo_path,paws_count,featured_until,credit,created_at,contact_phone,contact_apps,song_id,song_title,song_artist,song_cover';
const PET_FIELDS_OLD = 'id,owner_id,name,category,city,country_code,caption,photo_path,paws_count,featured_until,credit,created_at';
const FEET = require('./assets/feet.png');
const PHONE_RE = /^\+?[0-9 ()./-]{6,22}$/;

// Select pets; if the v2 columns are not in the database yet, fall back to the old column list.
async function selectPets(build) {
  let r = await build(supabase.from('pets').select(PET_FIELDS));
  if (r.error && /column|schema/i.test(r.error.message || '')) r = await build(supabase.from('pets').select(PET_FIELDS_OLD));
  return r;
}

/* Two elephant footprints: the Paws mark, used everywhere instead of the dog-paw emoji. */
function Feet({ size = 22, color = '#fff', style }) {
  return <Image source={FEET} style={[{ width: size, height: size }, style]} tintColor={color} contentFit="contain" />;
}

/* ======================================================================= */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState(deviceLang());
  const t = useMemo(() => makeT(lang), [lang]);
  const [uid, setUid] = useState(null);
  const [authErr, setAuthErr] = useState(null);
  const [tab, setTab] = useState('feed');
  const [intro, setIntro] = useState(true);
  const [welcome, setWelcome] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [posted, setPosted] = useState(null);
  const clearPosted = useCallback(() => setPosted(null), []);
  const detector = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('paws-lang'); if (saved && I18N[saved]) setLang(saved);
        if (!(await AsyncStorage.getItem('paws-welcomed'))) setWelcome(true);
      } catch (e) {}
      await signIn();
    })();
  }, []);

  async function signIn() {
    setAuthErr(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) { setUid(data.session.user.id); return; }
      const { data: d2, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      setUid(d2.user.id);
    } catch (e) { setAuthErr(String(e?.message || e)); }
  }
  const chooseLang = async (l) => { setLang(l); setLangOpen(false); try { await AsyncStorage.setItem('paws-lang', l); } catch (e) {} };
  const goTab = (k) => { if (k !== 'feed') stopSong(); setTab(k); };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Detector ref={detector} />
      <View style={s.header}>
        <View style={s.logoRow}>
          <LinearGradient colors={GRAD} style={s.logoMark}><Feet size={22} /></LinearGradient>
          <Text style={s.logoTxt}>Paws</Text>
        </View>
        <Pressable onPress={() => setLangOpen(true)} style={s.langBtn}><Text style={s.langTxt}>{LANG_FLAGS[lang]} {lang.toUpperCase()}</Text></Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {!uid ? (
          <View style={s.center}>
            {authErr ? (<>
              <Text style={s.errTxt}>{t('err_anon')}</Text>
              <Text style={[s.mutTxt, { marginTop: 6 }]} numberOfLines={3}>{authErr}</Text>
              <Btn label={t('retry')} onPress={signIn} style={{ marginTop: 18 }} />
            </>) : <ActivityIndicator color={C.g1} size="large" />}
          </View>
        ) : tab === 'feed' ? <Feed t={t} lang={lang} uid={uid} refreshKey={refreshKey} paused={intro || welcome} />
          : tab === 'top' ? <Top t={t} lang={lang} uid={uid} />
          : tab === 'post' ? <Post t={t} lang={lang} uid={uid} detector={detector} onDone={(id) => { setPosted(id || null); setRefreshKey((k) => k + 1); setTab('mine'); }} />
          : <Mine t={t} lang={lang} uid={uid} refreshKey={refreshKey} onPost={() => setTab('post')} posted={posted} clearPosted={clearPosted} />}
      </View>

      <View style={[s.tabbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {[['feed', '🏠', t('tab_feed')], ['top', '🏆', t('tab_top')], ['post', '+', t('tab_post')], ['mine', 'feet', t('tab_mine')]].map(([k, ic, lb]) => (
          <Pressable key={k} onPress={() => goTab(k)} style={s.tabBtn}>
            {k === 'post'
              ? <LinearGradient colors={GRAD} style={s.plus}><Text style={s.plusTxt}>+</Text></LinearGradient>
              : <>
                {ic === 'feet' ? <Feet size={24} color={tab === k ? '#fff' : 'rgba(255,255,255,0.45)'} style={{ marginVertical: 1 }} />
                  : <Text style={[s.tabIc, tab !== k && { opacity: 0.45 }]}>{ic}</Text>}
                <Text style={[s.tabLb, tab === k && { color: C.txt }]}>{lb}</Text>
              </>}
          </Pressable>
        ))}
      </View>

      <Modal visible={langOpen} transparent animationType="slide" onRequestClose={() => setLangOpen(false)}>
        <Pressable style={s.shade} onPress={() => setLangOpen(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.sheetH}>{t('language')}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {Object.keys(I18N).map((l) => (
                <Pressable key={l} onPress={() => chooseLang(l)} style={[s.langRow, l === lang && { backgroundColor: 'rgba(255,79,123,0.14)' }]}>
                  <Text style={s.langRowTxt}>{LANG_FLAGS[l]}  {LANG_NAMES[l]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* first start only: short explanation */}
      <Modal visible={welcome && !intro} animationType="fade" onRequestClose={() => setWelcome(false)}>
        <View style={[s.welcome, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
          <Image source={require('./assets/elephant.jpg')} style={s.welcomeImg} contentFit="cover" />
          <LinearGradient colors={['transparent', C.bg]} style={s.welcomeFade} />
          <View style={{ paddingHorizontal: 24 }}>
            <Text style={s.welcomeH}>{t('h1a')} {t('h1b')}</Text>
            <Text style={[s.welcomeH, { color: C.g2 }]}>{t('h1c')}</Text>
            <Text style={[s.mutTxt, { fontSize: 16, lineHeight: 23, marginTop: 12, textAlign: 'left' }]}>{t('welcome')}</Text>
            <Btn label={t('start')} onPress={async () => { setWelcome(false); try { await AsyncStorage.setItem('paws-welcomed', '1'); } catch (e) {} }} style={{ marginTop: 24 }} />
          </View>
        </View>
      </Modal>

      {/* every start: the elephant turns its head */}
      {intro && <Intro t={t} onDone={() => setIntro(false)} />}
    </View>
  );
}

/* ============================== INTRO ============================== */
function Intro({ t, onDone }) {
  const { width } = useWindowDimensions();
  const [i, setI] = useState(Math.floor(INTRO.length / 2));
  const fade = useRef(new Animated.Value(1)).current;
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return; done.current = true;
    Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => onDone());
  }, [fade, onDone]);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const el = (Date.now() - t0) / 1000;
      // look left, right, back to the middle
      const x = Math.sin(el * Math.PI * 1.1) * Math.exp(-el * 0.25);
      setI(Math.max(0, Math.min(INTRO.length - 1, Math.round((x + 1) / 2 * (INTRO.length - 1)))));
      if (el > 3.2) { clearInterval(id); finish(); }
    }, 40);
    return () => clearInterval(id);
  }, [finish]);
  const h = Math.round(width * 412 / 720);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.intro, { opacity: fade }]}>
      <Pressable style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} onPress={finish}>
        <View style={{ width, height: h }}>
          {INTRO.map((src, k) => (
            <Image key={k} source={src} style={[StyleSheet.absoluteFill, { opacity: k === i ? 1 : 0 }]} contentFit="cover" />
          ))}
          <LinearGradient colors={[C.bg, 'transparent', 'transparent', C.bg]} locations={[0, 0.18, 0.8, 1]} style={StyleSheet.absoluteFill} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 }}>
          <LinearGradient colors={GRAD} style={[s.logoMark, { width: 52, height: 52, borderRadius: 16 }]}><Feet size={36} /></LinearGradient>
          <Text style={[s.logoTxt, { fontSize: 40 }]}>Paws</Text>
        </View>
        <Text style={[s.mutTxt, { marginTop: 28, fontSize: 12 }]}>{t('tap_skip')}</Text>
      </Pressable>
    </Animated.View>
  );
}

/* ============================== shared pet actions ============================== */
const shareText = (t, p) => `${t('share_msg', { name: p.name })} ${SHARE_BASE}${p.id}`;
function contactOwner(t, p) {
  const num = (p.contact_phone || '').replace(/[^0-9+]/g, '');
  if (!num) return;
  const digits = num.replace(/\D/g, '');
  const intl = num.startsWith('+') ? digits : digits;
  const open = (url) => Linking.openURL(url).catch(() => Alert.alert('Paws', t('no_app')));
  const apps = (p.contact_apps && p.contact_apps.length ? p.contact_apps : ['call']);
  const btn = {
    call: { text: t('c_call'), onPress: () => open(`tel:${num}`) },
    sms: { text: t('c_sms'), onPress: () => open(`sms:${num}`) },
    whatsapp: { text: t('c_whatsapp'), onPress: () => open(`https://wa.me/${intl}`) },
    viber: { text: t('c_viber'), onPress: () => open(`viber://chat?number=%2B${intl}`) },
  };
  Alert.alert(t('contact_q'), `${p.name} · ${p.contact_phone}`, [...apps.filter((a) => btn[a]).map((a) => btn[a]), { text: t('cancel'), style: 'cancel' }]);
}
async function setPaw(uid, p, on) {
  return on ? supabase.from('paws').insert({ pet_id: p.id, user_id: uid }) : supabase.from('paws').delete().eq('pet_id', p.id).eq('user_id', uid);
}

/* ============================== small turning elephant ============================== */
function Elephant({ width = 180, style }) {
  const [i, setI] = useState(Math.floor(INTRO.length / 2));
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const x = Math.sin(((Date.now() - t0) / 1000) * Math.PI * 0.8);
      setI(Math.round((x + 1) / 2 * (INTRO.length - 1)));
    }, 50);
    return () => clearInterval(id);
  }, []);
  const h = Math.round(width * 412 / 720);
  return (
    <View style={[{ width, height: h, borderRadius: 18, overflow: 'hidden' }, style]}>
      {INTRO.map((src, k) => <Image key={k} source={src} style={[StyleSheet.absoluteFill, { opacity: k === i ? 1 : 0 }]} contentFit="cover" />)}
    </View>
  );
}

/* ============================== themed bottom sheet ============================== */
function Sheet({ visible, onClose, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.shade} onPress={onClose}>
        <Pressable onPress={() => {}} style={[s.sheet2, { paddingBottom: insets.bottom + 18 }]}>
          <View style={s.grabber} />
          <Pressable onPress={onClose} style={s.sheetX} hitSlop={12}><Text style={{ color: C.txt, fontSize: 16, fontWeight: '800' }}>✕</Text></Pressable>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ============================== invite friends ============================== */
const shareLink = (p) => `${SHARE_BASE}${p.id}`;
function InviteButtons({ t, p, onDone }) {
  const msg = shareText(t, p);
  const [copied, setCopied] = useState(false);
  const open = async (url, fallback) => {
    try { await Linking.openURL(url); onDone && onDone(); } catch (e) { if (fallback) { try { await Linking.openURL(fallback); onDone && onDone(); return; } catch (e2) {} } Share.share({ message: msg }).catch(() => {}); }
  };
  const copy = async () => { await Clipboard.setStringAsync(msg); setCopied(true); setTimeout(() => setCopied(false), 2500); };
  const items = [
    ['WhatsApp', '#25D366', 'W', () => open(`whatsapp://send?text=${encodeURIComponent(msg)}`, `https://wa.me/?text=${encodeURIComponent(msg)}`)],
    ['Viber', '#7360F2', 'V', () => open(`viber://forward?text=${encodeURIComponent(msg)}`)],
    ['Instagram', '#E1306C', 'IG', async () => { await copy(); open('instagram://direct-inbox', 'https://www.instagram.com/direct/inbox/'); }],
    ['Facebook', '#1877F2', 'f', () => open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLink(p))}`)],
    ['Messenger', '#0084FF', 'M', () => open(`fb-messenger://share/?link=${encodeURIComponent(shareLink(p))}`, `https://www.facebook.com/dialog/send?link=${encodeURIComponent(shareLink(p))}&redirect_uri=${encodeURIComponent(shareLink(p))}`)],
    ['Telegram', '#229ED9', 'T', () => open(`tg://msg?text=${encodeURIComponent(msg)}`, `https://t.me/share/url?url=${encodeURIComponent(shareLink(p))}&text=${encodeURIComponent(msg)}`)],
    [copied ? t('copied') : t('copy_link'), '#3a3844', '🔗', copy],
    [t('more'), '#3a3844', '⋯', () => Share.share({ message: msg }).catch(() => {})],
  ];
  return (
    <View>
      <View style={s.invGrid}>
        {items.map(([lb, col, ic, fn]) => (
          <Pressable key={lb} onPress={fn} style={({ pressed }) => [s.invItem, pressed && { opacity: 0.6 }]}>
            <View style={[s.invIc, { backgroundColor: col }]}><Text style={s.invIcTxt}>{ic}</Text></View>
            <Text style={s.invLb} numberOfLines={1}>{lb}</Text>
          </Pressable>
        ))}
      </View>
      {copied && <Text style={[s.rowSub, { textAlign: 'center', color: C.ok, marginTop: 6 }]}>{t('ig_hint')}</Text>}
    </View>
  );
}
function InviteSheet({ t, p, onClose, posted }) {
  return (
    <Sheet visible={!!p} onClose={onClose}>
      {p && <>
        <View style={{ alignItems: 'center', marginTop: 4 }}>
          {posted ? <Elephant width={200} /> : <Image source={{ uri: photoUrl(p.photo_path) }} style={{ width: 84, height: 84, borderRadius: 20 }} contentFit="cover" />}
          <Text style={[s.sheetH, { textAlign: 'center', marginTop: 14 }]}>{posted ? t('posted_h', { name: p.name }) : t('invite_h', { name: p.name })}</Text>
          <Text style={[s.mutTxt, { marginTop: 6, marginBottom: 16 }]}>{t('invite_p')}</Text>
        </View>
        <InviteButtons t={t} p={p} />
      </>}
    </Sheet>
  );
}

/* ============================== report ============================== */
function ReportSheet({ t, p, uid, onClose }) {
  const [sent, setSent] = useState(false);
  useEffect(() => { setSent(false); }, [p]);
  const send = async (reason) => {
    await supabase.from('reports').insert({ pet_id: p.id, reporter_id: uid, reason });
    setSent(true); setTimeout(onClose, 1400);
  };
  return (
    <Sheet visible={!!p} onClose={onClose}>
      {p && (sent ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ fontSize: 40 }}>✓</Text>
          <Text style={[s.sheetH, { marginTop: 8 }]}>{t('reported')}</Text>
        </View>
      ) : (<>
        <Text style={s.sheetH}>{t('report')}</Text>
        <Text style={[s.mutTxt, { textAlign: 'left', marginTop: 4, marginBottom: 12 }]}>{t('report_q')}</Text>
        {[['no_animal', '🚫', 'r_noanimal'], ['inappropriate', '⚠️', 'r_bad'], ['spam', '📢', 'r_spam']].map(([r, ic, k]) => (
          <Pressable key={r} onPress={() => send(r)} style={({ pressed }) => [s.repRow, pressed && { opacity: 0.6 }]}>
            <Text style={{ fontSize: 20 }}>{ic}</Text><Text style={[s.rowName, { flex: 1 }]}>{t(k)}</Text><Text style={{ color: C.mut, fontSize: 18 }}>›</Text>
          </Pressable>
        ))}
        <Btn label={t('cancel')} secondary onPress={onClose} style={{ marginTop: 10 }} />
      </>))}
    </Sheet>
  );
}

/* ============================== FEED ============================== */
function Feed({ t, lang, uid, refreshKey, paused }) {
  const [cat, setCat] = useState('svi');
  const [items, setItems] = useState([]);
  const [liked, setLiked] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [end, setEnd] = useState(false);
  const [h, setH] = useState(0);
  const lastTap = useRef({ id: null, t: 0 });
  const [burst, setBurst] = useState(null);
  const [active, setActive] = useState(null);
  const [sound, setSound] = useState(true);
  const [reportP, setReportP] = useState(null);
  const [inviteP, setInviteP] = useState(null);

  useEffect(() => { AsyncStorage.getItem('paws-sound').then((v) => { if (v === '0') setSound(false); }).catch(() => {}); }, []);
  const onViewable = useRef(({ viewableItems }) => { const v = viewableItems.find((x) => x.isViewable); if (v) setActive(v.item.id); }).current;
  const viewCfg = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // play the song of the photo on screen
  const activePet = items.find((p) => p.id === active);
  useEffect(() => {
    if (!paused && sound && activePet?.song_id) playSong(activePet.song_id); else stopSong();
  }, [active, activePet?.song_id, sound, paused]); // eslint-disable-line
  useEffect(() => () => stopSong(), []);
  const toggleSound = () => { const v = !sound; setSound(v); AsyncStorage.setItem('paws-sound', v ? '1' : '0').catch(() => {}); };

  const load = useCallback(async (reset) => {
    if (!reset && (loading || end)) return;
    setLoading(true); setErr(null);
    try {
      const from = reset ? 0 : items.length;
      const { data, error } = await selectPets((q) => { q = q.eq('status', 'active').order('created_at', { ascending: false }).range(from, from + PAGE - 1); return cat !== 'svi' ? q.eq('category', cat) : q; });
      if (error) throw error;
      let rows = data || [];
      if (reset) {
        const { data: feat } = await selectPets((q) => { q = q.eq('status', 'active').gt('featured_until', new Date().toISOString()).limit(5); return cat !== 'svi' ? q.eq('category', cat) : q; });
        const fIds = new Set((feat || []).map((p) => p.id));
        rows = [...(feat || []).map((p) => ({ ...p, _featured: true })), ...rows.filter((p) => !fIds.has(p.id))];
      }
      const ids = rows.map((p) => p.id);
      if (ids.length) {
        const { data: mine } = await supabase.from('paws').select('pet_id').eq('user_id', uid).in('pet_id', ids);
        setLiked((prev) => { const n = new Set(reset ? [] : prev); (mine || []).forEach((m) => n.add(m.pet_id)); return n; });
      }
      setItems((prev) => (reset ? rows : [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]));
      if (reset && rows[0]) setActive(rows[0].id);
      setEnd((data || []).length < PAGE);
    } catch (e) { setErr(t('err_net')); }
    setLoading(false);
  }, [cat, items.length, loading, end, uid, t]);

  useEffect(() => { setItems([]); setEnd(false); load(true); }, [cat, refreshKey]); // eslint-disable-line

  async function togglePaw(p, onlyOn) {
    if (p.owner_id === uid) { Alert.alert('Paws', t('own_paw')); return; }
    const has = liked.has(p.id);
    if (onlyOn && has) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLiked((prev) => { const n = new Set(prev); has ? n.delete(p.id) : n.add(p.id); return n; });
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, paws_count: x.paws_count + (has ? -1 : 1) } : x)));
    const { error } = await setPaw(uid, p, !has);
    if (error) {
      setLiked((prev) => { const n = new Set(prev); has ? n.add(p.id) : n.delete(p.id); return n; });
      setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, paws_count: x.paws_count + (has ? 1 : -1) } : x)));
    }
  }
  function onTap(p) {
    const now = Date.now();
    if (lastTap.current.id === p.id && now - lastTap.current.t < 320) {
      togglePaw(p, true); setBurst(p.id); setTimeout(() => setBurst(null), 700); lastTap.current = { id: null, t: 0 };
    } else lastTap.current = { id: p.id, t: now };
  }
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {h > 0 && (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={h}
          decelerationRate="fast"
          getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })}
          onEndReached={() => load(false)}
          onEndReachedThreshold={2}
          windowSize={5}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewCfg}
          renderItem={({ item: p }) => (
            <Slide p={p} h={h} t={t} lang={lang} on={liked.has(p.id)} burst={burst === p.id} sound={sound}
              onTap={() => onTap(p)} onPaw={() => togglePaw(p)} onShare={() => setInviteP(p)}
              onReport={() => setReportP(p)} onContact={() => contactOwner(t, p)} onSound={toggleSound} />
          )}
          ListEmptyComponent={
            <View style={[s.center, { height: h }]}>
              {loading ? <ActivityIndicator color={C.g1} size="large" />
                : err ? (<><Text style={s.errTxt}>{err}</Text><Btn label={t('retry')} onPress={() => load(true)} style={{ marginTop: 16 }} /></>)
                  : <Text style={s.mutTxt}>{t('empty_feed')}</Text>}
            </View>
          }
        />
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
        {CATS.map(([k, e]) => (
          <Pressable key={k} onPress={() => setCat(k)} style={[s.chip, cat === k && s.chipOn]}>
            <Text style={[s.chipTxt, cat === k && { color: '#111' }]}>{e} {t('c_' + k)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ReportSheet t={t} p={reportP} uid={uid} onClose={() => setReportP(null)} />
      <InviteSheet t={t} p={inviteP} onClose={() => setInviteP(null)} />
    </View>
  );
}

function Slide({ p, h, t, lang, on, burst, sound, onTap, onPaw, onShare, onReport, onContact, onSound }) {
  const n = p.paws_count || 0, l = levelOf(n), next = LEVELS[l + 1];
  const uri = photoUrl(p.photo_path);
  return (
    <Pressable onPress={onTap} style={{ height: h, backgroundColor: '#000' }}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={s.fade} />
      {burst && <View style={s.burst}><Feet size={130} /></View>}
      <View style={s.meta}>
        {p._featured && <View style={s.badgeFeat}><Text style={s.badgeFeatTxt}>{t('featured')}</Text></View>}
        <Text style={s.petName}>{p.name}</Text>
        <Text style={s.petPlace}>{flagOf(p.country_code)} {p.city || countryName(p.country_code, lang)} · {agoText(p.created_at, t)}</Text>
        {!!p.caption && <Text style={s.caption}>{p.caption}</Text>}
        {!!p.song_id && (
          <Pressable onPress={onSound} style={s.songChip}>
            <Text style={s.songTxt} numberOfLines={1}>{sound ? '🔊' : '🔇'}  ♪ {p.song_title} · {p.song_artist}</Text>
          </Pressable>
        )}
        <View style={s.ms}>
          <Text style={s.msTxt}>{l >= 0 ? `${LEVELS[l][2]} ${t(LEVELS[l][1])}` : t('ms_new')}</Text>
          {next && <>
            <View style={s.msBar}><LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: '100%', width: `${Math.round(((n - (l >= 0 ? LEVELS[l][0] : 0)) / (next[0] - (l >= 0 ? LEVELS[l][0] : 0))) * 100)}%` }} /></View>
            <Text style={s.msTxt}>{t('ms_left', { n: fmt(next[0] - n, lang) })} {next[2]}</Text>
          </>}
        </View>
        {!!p.credit && <Text style={s.credit} numberOfLines={1}>📷 {p.credit}</Text>}
      </View>
      <View style={s.rail}>
        <Pressable onPress={onPaw} style={s.railBtn}>
          {on ? <LinearGradient colors={GRAD} style={s.railO}><Feet size={30} /></LinearGradient>
            : <View style={[s.railO, s.railOff]}><Feet size={30} /></View>}
          <Text style={s.railTxt}>{fmt(n, lang)}</Text>
        </Pressable>
        <Pressable onPress={onShare} style={s.railBtn}>
          <View style={[s.railO, s.railOff]}><Text style={s.railIc}>↗</Text></View>
          <Text style={s.railTxt}>{t('invite')}</Text>
        </Pressable>
        {!!p.contact_phone && (
          <Pressable onPress={onContact} style={s.railBtn}>
            <View style={[s.railO, s.railOff]}><Text style={{ fontSize: 22 }}>📞</Text></View>
            <Text style={s.railTxt}>{t('contact')}</Text>
          </Pressable>
        )}
        <Pressable onPress={onReport} style={s.railBtn}>
          <View style={[s.railO, s.railOff, { width: 40, height: 40 }]}><Text style={{ color: '#fff', fontSize: 16 }}>⋯</Text></View>
        </Pressable>
      </View>
    </Pressable>
  );
}

/* ============================== PET VIEW (opened from Top lists) ============================== */
function PetView({ p, t, lang, uid, onClose }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [on, setOn] = useState(false);
  const [n, setN] = useState(p?.paws_count || 0);
  const [playing, setPlaying] = useState(false);
  const [inv, setInv] = useState(false);
  useEffect(() => {
    if (!p) return;
    setN(p.paws_count || 0); setPlaying(false);
    supabase.from('paws').select('pet_id').eq('pet_id', p.id).eq('user_id', uid).then(({ data }) => setOn(!!(data && data.length)));
    return () => stopSong();
  }, [p, uid]);
  if (!p) return null;
  async function paw() {
    if (p.owner_id === uid) { Alert.alert('Paws', t('own_paw')); return; }
    const was = on; setOn(!was); setN((x) => x + (was ? -1 : 1));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const { error } = await setPaw(uid, p, !was);
    if (error) { setOn(was); setN((x) => x + (was ? 1 : -1)); }
  }
  const song = () => { if (playing) { stopSong(); setPlaying(false); } else { setPlaying(true); playSong(p.song_id).then((ok) => { if (!ok) setPlaying(false); }); } };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top }}>
        <View style={{ height: height * 0.62 }}>
          <Image source={{ uri: photoUrl(p.photo_path) }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
          <Image source={{ uri: photoUrl(p.photo_path) }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
          <Pressable onPress={onClose} style={s.closeX}><Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>✕</Text></Pressable>
        </View>
        <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24 }}>
          <Text style={s.petName}>{p.name}</Text>
          <Text style={[s.petPlace, { color: C.mut }]}>{flagOf(p.country_code)} {p.city || countryName(p.country_code, lang)} · {agoText(p.created_at, t)}</Text>
          {!!p.caption && <Text style={[s.caption, { color: C.txt }]}>{p.caption}</Text>}
          {!!p.song_id && (
            <Pressable onPress={song} style={[s.songChip, { backgroundColor: C.card }]}>
              <Text style={s.songTxt} numberOfLines={1}>{playing ? '⏸' : '▶'}  ♪ {p.song_title} · {p.song_artist}</Text>
            </Pressable>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Pressable onPress={paw} style={{ flex: 1 }}>
              {on ? <LinearGradient colors={GRAD} style={[s.btn, s.btnRow]}><Feet size={24} /><Text style={s.btnTxt}>{fmt(n, lang)}</Text></LinearGradient>
                : <View style={[s.btn, s.btnRow, s.btnSec]}><Feet size={24} /><Text style={s.btnTxt}>{t('give_paw')} · {fmt(n, lang)}</Text></View>}
            </Pressable>
            <Btn label={'↗ ' + t('invite')} secondary onPress={() => setInv(true)} style={{ flex: 1 }} />
          </View>
          {!!p.contact_phone && <Btn label={'📞 ' + t('contact_q')} onPress={() => contactOwner(t, p)} style={{ marginTop: 10 }} />}
          {!!p.credit && <Text style={[s.credit, { color: C.mut }]}>📷 {p.credit}</Text>}
        </ScrollView>
      </View>
      <InviteSheet t={t} p={inv ? p : null} onClose={() => setInv(false)} />
    </Modal>
  );
}

/* ============================== TOP ============================== */
function usePlace() {
  const def = COUNTRIES.includes(deviceRegion()) ? deviceRegion() : 'RS';
  const [place, setPlaceState] = useState({ cc: def, city: '' });
  useEffect(() => { AsyncStorage.getItem('paws-place').then((v) => { if (v) { try { setPlaceState((p) => ({ ...p, ...JSON.parse(v) })); } catch (e) {} } }).catch(() => {}); }, []);
  const setPlace = (np) => { setPlaceState(np); AsyncStorage.setItem('paws-place', JSON.stringify(np)).catch(() => {}); };
  return [place, setPlace];
}

function Top({ t, lang, uid }) {
  const [mode, setMode] = useState('world');
  const [place, setPlace] = usePlace();
  const [cityDraft, setCityDraft] = useState('');
  const [ccOpen, setCcOpen] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { setCityDraft(place.city); }, [place.city]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const out = {};
      if (mode === 'world') {
        const { data: top, error } = await selectPets((q) => q.eq('status', 'active').order('paws_count', { ascending: false }).limit(50));
        if (error) throw error;
        out.top = top || [];
        const { data: w } = await supabase.from('weekly_winners').select('scope,paws,week_start,pets(' + PET_FIELDS_OLD + ')').order('week_start', { ascending: false }).limit(40);
        const latest = w && w[0] ? w.filter((x) => x.week_start === w[0].week_start) : [];
        out.winners = latest.filter((x) => x.scope === 'world' || x.scope === 'country:' + place.cc || x.scope.startsWith('cat:')).slice(0, 7);
      } else if (mode === 'country') {
        const { data: top, error } = await selectPets((q) => q.eq('status', 'active').eq('country_code', place.cc).order('paws_count', { ascending: false }).limit(50));
        if (error) throw error;
        out.top = top || [];
      } else if (mode === 'city') {
        if (place.city) {
          const { data: m } = await supabase.rpc('city_top', { p_cc: place.cc, p_city: place.city, p_from: monthStartISO(), p_limit: 30 });
          const ids = (m || []).map((x) => x.pet_id);
          let month = [];
          if (ids.length) {
            const { data: pets } = await selectPets((q) => q.in('id', ids));
            const byId = Object.fromEntries((pets || []).map((p) => [p.id, p]));
            month = (m || []).filter((x) => byId[x.pet_id]).map((x) => ({ ...byId[x.pet_id], _month: x.n }));
          }
          out.month = month;
          const { data: all, error } = await selectPets((q) => q.eq('status', 'active').eq('country_code', place.cc).ilike('city', place.city.trim()).order('paws_count', { ascending: false }).limit(30));
          if (error) throw error;
          out.top = all || [];
        }
      } else {
        const { data: mw } = await supabase.from('monthly_winners').select('month_start,city,country_code,paws,pets(' + PET_FIELDS_OLD + ')').eq('country_code', place.cc).order('month_start', { ascending: false }).limit(200);
        const rows = mw || [];
        const last = rows[0]?.month_start;
        out.month = rows.filter((x) => x.month_start === last && x.pets);
        const year = new Date().getUTCFullYear();
        out.finalists = new Set(rows.filter((x) => x.month_start >= `${year}-01-01` && x.month_start < `${year}-12-01`).map((x) => x.pets?.id)).size;
        const { data: yw } = await supabase.from('yearly_winners').select('year,scope,paws,pets(' + PET_FIELDS_OLD + ')').order('year', { ascending: false }).limit(60);
        out.year = (yw || []).filter((x) => x.pets && (x.scope === 'world' || x.scope === 'country:' + place.cc)).slice(0, 6);
        out.lastMonth = last;
      }
      setData({ ...out, key: mode + '|' + place.cc + '|' + place.city });
    } catch (e) { setErr(t('err_net')); }
  }, [mode, place.cc, place.city, t]);
  useEffect(() => { setData(null); load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const scopeLabel = (sc) => (sc === 'world' ? '🌍 ' + t('world') : sc.startsWith('country:') ? flagOf(sc.slice(8)) + ' ' + countryName(sc.slice(8), lang) : CATS.find((c) => c[0] === sc.slice(4))?.[1] + ' ' + t('c_' + sc.slice(4)));
  const openPet = async (p) => {
    // lists that come from joins carry only the basic fields; load the full row for song and contact
    const { data: full } = await selectPets((q) => q.eq('id', p.id).limit(1));
    setOpen((full && full[0]) || p);
  };
  const monthName = (iso) => { try { return new Date(iso + 'T00:00:00Z').toLocaleDateString(lang, { month: 'long', year: 'numeric' }); } catch (e) { return iso; } };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ height: 62 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, alignItems: 'center', gap: 8 }}>
        {[['world', '🌍'], ['country', flagOf(place.cc)], ['city', '🏙️'], ['contest', '🏆']].map(([k, e]) => (
          <Pressable key={k} onPress={() => setMode(k)} style={[s.seg, mode === k && s.segOn]}>
            <Text style={[s.segTxt, mode === k && { color: '#111' }]}>{e} {t('top_' + k)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.g1} colors={[C.g1]} />}>
        {(mode === 'country' || mode === 'city' || mode === 'contest') && (
          <View style={s.placeBox}>
            <Pressable onPress={() => setCcOpen(true)} style={[s.input, { justifyContent: 'center', flex: mode === 'city' ? 0.9 : 1 }]}>
              <Text style={{ color: C.txt }} numberOfLines={1}>{flagOf(place.cc)} {countryName(place.cc, lang)} ▾</Text>
            </Pressable>
            {mode === 'city' && (
              <TextInput value={cityDraft} onChangeText={setCityDraft} placeholder={t('city_ph')} placeholderTextColor={C.mut} maxLength={40}
                onSubmitEditing={() => setPlace({ ...place, city: cityDraft.trim() })} onBlur={() => setPlace({ ...place, city: cityDraft.trim() })}
                returnKeyType="search" style={[s.input, { flex: 1.1 }]} />
            )}
          </View>
        )}
        {err ? <View style={{ marginTop: 40 }}><Text style={s.errTxt}>{err}</Text><Btn label={t('retry')} onPress={load} style={{ marginTop: 16 }} /></View>
          : (!data || data.key !== mode + '|' + place.cc + '|' + place.city) ? <ActivityIndicator color={C.g1} size="large" style={{ marginTop: 50 }} />
          : mode === 'world' ? (<>
            <LinearGradient colors={['rgba(255,79,123,0.22)', 'rgba(255,146,72,0.08)']} style={s.weekBox}>
              <Text style={s.weekH}>{t('week_b')}</Text>
              <Text style={[s.mutTxt, { textAlign: 'left' }]}>{t('week_p')}</Text>
            </LinearGradient>
            {data.winners.length > 0 && <>
              <Text style={s.secH}>{t('winners')}</Text>
              {data.winners.map((w) => w.pets && <Row key={w.scope} p={w.pets} lang={lang} left={scopeLabel(w.scope)} right={fmt(w.paws, lang)} onPress={() => openPet(w.pets)} />)}
            </>}
            <Text style={s.secH}>{t('alltime')}</Text>
            {data.top.length === 0 ? <Text style={s.mutTxt}>{t('empty_feed')}</Text>
              : data.top.map((p, i) => <Row key={p.id} p={p} lang={lang} pos={i + 1} right={fmt(p.paws_count, lang)} onPress={() => openPet(p)} />)}
          </>)
          : mode === 'country' ? (<>
            <Text style={s.secH}>{t('best_country')} · {countryName(place.cc, lang)}</Text>
            {data.top.length === 0 ? <Text style={s.mutTxt}>{t('empty_feed')}</Text>
              : data.top.map((p, i) => <Row key={p.id} p={p} lang={lang} pos={i + 1} right={fmt(p.paws_count, lang)} onPress={() => openPet(p)} />)}
          </>)
          : mode === 'city' ? (!place.city ? <Text style={[s.mutTxt, { marginTop: 30 }]}>{t('city_need')}</Text> : <>
            <Text style={s.secH}>{t('best_city_month')} · {place.city}</Text>
            {data.month.length === 0 ? <Text style={[s.mutTxt, { textAlign: 'left' }]}>{t('none_yet')}</Text>
              : data.month.map((p, i) => <Row key={p.id} p={p} lang={lang} pos={i + 1} right={fmt(p._month, lang)} onPress={() => openPet(p)} />)}
            <Text style={s.secH}>{t('best_city_all')}</Text>
            {data.top.length === 0 ? <Text style={[s.mutTxt, { textAlign: 'left' }]}>{t('empty_feed')}</Text>
              : data.top.map((p, i) => <Row key={p.id} p={p} lang={lang} pos={i + 1} right={fmt(p.paws_count, lang)} onPress={() => openPet(p)} />)}
          </>)
          : (<>
            <LinearGradient colors={['rgba(255,194,94,0.22)', 'rgba(255,79,123,0.08)']} style={s.weekBox}>
              <Text style={s.weekH}>{t('contest_h')}</Text>
              <Text style={[s.mutTxt, { textAlign: 'left', lineHeight: 20 }]}>{t('contest_p')}</Text>
              <View style={{ marginTop: 12, gap: 6 }}>
                {['contest_s1', 'contest_s2', 'contest_s3', 'contest_s4'].map((k) => <Text key={k} style={[s.rowName, { fontSize: 14 }]}>{t(k)}</Text>)}
              </View>
              <Text style={[s.rowSub, { marginTop: 10, color: C.g2, fontWeight: '800' }]}>{t('finalists', { n: data.finalists || 0 })} · {flagOf(place.cc)}</Text>
            </LinearGradient>
            {data.year.length > 0 && <>
              <Text style={s.secH}>{t('year_winners')}</Text>
              {data.year.map((w) => <Row key={w.year + w.scope} p={w.pets} lang={lang} left={`${w.year} · ${scopeLabel(w.scope)}`} right={fmt(w.paws, lang)} onPress={() => openPet(w.pets)} />)}
            </>}
            <Text style={s.secH}>{t('month_winners')}{data.lastMonth ? ' · ' + monthName(data.lastMonth) : ''}</Text>
            {data.month.length === 0 ? <Text style={[s.mutTxt, { textAlign: 'left' }]}>{t('no_winners')}</Text>
              : data.month.map((w) => <Row key={w.city} p={w.pets} lang={lang} left={`🏙️ ${w.city}`} right={fmt(w.paws, lang)} onPress={() => openPet(w.pets)} />)}
          </>)}
      </ScrollView>
      <CountryPicker visible={ccOpen} lang={lang} onClose={() => setCcOpen(false)} onPick={(c) => setPlace({ ...place, cc: c })} />
      {open && <PetView p={open} t={t} lang={lang} uid={uid} onClose={() => setOpen(null)} />}
    </View>
  );
}
function Row({ p, lang, pos, left, right, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}>
      {pos ? <Text style={[s.pos, pos <= 3 && { color: C.g2 }]}>{pos}</Text> : null}
      <Image source={{ uri: photoUrl(p.photo_path) }} style={s.rowImg} contentFit="cover" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
        <Text style={s.rowSub} numberOfLines={1}>{left || `${flagOf(p.country_code)} ${p.city || countryName(p.country_code, lang)}`}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Feet size={16} color={C.g2} /><Text style={s.rowRight}>{right}</Text></View>
      <Text style={{ color: C.mut, fontSize: 18, marginLeft: 4 }}>›</Text>
    </Pressable>
  );
}
function CountryPicker({ visible, lang, onClose, onPick }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.shade} onPress={onClose}>
        <View style={s.sheet}>
          <ScrollView style={{ maxHeight: 460 }}>
            {COUNTRIES.map((c) => (
              <Pressable key={c} onPress={() => { onPick(c); onClose(); }} style={s.langRow}><Text style={s.langRowTxt}>{flagOf(c)}  {countryName(c, lang)}</Text></Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

/* ============================== SONG PICKER ============================== */
function SongPicker({ visible, t, onClose, onPick }) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [playing, setPlaying] = useState(null);
  useEffect(() => {
    if (!visible) { stopSong(); setPlaying(null); return undefined; }
    const term = q.trim() || 'happy';
    const id = setTimeout(async () => {
      setBusy(true); setErr(null);
      try { setRes(await searchSongs(term)); } catch (e) { setErr(t('song_err')); }
      setBusy(false);
    }, 400);
    return () => clearTimeout(id);
  }, [q, visible, t]);
  const preview = (r) => { if (playing === r.id) { stopSong(); setPlaying(null); } else { setPlaying(r.id); playSong(r.id, r.preview); } };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 10, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TextInput value={q} onChangeText={setQ} placeholder={t('song_search')} placeholderTextColor={C.mut} autoFocus style={[s.input, { flex: 1 }]} returnKeyType="search" />
          <Pressable onPress={onClose}><Text style={{ color: C.txt, fontWeight: '700' }}>{t('close')}</Text></Pressable>
        </View>
        <Text style={[s.rowSub, { marginVertical: 8 }]}>{t('song_note')}</Text>
        {busy && <ActivityIndicator color={C.g1} style={{ marginTop: 10 }} />}
        {!!err && <Text style={[s.errTxt, { marginTop: 20 }]}>{err}</Text>}
        <FlatList
          data={res}
          keyExtractor={(r) => String(r.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListEmptyComponent={!busy && !err ? <Text style={[s.mutTxt, { marginTop: 20 }]}>{t('song_none')}</Text> : null}
          renderItem={({ item: r }) => (
            <View style={s.row}>
              <Pressable onPress={() => preview(r)} style={s.songPlay}>
                {r.cover ? <Image source={{ uri: r.cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                <View style={s.songPlayIc}><Text style={{ color: '#fff', fontSize: 16 }}>{playing === r.id ? '⏸' : '▶'}</Text></View>
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => { stopSong(); onPick(r); }}>
                <Text style={s.rowName} numberOfLines={1}>{r.title}</Text>
                <Text style={s.rowSub} numberOfLines={1}>{r.artist}</Text>
              </Pressable>
              <Pressable onPress={() => { stopSong(); onPick(r); }} style={s.pickBtn}><Text style={{ color: '#fff', fontWeight: '800' }}>+</Text></Pressable>
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

/* ============================== CONTACT FIELDS ============================== */
const CONTACT_APPS = ['call', 'sms', 'whatsapp', 'viber'];
function ContactFields({ t, on, setOn, phone, setPhone, apps, setApps }) {
  const toggle = (a) => setApps(apps.includes(a) ? apps.filter((x) => x !== a) : [...apps, a]);
  return (
    <View style={s.box}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[s.rowName, { flex: 1 }]}>📞 {t('contact_on')}</Text>
        <Switch value={on} onValueChange={setOn} trackColor={{ true: C.g1, false: '#3a3844' }} thumbColor="#fff" />
      </View>
      {on && <>
        <Label>{t('contact_phone')}</Label>
        <TextInput value={phone} onChangeText={setPhone} placeholder={t('contact_ph')} placeholderTextColor={C.mut} keyboardType="phone-pad" maxLength={22} style={s.input} />
        <Label>{t('contact_how')}</Label>
        <View style={s.catWrap}>
          {CONTACT_APPS.map((a) => (
            <Pressable key={a} onPress={() => toggle(a)} style={[s.catBtn, apps.includes(a) && s.catOn]}><Text style={s.catTxt}>{t('c_' + a)}</Text></Pressable>
          ))}
        </View>
        <Text style={[s.rowSub, { marginTop: 8 }]}>⚠️ {t('contact_warn')}</Text>
      </>}
    </View>
  );
}

/* ============================== POST ============================== */
function Post({ t, lang, uid, detector, onDone }) {
  const [place, setPlace] = usePlace();
  const [img, setImg] = useState(null); // {uri, b64, small}
  const [check, setCheck] = useState(null); // null | 'wait' | {animal, cat, conf, cls} | {error}
  const [name, setName] = useState('');
  const [cat, setCat] = useState('psi');
  const [city, setCity] = useState('');
  const [cc, setCc] = useState(place.cc);
  const [caption, setCaption] = useState('');
  const [song, setSong] = useState(null);
  const [songOpen, setSongOpen] = useState(false);
  const [cOn, setCOn] = useState(false);
  const [phone, setPhone] = useState('');
  const [apps, setApps] = useState(['call', 'whatsapp', 'viber']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ccOpen, setCcOpen] = useState(false);
  useEffect(() => { setCc(place.cc); if (place.city) setCity((c) => c || place.city); }, [place.cc, place.city]);
  useEffect(() => { AsyncStorage.getItem('paws-phone').then((v) => { if (v) setPhone(v); }).catch(() => {}); }, []);

  async function runCheck(small) {
    setCheck('wait');
    try {
      const res = await detector.current.detect(small);
      if (!res.ok) throw new Error(res.error);
      const result = { animal: res.animal, conf: res.conf, cls: res.cls, cat: res.animal ? catOfClass(res.cls) : null };
      setCheck(result);
      if (result.animal) setCat(result.cat);
    } catch (e) {
      setCheck({ error: true, animal: false }); // no check, no post
    }
  }
  async function pick() {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Paws', t('perm')); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const scale = Math.min(1, 1080 / Math.max(a.width || 1080, a.height || 1080));
    const m = await manipulateAsync(a.uri, scale < 1 ? [{ resize: { width: Math.round((a.width || 1080) * scale) } }] : [], { compress: 0.82, format: SaveFormat.JPEG, base64: true });
    const small = await manipulateAsync(m.uri, [{ resize: { width: 448 } }], { compress: 0.9, format: SaveFormat.JPEG, base64: true });
    setImg({ uri: m.uri, b64: m.base64, small: small.base64 });
    runCheck(small.base64);
  }

  async function publish() {
    if (!img || !check || check === 'wait' || !check.animal) { setErr(t('err_img')); return; }
    if (!name.trim()) { setErr(t('err_name')); return; }
    if (cOn && !PHONE_RE.test(phone.trim())) { setErr(t('err_phone')); return; }
    setBusy(true); setErr(null);
    try {
      const path = `${uid}/${Date.now()}.jpg`;
      const up = await supabase.storage.from('pet-photos').upload(path, decode(img.b64), { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const row = {
        owner_id: uid, name: name.trim().slice(0, 24), category: cat, city: city.trim().slice(0, 40) || null, country_code: cc,
        caption: caption.trim().slice(0, 120) || null, photo_path: path,
        ai_label: String(check.cls), ai_confidence: Math.min(1, check.conf),
      };
      if (song) Object.assign(row, { song_id: song.id, song_title: song.title.slice(0, 80), song_artist: song.artist.slice(0, 80), song_cover: song.cover });
      if (cOn) Object.assign(row, { contact_phone: phone.trim(), contact_apps: apps.length ? apps : ['call'] });
      const { data: ins, error } = await supabase.from('pets').insert(row).select('id').single();
      if (error) {
        supabase.storage.from('pet-photos').remove([path]).catch(() => {});
        if (/not_an_animal/.test(error.message || '')) { setCheck({ animal: false }); throw new Error(t('ai_no')); }
        if (/column/.test(error.message || '')) throw new Error(t('need_db'));
        throw error;
      }
      setPlace({ cc, city: city.trim() || place.city });
      if (cOn) AsyncStorage.setItem('paws-phone', phone.trim()).catch(() => {});
      setImg(null); setCheck(null); setName(''); setCaption(''); setSong(null);
      onDone(ins?.id);
    } catch (e) { setErr((e?.message && !/fetch|network/i.test(e.message)) ? e.message : t('err_net')); }
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={s.pageH}>{t('up_h')}</Text>
      <Text style={[s.mutTxt, { marginBottom: 14, textAlign: 'left' }]}>{t('up_sub')}</Text>
      <Pressable onPress={pick} style={s.drop}>
        {img ? <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          : <><Text style={{ fontSize: 34 }}>📷</Text><Text style={[s.mutTxt, { marginTop: 6, fontWeight: '700' }]}>{t('up_pick')}</Text></>}
      </Pressable>
      {check === 'wait' && <View style={[s.ai, s.aiWait]}><ActivityIndicator color="#fff" /><Text style={s.aiTxt}>{t('ai_wait')}{'\n'}<Text style={s.aiSmall}>{t('ai_wait2')}</Text></Text></View>}
      {check && check !== 'wait' && (check.error
        ? <View style={[s.ai, s.aiNo]}><Text style={[s.aiTxt, { color: '#FF8FA8' }]}>⚠️ {t('ai_err')}{'\n'}<Text style={s.aiSmall}>{t('ai_err2')}</Text></Text>
          <Pressable onPress={() => runCheck(img.small)} style={s.pickBtn}><Text style={{ color: '#fff', fontWeight: '800' }}>↻</Text></Pressable></View>
        : check.animal
          ? <View style={[s.ai, s.aiOk]}><Text style={[s.aiTxt, { color: '#6BEBB4' }]}>✓ {t('ai_ok')}: {CATS.find((c) => c[0] === check.cat)?.[1]} {t('c_' + check.cat)}{'\n'}<Text style={s.aiSmall}>{Math.round(check.conf * 100)}% {t('ai_sure')}</Text></Text></View>
          : <View style={[s.ai, s.aiNo]}><Text style={[s.aiTxt, { color: '#FF8FA8' }]}>✗ {t('ai_no')}{'\n'}<Text style={s.aiSmall}>{t('ai_no2')}</Text></Text></View>)}

      <Label>{t('up_name')}</Label>
      <TextInput value={name} onChangeText={setName} maxLength={24} style={s.input} placeholderTextColor={C.mut} />
      <Label>{t('up_cat')}</Label>
      <View style={s.catWrap}>
        {CATS.slice(1).map(([k, e]) => (
          <Pressable key={k} onPress={() => setCat(k)} style={[s.catBtn, cat === k && s.catOn]}><Text style={s.catTxt}>{e} {t('c_' + k)}</Text></Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Label>{t('up_city')}</Label><TextInput value={city} onChangeText={setCity} maxLength={40} style={s.input} /></View>
        <View style={{ flex: 1 }}><Label>{t('up_country')}</Label>
          <Pressable onPress={() => setCcOpen(true)} style={[s.input, { justifyContent: 'center' }]}><Text style={{ color: C.txt }} numberOfLines={1}>{flagOf(cc)} {countryName(cc, lang)}</Text></Pressable>
        </View>
      </View>
      <Label>{t('up_cap')}</Label>
      <TextInput value={caption} onChangeText={setCaption} maxLength={120} style={s.input} />

      <Label>{t('song')}</Label>
      {song ? (
        <View style={[s.box, { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 0 }]}>
          {song.cover ? <Image source={{ uri: song.cover }} style={{ width: 44, height: 44, borderRadius: 10 }} /> : <Text style={{ fontSize: 26 }}>🎵</Text>}
          <View style={{ flex: 1 }}><Text style={s.rowName} numberOfLines={1}>{song.title}</Text><Text style={s.rowSub} numberOfLines={1}>{song.artist}</Text></View>
          <Pressable onPress={() => setSong(null)}><Text style={{ color: C.mut, fontSize: 20, padding: 6 }}>✕</Text></Pressable>
        </View>
      ) : <Btn label={t('add_song')} secondary onPress={() => setSongOpen(true)} />}

      <ContactFields t={t} on={cOn} setOn={setCOn} phone={phone} setPhone={setPhone} apps={apps} setApps={setApps} />

      {!!err && <Text style={[s.errTxt, { marginTop: 10, textAlign: 'left' }]}>{err}</Text>}
      <Btn label={busy ? t('uploading') : t('publish')} onPress={publish} disabled={busy || !check || check === 'wait' || !check.animal} style={{ marginTop: 18 }} />

      <CountryPicker visible={ccOpen} lang={lang} onClose={() => setCcOpen(false)} onPick={setCc} />
      <SongPicker visible={songOpen} t={t} onClose={() => setSongOpen(false)} onPick={(r) => { setSong(r); setSongOpen(false); }} />
    </ScrollView>
  );
}

/* ============================== MINE: my posts, like my own listings ============================== */
function Mine({ t, lang, uid, refreshKey, onPost, posted, clearPosted }) {
  const [pets, setPets] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  const [invite, setInvite] = useState(null);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setErr(null);
    try {
      const { data, error } = await selectPets((q) => q.eq('owner_id', uid).neq('status', 'removed').order('created_at', { ascending: false }));
      if (error) throw error;
      setPets(data || []);
      const ids = (data || []).map((p) => p.id);
      if (ids.length) { const { data: r } = await supabase.from('rewards').select('*').in('pet_id', ids); setRewards(r || []); }
    } catch (e) { setErr(t('err_net') + (e?.message ? '\n' + e.message : '')); }
  }, [uid, t]);
  useEffect(() => { load(); }, [load, refreshKey]);
  // right after posting: show the invite window for the new post
  useEffect(() => { if (posted && pets) { const p = pets.find((x) => x.id === posted) ; if (p) { setInvite({ ...p, _posted: true }); clearPosted(); } } }, [posted, pets, clearPosted]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const total = (pets || []).reduce((a, p) => a + (p.paws_count || 0), 0);

  if (err) return <View style={s.center}><Text style={s.errTxt}>{err}</Text><Btn label={t('retry')} onPress={load} style={{ marginTop: 16 }} /></View>;
  if (!pets) return <View style={s.center}><ActivityIndicator color={C.g1} size="large" /></View>;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.g1} colors={[C.g1]} />}>
        <Text style={s.pageH}>{t('my_posts')}</Text>
        <View style={s.statRow}>
          <View style={s.stat}><Text style={s.statN}>{pets.length}</Text><Text style={s.rowSub}>{t('posts_n')}</Text></View>
          <View style={s.stat}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Feet size={18} color={C.g2} /><Text style={s.statN}>{fmt(total, lang)}</Text></View><Text style={s.rowSub}>{t('total')}</Text></View>
        </View>
        {pets.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Elephant width={200} />
            <Text style={[s.mutTxt, { marginVertical: 14 }]}>{t('empty_mine')}</Text>
            <Btn label={t('btn_post')} onPress={onPost} />
          </View>
        ) : pets.map((p) => {
          const l = levelOf(p.paws_count || 0), next = LEVELS[l + 1];
          return (
            <View key={p.id} style={s.myCard}>
              <Pressable onPress={() => setView(p)}>
                <Image source={{ uri: photoUrl(p.photo_path) }} style={s.myImg} contentFit="cover" transition={150} />
                <View style={s.myPaws}><Feet size={16} /><Text style={s.giTxt}>{fmt(p.paws_count, lang)}</Text></View>
                {p.status === 'hidden' && <View style={s.giHidden}><Text style={s.giTxt}>{t('status_hidden')}</Text></View>}
              </Pressable>
              <View style={{ padding: 14 }}>
                <Text style={s.rowName}>{p.name}</Text>
                <Text style={s.rowSub}>{flagOf(p.country_code)} {p.city || countryName(p.country_code, lang)} · {agoText(p.created_at, t)}</Text>
                {!!p.caption && <Text style={[s.rowSub, { color: C.txt, marginTop: 6 }]}>{p.caption}</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {!!p.song_id && <Text style={s.tag}>♪ {p.song_title}</Text>}
                  {!!p.contact_phone && <Text style={s.tag}>📞 {p.contact_phone}</Text>}
                  <Text style={s.tag}>{l >= 0 ? `${LEVELS[l][2]} ${t(LEVELS[l][1])}` : t('ms_new')}{next ? ` · ${t('ms_left', { n: fmt(next[0] - (p.paws_count || 0), lang) })}` : ''}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Btn label={'✏️ ' + t('edit')} secondary onPress={() => setEdit(p)} style={{ flex: 1 }} />
                  <Btn label={'↗ ' + t('invite')} onPress={() => setInvite(p)} style={{ flex: 1 }} />
                </View>
              </View>
            </View>
          );
        })}
        <Text style={[s.rowSub, { textAlign: 'center', marginTop: 24, opacity: 0.5 }]}>ID {uid.slice(0, 8)}</Text>
      </ScrollView>
      {edit && <EditPost t={t} lang={lang} p={edit} rewards={rewards.filter((r) => r.pet_id === edit.id)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {view && <PetView p={view} t={t} lang={lang} uid={uid} onClose={() => setView(null)} />}
      <InviteSheet t={t} p={invite} posted={invite && invite._posted} onClose={() => setInvite(null)} />
    </View>
  );
}

function EditPost({ t, lang, p, rewards, onClose, onSaved }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(p.name || '');
  const [city, setCity] = useState(p.city || '');
  const [caption, setCaption] = useState(p.caption || '');
  const [song, setSong] = useState(p.song_id ? { id: p.song_id, title: p.song_title, artist: p.song_artist, cover: p.song_cover } : null);
  const [songOpen, setSongOpen] = useState(false);
  const [cOn, setCOn] = useState(!!p.contact_phone);
  const [phone, setPhone] = useState(p.contact_phone || '');
  const [apps, setApps] = useState(p.contact_apps || ['call', 'whatsapp', 'viber']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function save() {
    if (!name.trim()) { setErr(t('err_name')); return; }
    if (cOn && !PHONE_RE.test(phone.trim())) { setErr(t('err_phone')); return; }
    setBusy(true); setErr(null);
    const patch = {
      name: name.trim().slice(0, 24), city: city.trim().slice(0, 40) || null, caption: caption.trim().slice(0, 120) || null,
      song_id: song ? song.id : null, song_title: song ? song.title.slice(0, 80) : null, song_artist: song ? song.artist.slice(0, 80) : null, song_cover: song ? song.cover : null,
      contact_phone: cOn ? phone.trim() : null, contact_apps: cOn ? (apps.length ? apps : ['call']) : null,
    };
    const { error } = await supabase.from('pets').update(patch).eq('id', p.id);
    setBusy(false);
    if (error) { setErr(/column/.test(error.message) ? t('need_db') : t('err_net')); return; }
    if (cOn) AsyncStorage.setItem('paws-phone', phone.trim()).catch(() => {});
    onSaved();
  }
  function del() {
    Alert.alert(t('delete'), t('delete_q'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => {
        await supabase.from('pets').delete().eq('id', p.id);
        await supabase.storage.from('pet-photos').remove([p.photo_path]);
        onSaved();
      } },
    ], { cancelable: true });
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <View style={s.editTop}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: C.txt, fontSize: 16, fontWeight: '700' }}>✕ {t('close')}</Text></Pressable>
          <Text style={[s.rowName, { fontSize: 16 }]}>{t('edit_post')}</Text>
          <Pressable onPress={save} disabled={busy} hitSlop={12}><Text style={{ color: C.g2, fontSize: 16, fontWeight: '800' }}>{busy ? '…' : t('save')}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <Image source={{ uri: photoUrl(p.photo_path) }} style={[s.myImg, { borderRadius: 18 }]} contentFit="cover" />
          <Label>{t('up_name')}</Label>
          <TextInput value={name} onChangeText={setName} maxLength={24} style={s.input} />
          <Label>{t('up_city')}</Label>
          <TextInput value={city} onChangeText={setCity} maxLength={40} style={s.input} />
          <Label>{t('up_cap')}</Label>
          <TextInput value={caption} onChangeText={setCaption} maxLength={120} style={s.input} multiline />
          <Label>{t('song')}</Label>
          {song ? (
            <View style={[s.box, { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 0 }]}>
              {song.cover ? <Image source={{ uri: song.cover }} style={{ width: 44, height: 44, borderRadius: 10 }} /> : <Text style={{ fontSize: 26 }}>🎵</Text>}
              <View style={{ flex: 1 }}><Text style={s.rowName} numberOfLines={1}>{song.title}</Text><Text style={s.rowSub} numberOfLines={1}>{song.artist}</Text></View>
              <Pressable onPress={() => setSong(null)}><Text style={{ color: C.mut, fontSize: 20, padding: 6 }}>✕</Text></Pressable>
            </View>
          ) : <Btn label={t('add_song')} secondary onPress={() => setSongOpen(true)} />}
          <ContactFields t={t} on={cOn} setOn={setCOn} phone={phone} setPhone={setPhone} apps={apps} setApps={setApps} />
          {!!err && <Text style={[s.errTxt, { marginTop: 10, textAlign: 'left' }]}>{err}</Text>}
          <Btn label={busy ? '…' : t('save')} onPress={save} disabled={busy} style={{ marginTop: 18 }} />

          <Text style={s.secH}>{t('rewards_h')}</Text>
          {LEVELS.map((m, i) => {
            const got = (p.paws_count || 0) >= m[0];
            const rw = rewards.find((r) => r.level === i + 1);
            return (
              <View key={m[1]} style={[s.lvl, got && s.lvlGot]}>
                <Text style={{ fontSize: 20 }}>{m[2]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{t(m[1])} · {fmt(m[0], lang)}</Text>
                  <Text style={s.rowSub}>{t(m[1] + 'd')}</Text>
                  {rw?.promo_code ? <Text style={[s.rowSub, { color: C.ok }]}>{t('code')}: {rw.promo_code}</Text> : null}
                </View>
                <Text style={[s.rowSub, got && { color: C.ok }]}>{got ? t('got') : t('left', { n: fmt(m[0] - (p.paws_count || 0), lang) })}</Text>
              </View>
            );
          })}
          <Btn label={'🗑 ' + t('delete')} secondary onPress={del} style={{ marginTop: 20 }} />
        </ScrollView>
        <SongPicker visible={songOpen} t={t} onClose={() => setSongOpen(false)} onPick={(r) => { setSong(r); setSongOpen(false); }} />
      </View>
    </Modal>
  );
}

/* ============================== UI bits ============================== */
function Btn({ label, onPress, style, disabled, secondary }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[{ opacity: disabled ? 0.45 : 1 }, style]}>
      {secondary
        ? <View style={[s.btn, { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: C.line }]}><Text style={s.btnTxt}>{label}</Text></View>
        : <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btn}><Text style={s.btnTxt}>{label}</Text></LinearGradient>}
    </Pressable>
  );
}
const Label = ({ children }) => <Text style={s.label}>{children}</Text>;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoMark: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoTxt: { color: C.txt, fontSize: 21, fontWeight: '800', letterSpacing: -0.5 },
  langBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: C.line },
  langTxt: { color: C.txt, fontWeight: '700', fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  mutTxt: { color: C.mut, fontSize: 14, textAlign: 'center' },
  errTxt: { color: '#FF8FA8', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  tabbar: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 8, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line },
  tabBtn: { alignItems: 'center', minWidth: 64 },
  tabIc: { fontSize: 21 },
  tabLb: { color: C.mut, fontSize: 11, fontWeight: '700', marginTop: 2 },
  plus: { width: 54, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  plusTxt: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: -2 },
  chips: { position: 'absolute', top: 10, left: 0, right: 0, flexGrow: 0 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  chipOn: { backgroundColor: '#fff' },
  chipTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  burst: { position: 'absolute', alignSelf: 'center', top: '36%' },
  meta: { position: 'absolute', left: 16, right: 86, bottom: 22 },
  badgeFeat: { alignSelf: 'flex-start', backgroundColor: '#FFC25E', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, marginBottom: 8 },
  badgeFeatTxt: { color: '#2a1a00', fontWeight: '800', fontSize: 12 },
  petName: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  petPlace: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', marginTop: 3 },
  caption: { color: 'rgba(255,255,255,0.92)', fontSize: 15, marginTop: 8, lineHeight: 21 },
  ms: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.4)', alignSelf: 'flex-start', maxWidth: '100%' },
  msTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  msBar: { width: 54, height: 5, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  credit: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 8 },
  rail: { position: 'absolute', right: 12, bottom: 26, alignItems: 'center', gap: 16 },
  railBtn: { alignItems: 'center' },
  railO: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  railOff: { backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  railIc: { fontSize: 24, color: '#fff' },
  railTxt: { color: '#fff', fontSize: 12, fontWeight: '800', marginTop: 4 },
  weekBox: { borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(255,79,123,0.3)', alignItems: 'flex-start' },
  weekH: { color: C.txt, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  secH: { color: C.mut, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 22, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  pos: { width: 22, color: C.mut, fontWeight: '800', textAlign: 'center' },
  rowImg: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.card },
  rowName: { color: C.txt, fontWeight: '700', fontSize: 15 },
  rowSub: { color: C.mut, fontSize: 12, marginTop: 1 },
  rowRight: { color: C.txt, fontWeight: '800', fontSize: 14 },
  pageH: { color: C.txt, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  drop: { height: 230, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,79,123,0.45)', backgroundColor: 'rgba(255,79,123,0.05)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ai: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 14 },
  aiWait: { backgroundColor: 'rgba(255,255,255,0.06)' },
  aiOk: { backgroundColor: 'rgba(61,220,151,0.12)' },
  aiNo: { backgroundColor: 'rgba(255,79,123,0.12)' },
  aiTxt: { color: C.txt, fontWeight: '700', fontSize: 14, flex: 1 },
  aiSmall: { fontWeight: '500', fontSize: 12, color: C.mut },
  label: { color: C.mut, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, height: 48, color: C.txt, fontSize: 15 },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  catOn: { backgroundColor: 'rgba(255,79,123,0.15)', borderColor: 'rgba(255,79,123,0.6)' },
  catTxt: { color: C.txt, fontWeight: '700', fontSize: 13 },
  btn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, borderWidth: 1, borderColor: C.line },
  sheetH: { color: C.txt, fontSize: 19, fontWeight: '800', marginBottom: 8 },
  langRow: { paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12 },
  langRowTxt: { color: C.txt, fontSize: 16, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 14 },
  gi: { width: '32.6%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden', backgroundColor: C.card },
  giCnt: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  giHidden: { position: 'absolute', top: 0, left: 0, right: 0, padding: 4, backgroundColor: 'rgba(0,0,0,0.6)' },
  giTxt: { color: '#fff', fontWeight: '800', fontSize: 12, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  lvl: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, marginTop: 6 },
  lvlGot: { borderColor: 'rgba(61,220,151,0.4)', backgroundColor: 'rgba(61,220,151,0.07)' },
  welcome: { flex: 1, backgroundColor: C.bg, justifyContent: 'flex-end' },
  welcomeImg: { position: 'absolute', top: 0, left: 0, right: 0, height: '62%' },
  welcomeFade: { position: 'absolute', left: 0, right: 0, top: '35%', height: '28%' },
  welcomeH: { color: C.txt, fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 38 },
  intro: { backgroundColor: C.bg, zIndex: 50, elevation: 50 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnSec: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: C.line },
  closeX: { position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  songChip: { marginTop: 10, alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  songTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  seg: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  segOn: { backgroundColor: '#fff' },
  segTxt: { color: C.txt, fontWeight: '800', fontSize: 13 },
  placeBox: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  box: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  songPlay: { width: 48, height: 48, borderRadius: 10, overflow: 'hidden', backgroundColor: C.card },
  songPlayIc: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  pickBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.g1 },
  sheet2: { backgroundColor: C.bg2, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingTop: 12, borderWidth: 1, borderColor: C.line },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 10 },
  sheetX: { position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  invGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  invItem: { width: '24%', alignItems: 'center' },
  invIc: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  invIcTxt: { color: '#fff', fontSize: 19, fontWeight: '900' },
  invLb: { color: C.txt, fontSize: 11.5, marginTop: 6, fontWeight: '600' },
  repRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 14, backgroundColor: C.card, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 16 },
  stat: { flex: 1, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  statN: { color: C.txt, fontSize: 22, fontWeight: '900' },
  myCard: { borderRadius: 20, overflow: 'hidden', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, marginBottom: 16 },
  myImg: { width: '100%', aspectRatio: 1.25, backgroundColor: '#000' },
  myPaws: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  tag: { color: C.txt, fontSize: 12, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
  editTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
});
