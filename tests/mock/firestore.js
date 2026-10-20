// Test stand-in for firebase-firestore.js.
// - The book comes from tests/fixtures/sample-book.md, parsed with the app's own parser.
// - Users and comments live in memory. Security rules are NOT simulated.
// - The signed-in user (u1) is approved, unless localStorage "mock:approved" = "0"
//   (simulates an admin removing access).
// - window.__approve() approves u1 live, to test the pending -> library switch.
// - localStorage "mock:notReady" = "N" refuses the first N reads of u1's
//   profile with permission-denied, as before new security rules arrive.
// - localStorage "mock:fresh" = "1" starts with no profile for u1, as on a
//   first sign-in, so the app has to create it.
// - localStorage "mock:quotaUsed" = "N" starts u1's daily comment quota at N writes.
// - localStorage "mock:noBook" = "1" means no book is published. Removing the
//   book on the upload page sets it.

const origin = location.origin;
const { parseBook } = await import(`${origin}/js/md-parser.js`);
const bookPromise = fetch(`${origin}/tests/fixtures/sample-book.md`).then((r) => r.text()).then(parseBook);

function ts(minutesAgo = 0) {
  const d = new Date(Date.now() - minutesAgo * 60000);
  return { toDate: () => d, toMillis: () => +d };
}

const users = {
  u1: { displayName: "Test Reader", email: "reader@example.com", photoURL: "", approved: false, admin: true, createdAt: ts(5000) },
  u2: { displayName: "Ana Souza", email: "ana@example.com", photoURL: "", approved: false, admin: false, createdAt: ts(30) },
  u3: { displayName: "Marco Lima", email: "marco@example.com", photoURL: "", approved: true, admin: false, createdAt: ts(900) },
};
users.u1.approved = localStorage.getItem("mock:approved") !== "0";
if (localStorage.getItem("mock:fresh") === "1") delete users.u1;

// Other readers' comments, visible on the admin page.
const otherComments = [
  { id: "x1", uid: "u3", chapterId: "chapter-2", paragraphIndex: 4, text: "Loved this moment.", createdAt: ts(60), updatedAt: ts(60) },
];

// The signed-in user's comments, and their daily comment quota.
const myComments = new Map();
let nextId = 0;
const quotaUsed = Number(localStorage.getItem("mock:quotaUsed") || 0);
let quota = quotaUsed ? { count: quotaUsed, windowStart: ts(60), commentId: "c0", updatedAt: ts(60) } : null;

let notReady = Number(localStorage.getItem("mock:notReady") || 0);
const refuse = () => notReady > 0 && notReady-- > 0;
const denied = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });

const listeners = { me: new Set(), users: new Set(), mine: new Set(), group: new Set() };
const emit = (set) => set.forEach((fn) => fn());

/* ---------- References ---------- */

export const getFirestore = () => ({});
export const doc = (parent, ...path) => {
  // doc(collectionRef) gets an auto id, as in the real SDK.
  if (!path.length) path = [...parent.path.split("/"), `c${++nextId}`];
  return { path: path.join("/"), id: path[path.length - 1] };
};
export const collection = (_db, ...path) => ({ path: path.join("/") });
export const collectionGroup = (_db, name) => ({ path: name, group: true });
export const where = (field, _op, value) => ({ field, value });
export const query = (ref, filter) => ({ ...ref, filter });
export const serverTimestamp = () => ts();

/* ---------- Reads ---------- */

const snapDoc = (id, data, uid) => ({ id, data: () => data, ref: { parent: { parent: { id: uid } } } });

export function onSnapshot(ref, next, onError) {
  if (ref.path.startsWith("users/") && !ref.filter && refuse()) {
    setTimeout(() => onError?.(denied()), 20);
    return () => {};
  }
  let fn;
  let set;
  if (ref.group) {
    set = listeners.group;
    fn = () => next({ docs: [...otherComments, ...myComments.values()].map((c) => snapDoc(c.id, c, c.uid)) });
  } else if (ref.path === "users") {
    set = listeners.users;
    fn = () => next({ docs: Object.entries(users).map(([id, u]) => snapDoc(id, u)) });
  } else if (ref.path.startsWith("users/") && ref.filter) {
    set = listeners.mine;
    fn = () => {
      const docs = [...myComments.values()].filter((c) => c[ref.filter.field] === ref.filter.value);
      next({ forEach: (cb) => docs.forEach((c) => cb(snapDoc(c.id, c, c.uid))) });
    };
  } else if (ref.path.startsWith("users/")) {
    set = listeners.me;
    fn = () => next({ exists: () => true, data: () => users[ref.id] });
  }
  set.add(fn);
  setTimeout(fn, 20);
  return () => set.delete(fn);
}

window.__approve = () => {
  users.u1.approved = true;
  emit(listeners.me);
  emit(listeners.users);
};

export async function getDoc(ref) {
  if (ref.path.endsWith("/limits/commentWrites")) return { exists: () => !!quota, data: () => quota };
  if (ref.path.startsWith("users/") && refuse()) throw denied();
  if (ref.path.startsWith("users/")) return { exists: () => !!users[ref.id], data: () => users[ref.id] };
  const book = await bookPromise;
  if (bookRemoved()) return { exists: () => false, data: () => undefined };
  if (ref.path === "book/meta") {
    return {
      exists: () => true,
      data: () => ({
        title: "Test Title",
        author: "Test Author",
        dedication: "",
        chapters: book.sections.map((s) => ({ id: s.id, title: s.title, order: s.order, paragraphCount: s.paragraphs.length })),
      }),
    };
  }
  const section = book.sections.find((s) => `chapters/${s.id}` === ref.path);
  return { exists: () => !!section, data: () => section };
}

const bookRemoved = () => localStorage.getItem("mock:noBook") === "1";

export async function getDocs(ref) {
  const book = await bookPromise;
  const docs = ref.path === "chapters" && !bookRemoved()
    ? book.sections.map((s) => ({ id: s.id, ref: { path: `chapters/${s.id}`, id: s.id } }))
    : [];
  return { docs, forEach: (fn) => docs.forEach(fn) };
}

/* ---------- Writes ---------- */

export async function setDoc(ref, data) {
  if (!ref.path.startsWith("users/")) return;
  users[ref.id] = { ...data };
  emit(listeners.users);
  emit(listeners.me);
}

export async function addDoc(_ref, data) {
  const id = `c${++nextId}`;
  myComments.set(id, { ...data, id, uid: "u1" });
  emit(listeners.mine);
  emit(listeners.group);
  return { id };
}

export async function updateDoc(ref, data) {
  if (ref.path.startsWith("users/")) {
    Object.assign(users[ref.id], data);
    emit(listeners.users);
    emit(listeners.me);
    return;
  }
  Object.assign(myComments.get(ref.id), data);
  emit(listeners.mine);
  emit(listeners.group);
}

export async function deleteDoc(ref) {
  myComments.delete(ref.id);
  const other = otherComments.findIndex((c) => c.id === ref.id);
  if (other >= 0) otherComments.splice(other, 1);
  emit(listeners.mine);
  emit(listeners.group);
}

// Comment and quota writes are applied on commit, and deleting book/meta removes
// the book (mock:noBook). Other upload-page writes are dropped.
export const writeBatch = () => {
  const ops = [];
  return {
    set: (ref, data) => ops.push(() => {
      if (ref.path.endsWith("/limits/commentWrites")) quota = { ...data };
      else if (ref.path.includes("/comments/")) myComments.set(ref.id, { ...data, id: ref.id, uid: "u1" });
    }),
    update: (ref, data) => ops.push(() => Object.assign(myComments.get(ref.id), data)),
    delete: (ref) => ops.push(() => {
      if (ref.path === "book/meta") localStorage.setItem("mock:noBook", "1");
    }),
    commit: async () => {
      ops.forEach((op) => op());
      emit(listeners.mine);
      emit(listeners.group);
    },
  };
};
