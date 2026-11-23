import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions,
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
import Detector from './src/Detector';
import {
  supabase, photoUrl, SHARE_BASE, I18N, LANG_NAMES, LANG_FLAGS, deviceLang, deviceRegion, makeT, fmt,
  CATS, COUNTRIES, flagOf, countryName, LEVELS, levelOf, agoText, catOfClass,
} from './src/lib';

const C = { bg: '#0C0B10', bg2: '#131218', card: '#18171F', line: 'rgba(255,255,255,0.08)', txt: '#F5F3F8', mut: '#9B97A8', g1: '#FF4F7B', g2: '#FF9248', ok: '#3DDC97' };
const GRAD = [C.g1, C.g2];
const PAGE = 15;
const PET_FIELDS = 'id,owner_id,name,category,city,country_code,caption,photo_path,paws_count,featured_until,credit,created_at';

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
  const [welcome, setWelcome] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Detector ref={detector} />
      {/* header */}
      <View style={s.header}>
        <View style={s.logoRow}>
          <LinearGradient colors={GRAD} style={s.logoMark}><Text style={{ fontSize: 16 }}>🐾</Text></LinearGradient>
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
        ) : tab === 'feed' ? <Feed t={t} lang={lang} uid={uid} refreshKey={refreshKey} />
          : tab === 'top' ? <Top t={t} lang={lang} />
          : tab === 'post' ? <Post t={t} lang={lang} uid={uid} detector={detector} onDone={() => { setRefreshKey((k) => k + 1); setTab('mine'); }} />
          : <Mine t={t} lang={lang} uid={uid} refreshKey={refreshKey} onPost={() => setTab('post')} />}
      </View>

      {/* tab bar */}
      <View style={[s.tabbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {[['feed', '🏠', t('tab_feed')], ['top', '🏆', t('tab_top')], ['post', '+', t('tab_post')], ['mine', '🐾', t('tab_mine')]].map(([k, ic, lb]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={s.tabBtn}>
            {k === 'post'
              ? <LinearGradient colors={GRAD} style={s.plus}><Text style={s.plusTxt}>+</Text></LinearGradient>
              : <><Text style={[s.tabIc, tab !== k && { opacity: 0.45 }]}>{ic}</Text><Text style={[s.tabLb, tab === k && { color: C.txt }]}>{lb}</Text></>}
          </Pressable>
        ))}
      </View>

      {/* language picker */}
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

      {/* welcome with the elephant */}
      <Modal visible={welcome} animationType="fade" onRequestClose={() => setWelcome(false)}>
        <View style={[s.welcome, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
          <Image source={require('./assets/elephant.jpg')} style={s.welcomeImg} contentFit="cover" />
          <LinearGradient colors={['transparent', C.bg]} style={s.welcomeFade} />
          <View style={{ paddingHorizontal: 24 }}>
            <Text style={s.welcomeH}>{t('h1a')} {t('h1b')}</Text>
            <Text style={[s.welcomeH, { color: C.g2 }]}>{t('h1c')}</Text>
            <Text style={[s.mutTxt, { fontSize: 16, lineHeight: 23, marginTop: 12 }]}>{t('welcome')}</Text>
            <Btn label={t('start')} onPress={async () => { setWelcome(false); try { await AsyncStorage.setItem('paws-welcomed', '1'); } catch (e) {} }} style={{ marginTop: 24 }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ============================== FEED ============================== */
function Feed({ t, lang, uid, refreshKey }) {
  const [cat, setCat] = useState('svi');
  const [items, setItems] = useState([]);
  const [liked, setLiked] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [end, setEnd] = useState(false);
  const [h, setH] = useState(0);
  const lastTap = useRef({ id: null, t: 0 });
  const [burst, setBurst] = useState(null);

  const load = useCallback(async (reset) => {
    if (!reset && (loading || end)) return;
    setLoading(true); setErr(null);
    try {
      const from = reset ? 0 : items.length;
      let q = supabase.from('pets').select(PET_FIELDS).eq('status', 'active').order('created_at', { ascending: false }).range(from, from + PAGE - 1);
      if (cat !== 'svi') q = q.eq('category', cat);
      const { data, error } = await q;
      if (error) throw error;
      let rows = data || [];
      if (reset) {
        let fq = supabase.from('pets').select(PET_FIELDS).eq('status', 'active').gt('featured_until', new Date().toISOString()).limit(5);
        if (cat !== 'svi') fq = fq.eq('category', cat);
        const { data: feat } = await fq;
        const fIds = new Set((feat || []).map((p) => p.id));
        rows = [...(feat || []).map((p) => ({ ...p, _featured: true })), ...rows.filter((p) => !fIds.has(p.id))];
      }
      const ids = rows.map((p) => p.id);
      if (ids.length) {
        const { data: mine } = await supabase.from('paws').select('pet_id').eq('user_id', uid).in('pet_id', ids);
        setLiked((prev) => { const n = new Set(reset ? [] : prev); (mine || []).forEach((m) => n.add(m.pet_id)); return n; });
      }
      setItems((prev) => (reset ? rows : [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]));
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
    const { error } = has
      ? await supabase.from('paws').delete().eq('pet_id', p.id).eq('user_id', uid)
      : await supabase.from('paws').insert({ pet_id: p.id, user_id: uid });
    if (error) { // roll back
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
  const share = (p) => Share.share({ message: `${t('share_msg', { name: p.name })} ${SHARE_BASE}${p.id}` }).catch(() => {});
  function report(p) {
    const send = async (reason) => {
      await supabase.from('reports').insert({ pet_id: p.id, reporter_id: uid, reason });
      Alert.alert('Paws', t('reported'));
    };
    Alert.alert(t('report'), t('report_q'), [
      { text: t('r_noanimal'), onPress: () => send('no_animal') },
      { text: t('r_bad'), onPress: () => send('inappropriate') },
      { text: t('r_spam'), onPress: () => send('spam') },
      { text: t('cancel'), style: 'cancel' },
    ]);
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
          renderItem={({ item: p }) => (
            <Slide p={p} h={h} t={t} lang={lang} on={liked.has(p.id)} burst={burst === p.id}
              onTap={() => onTap(p)} onPaw={() => togglePaw(p)} onShare={() => share(p)} onReport={() => report(p)} />
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
      {/* category chips over the feed */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
        {CATS.map(([k, e]) => (
          <Pressable key={k} onPress={() => setCat(k)} style={[s.chip, cat === k && s.chipOn]}>
            <Text style={[s.chipTxt, cat === k && { color: '#111' }]}>{e} {t('c_' + k)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Slide({ p, h, t, lang, on, burst, onTap, onPaw, onShare, onReport }) {
  const n = p.paws_count || 0, l = levelOf(n), next = LEVELS[l + 1];
  const uri = photoUrl(p.photo_path);
  return (
    <Pressable onPress={onTap} style={{ height: h, backgroundColor: '#000' }}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={s.fade} />
      {burst && <Text style={s.burst}>🐾</Text>}
      <View style={s.meta}>
        {p._featured && <View style={s.badgeFeat}><Text style={s.badgeFeatTxt}>{t('featured')}</Text></View>}
        <Text style={s.petName}>{p.name}</Text>
        <Text style={s.petPlace}>{flagOf(p.country_code)} {p.city || countryName(p.country_code, lang)} · {agoText(p.created_at, t)}</Text>
        {!!p.caption && <Text style={s.caption}>{p.caption}</Text>}
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
          {on ? <LinearGradient colors={GRAD} style={s.railO}><Text style={s.railIc}>🐾</Text></LinearGradient>
            : <View style={[s.railO, s.railOff]}><Text style={s.railIc}>🐾</Text></View>}
          <Text style={s.railTxt}>{fmt(n, lang)}</Text>
        </Pressable>
        <Pressable onPress={onShare} style={s.railBtn}>
          <View style={[s.railO, s.railOff]}><Text style={s.railIc}>↗</Text></View>
          <Text style={s.railTxt}>{t('invite')}</Text>
        </Pressable>
        <Pressable onPress={onReport} style={s.railBtn}>
          <View style={[s.railO, s.railOff, { width: 40, height: 40 }]}><Text style={{ color: '#fff', fontSize: 16 }}>⋯</Text></View>
        </Pressable>
      </View>
    </Pressable>
  );
}

/* ============================== TOP ============================== */
function Top({ t, lang }) {
  const [top, setTop] = useState(null);
  const [winners, setWinners] = useState([]);
  const [err, setErr] = useState(null);
  const load = async () => {
    setErr(null);
    try {
      const { data, error } = await supabase.from('pets').select(PET_FIELDS).eq('status', 'active').order('paws_count', { ascending: false }).limit(50);
      if (error) throw error;
      setTop(data || []);
      const { data: w } = await supabase.from('weekly_winners').select('scope,paws,week_start,pets(' + PET_FIELDS + ')').order('week_start', { ascending: false }).limit(40);
      const latest = w && w[0] ? w.filter((x) => x.week_start === w[0].week_start) : [];
      const reg = deviceRegion();
      setWinners(latest.filter((x) => x.scope === 'world' || x.scope === 'country:' + reg || x.scope.startsWith('cat:')).slice(0, 7));
    } catch (e) { setErr(t('err_net')); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  if (err) return <View style={s.center}><Text style={s.errTxt}>{err}</Text><Btn label={t('retry')} onPress={load} style={{ marginTop: 16 }} /></View>;
  if (!top) return <View style={s.center}><ActivityIndicator color={C.g1} size="large" /></View>;
  const scopeLabel = (sc) => (sc === 'world' ? '🌍 ' + t('world') : sc.startsWith('country:') ? flagOf(sc.slice(8)) + ' ' + countryName(sc.slice(8), lang) : CATS.find((c) => c[0] === sc.slice(4))?.[1] + ' ' + t('c_' + sc.slice(4)));
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <LinearGradient colors={['rgba(255,79,123,0.22)', 'rgba(255,146,72,0.08)']} style={s.weekBox}>
        <Text style={s.weekH}>{t('week_b')}</Text>
        <Text style={s.mutTxt}>{t('week_p')}</Text>
      </LinearGradient>
      {winners.length > 0 && <>
        <Text style={s.secH}>{t('winners')}</Text>
        {winners.map((w) => w.pets && <Row key={w.scope} p={w.pets} lang={lang} left={scopeLabel(w.scope)} right={fmt(w.paws, lang)} />)}
      </>}
      <Text style={s.secH}>{t('alltime')}</Text>
      {top.length === 0 ? <Text style={s.mutTxt}>{t('empty_feed')}</Text>
        : top.map((p, i) => <Row key={p.id} p={p} lang={lang} pos={i + 1} right={fmt(p.paws_count, lang)} />)}
    </ScrollView>
  );
}
function Row({ p, lang, pos, left, right }) {
  return (
    <View style={s.row}>
      {pos ? <Text style={[s.pos, pos <= 3 && { color: C.g2 }]}>{pos}</Text> : null}
      <Image source={{ uri: photoUrl(p.photo_path) }} style={s.rowImg} contentFit="cover" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
        <Text style={s.rowSub} numberOfLines={1}>{left || `${flagOf(p.country_code)} ${p.city || countryName(p.country_code, lang)}`}</Text>
      </View>
      <Text style={s.rowRight}>🐾 {right}</Text>
    </View>
  );
}

/* ============================== POST ============================== */
function Post({ t, lang, uid, detector, onDone }) {
  const [img, setImg] = useState(null); // {uri, b64}
  const [check, setCheck] = useState(null); // null | 'wait' | {animal, cat, conf, cls}
  const [name, setName] = useState('');
  const [cat, setCat] = useState('psi');
  const [city, setCity] = useState('');
  const [cc, setCc] = useState(COUNTRIES.includes(deviceRegion()) ? deviceRegion() : 'RS');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ccOpen, setCcOpen] = useState(false);

  async function pick() {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Paws', t('perm')); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const scale = Math.min(1, 1080 / Math.max(a.width || 1080, a.height || 1080));
    const m = await manipulateAsync(a.uri, scale < 1 ? [{ resize: { width: Math.round((a.width || 1080) * scale) } }] : [], { compress: 0.82, format: SaveFormat.JPEG, base64: true });
    setImg({ uri: m.uri, b64: m.base64 });
    setCheck('wait');
    try {
      const small = await manipulateAsync(m.uri, [{ resize: { width: 320 } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
      const res = await detector.current.detect(small.base64);
      if (!res.ok) throw new Error(res.error);
      const result = { animal: res.animal, conf: res.conf, cls: res.cls, cat: res.animal ? catOfClass(res.cls) : null };
      setCheck(result);
      if (result.animal) setCat(result.cat);
    } catch (e) {
      setCheck({ unavailable: true, animal: true }); // detector offline: allow, reports will catch abuse
    }
  }

  async function publish() {
    if (!img || !check || check === 'wait' || !check.animal) { setErr(t('err_img')); return; }
    if (!name.trim()) { setErr(t('err_name')); return; }
    setBusy(true); setErr(null);
    try {
      const path = `${uid}/${Date.now()}.jpg`;
      const up = await supabase.storage.from('pet-photos').upload(path, decode(img.b64), { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const { error } = await supabase.from('pets').insert({
        owner_id: uid, name: name.trim().slice(0, 24), category: cat, city: city.trim().slice(0, 40) || null, country_code: cc,
        caption: caption.trim().slice(0, 120) || null, photo_path: path,
        ai_label: check.unavailable ? null : String(check.cls), ai_confidence: check.unavailable ? null : Math.min(1, check.conf),
      });
      if (error) throw error;
      setImg(null); setCheck(null); setName(''); setCaption('');
      Alert.alert('Paws', t('posted', { name: name.trim() }));
      onDone();
    } catch (e) { setErr(t('err_net') + '\n' + (e?.message || '')); }
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={s.pageH}>{t('up_h')}</Text>
      <Text style={[s.mutTxt, { marginBottom: 14 }]}>{t('up_sub')}</Text>
      <Pressable onPress={pick} style={s.drop}>
        {img ? <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          : <><Text style={{ fontSize: 34 }}>📷</Text><Text style={[s.mutTxt, { marginTop: 6, fontWeight: '700' }]}>{t('up_pick')}</Text></>}
      </Pressable>
      {check === 'wait' && <View style={[s.ai, s.aiWait]}><ActivityIndicator color="#fff" /><Text style={s.aiTxt}>{t('ai_wait')}{'\n'}<Text style={s.aiSmall}>{t('ai_wait2')}</Text></Text></View>}
      {check && check !== 'wait' && !check.unavailable && (check.animal
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
      {!!err && <Text style={[s.errTxt, { marginTop: 10, textAlign: 'left' }]}>{err}</Text>}
      <Btn label={busy ? t('uploading') : t('publish')} onPress={publish} disabled={busy || check === 'wait' || (check && !check.animal)} style={{ marginTop: 18 }} />

      <Modal visible={ccOpen} transparent animationType="slide" onRequestClose={() => setCcOpen(false)}>
        <Pressable style={s.shade} onPress={() => setCcOpen(false)}>
          <View style={s.sheet}>
            <ScrollView style={{ maxHeight: 460 }}>
              {COUNTRIES.map((c) => (
                <Pressable key={c} onPress={() => { setCc(c); setCcOpen(false); }} style={s.langRow}><Text style={s.langRowTxt}>{flagOf(c)}  {countryName(c, lang)}</Text></Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

/* ============================== MINE ============================== */
function Mine({ t, lang, uid, refreshKey, onPost }) {
  const [pets, setPets] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState(null);
  const load = async () => {
    setErr(null);
    try {
      const { data, error } = await supabase.from('pets').select(PET_FIELDS + ',status').eq('owner_id', uid).order('created_at', { ascending: false });
      if (error) throw error;
      setPets(data || []);
      const ids = (data || []).map((p) => p.id);
      if (ids.length) { const { data: r } = await supabase.from('rewards').select('*').in('pet_id', ids); setRewards(r || []); }
    } catch (e) { setErr(t('err_net')); }
  };
  useEffect(() => { load(); }, [refreshKey]); // eslint-disable-line
  const total = (pets || []).reduce((a, p) => a + (p.paws_count || 0), 0);
  async function del(p) {
    Alert.alert(t('delete'), t('delete_q'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => {
        await supabase.from('pets').delete().eq('id', p.id);
        await supabase.storage.from('pet-photos').remove([p.photo_path]);
        setOpen(null); load();
      } },
    ]);
  }
  if (err) return <View style={s.center}><Text style={s.errTxt}>{err}</Text><Btn label={t('retry')} onPress={load} style={{ marginTop: 16 }} /></View>;
  if (!pets) return <View style={s.center}><ActivityIndicator color={C.g1} size="large" /></View>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={s.pageH}>{t('tab_mine')}</Text>
      <Text style={s.mutTxt}>🐾 {fmt(total, lang)} {t('total')}</Text>
      {pets.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 50 }}>
          <Text style={{ fontSize: 46 }}>📷</Text>
          <Text style={[s.mutTxt, { marginVertical: 12 }]}>{t('empty_mine')}</Text>
          <Btn label={t('btn_post')} onPress={onPost} />
        </View>
      ) : (
        <View style={s.grid}>
          {pets.map((p) => (
            <Pressable key={p.id} onPress={() => setOpen(p)} style={s.gi}>
              <Image source={{ uri: photoUrl(p.photo_path) }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={s.giCnt}><Text style={s.giTxt}>🐾 {fmt(p.paws_count, lang)}</Text></View>
            </Pressable>
          ))}
        </View>
      )}
      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={s.shade} onPress={() => setOpen(null)}>
          {open && (
            <Pressable style={s.sheet} onPress={() => {}}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <Image source={{ uri: photoUrl(open.photo_path) }} style={{ width: 64, height: 64, borderRadius: 14 }} />
                <View style={{ flex: 1 }}><Text style={s.sheetH}>{open.name}</Text><Text style={s.mutTxt}>🐾 {fmt(open.paws_count, lang)} {t('paws')}</Text></View>
              </View>
              {LEVELS.map((m, i) => {
                const got = open.paws_count >= m[0];
                const rw = rewards.find((r) => r.pet_id === open.id && r.level === i + 1);
                return (
                  <View key={m[1]} style={[s.lvl, got && s.lvlGot]}>
                    <Text style={{ fontSize: 20 }}>{m[2]}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowName}>{t(m[1])} · {fmt(m[0], lang)}</Text>
                      <Text style={s.rowSub}>{t(m[1] + 'd')}</Text>
                      {rw?.promo_code ? <Text style={[s.rowSub, { color: C.ok }]}>{t('code')}: {rw.promo_code}</Text> : null}
                    </View>
                    <Text style={[s.rowSub, got && { color: C.ok }]}>{got ? t('got') : t('left', { n: fmt(m[0] - open.paws_count, lang) })}</Text>
                  </View>
                );
              })}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Btn label={t('delete')} secondary onPress={() => del(open)} style={{ flex: 1 }} />
                <Btn label={t('invite')} onPress={() => Share.share({ message: `${t('share_msg', { name: open.name })} ${SHARE_BASE}${open.id}` })} style={{ flex: 1 }} />
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </ScrollView>
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
  burst: { position: 'absolute', alignSelf: 'center', top: '38%', fontSize: 110 },
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
  giCnt: { position: 'absolute', left: 6, bottom: 6 },
  giTxt: { color: '#fff', fontWeight: '800', fontSize: 12, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  lvl: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, marginTop: 6 },
  lvlGot: { borderColor: 'rgba(61,220,151,0.4)', backgroundColor: 'rgba(61,220,151,0.07)' },
  welcome: { flex: 1, backgroundColor: C.bg, justifyContent: 'flex-end' },
  welcomeImg: { position: 'absolute', top: 0, left: 0, right: 0, height: '62%' },
  welcomeFade: { position: 'absolute', left: 0, right: 0, top: '35%', height: '28%' },
  welcomeH: { color: C.txt, fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 38 },
});
