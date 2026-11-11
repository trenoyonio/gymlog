/* Gym Log — archivio dati sul telefono (IndexedDB) */
'use strict';

const DB = (() => {
  const NAME = 'gymlog';
  const VERSION = 1;
  const STORES = ['exercises', 'plans', 'workouts', 'meta'];
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('exercises')) d.createObjectStore('exercises', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('plans')) d.createObjectStore('plans', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('workouts')) d.createObjectStore('workouts', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => { db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      const r = fn(t);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Operazione annullata'));
    });
  }

  const all = (store) => run([store], 'readonly', (t) => t.objectStore(store).getAll());
  const put = (store, value) => run([store], 'readwrite', (t) => t.objectStore(store).put(value));
  const del = (store, id) => run([store], 'readwrite', (t) => t.objectStore(store).delete(id));
  const putMany = (store, values) => run([store], 'readwrite', (t) => {
    const s = t.objectStore(store);
    values.forEach((v) => s.put(v));
  });

  async function getMeta(key) {
    const v = await run(['meta'], 'readonly', (t) => t.objectStore('meta').get(key));
    return v ? v.value : undefined;
  }
  const setMeta = (key, value) => put('meta', { key, value });

  /* Sostituisce tutto in un'unica transazione: o va tutto, o non cambia niente. */
  function replaceAll(data) {
    return run(STORES, 'readwrite', (t) => {
      ['exercises', 'plans', 'workouts'].forEach((name) => {
        const s = t.objectStore(name);
        s.clear();
        (data[name] || []).forEach((v) => s.put(v));
      });
    });
  }

  return { open, all, put, del, putMany, getMeta, setMeta, replaceAll };
})();

/* Esercizi predefiniti. bw = corpo libero: il peso diventa la zavorra. */
const DEFAULT_EXERCISES = [
  ['Panca piana', 'Petto'], ['Panca inclinata bilanciere', 'Petto'], ['Panca inclinata manubri', 'Petto'],
  ['Panca declinata', 'Petto'], ['Chest press', 'Petto'], ['Croci con manubri', 'Petto'], ['Croci ai cavi', 'Petto'],
  ['Pec deck', 'Petto'], ['Dips', 'Petto', true], ['Push-up', 'Petto', true],
  ['Lat machine', 'Schiena'], ['Trazioni', 'Schiena', true], ['Rematore bilanciere', 'Schiena'],
  ['Rematore manubrio', 'Schiena'], ['Pulley basso', 'Schiena'], ['Stacco da terra', 'Schiena'],
  ['Hyperextension', 'Schiena', true], ['Scrollate', 'Schiena'],
  ['Military press', 'Spalle'], ['Shoulder press manubri', 'Spalle'], ['Arnold press', 'Spalle'],
  ['Alzate laterali', 'Spalle'], ['Alzate frontali', 'Spalle'], ['Face pull', 'Spalle'], ['Tirate al mento', 'Spalle'],
  ['Curl bilanciere', 'Braccia'], ['Curl manubri', 'Braccia'], ['Curl a martello', 'Braccia'],
  ['Curl concentrato', 'Braccia'], ['Push down ai cavi', 'Braccia'], ['French press', 'Braccia'],
  ['Estensioni sopra la testa', 'Braccia'],
  ['Squat', 'Gambe'], ['Hack squat', 'Gambe'], ['Leg press', 'Gambe'], ['Affondi', 'Gambe'],
  ['Squat bulgaro', 'Gambe'], ['Stacco rumeno', 'Gambe'], ['Leg extension', 'Gambe'], ['Leg curl', 'Gambe'],
  ['Hip thrust', 'Gambe'], ['Abductor machine', 'Gambe'], ['Calf in piedi', 'Gambe'],
  ['Crunch', 'Core', true], ['Crunch ai cavi', 'Core'], ['Sollevamento gambe', 'Core', true], ['Russian twist', 'Core']
];

const GROUPS = ['Petto', 'Schiena', 'Spalle', 'Braccia', 'Gambe', 'Core'];

function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function defaultExerciseRecords() {
  return DEFAULT_EXERCISES.map(([name, group, bw]) => ({
    id: 'b-' + slug(name), name, group, bw: !!bw, builtin: true, fixedNote: ''
  }));
}
