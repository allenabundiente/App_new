/**
 * MMKV-backed key-value store — used for the tiny bits of data that live
 * OUTSIDE SQLite: the logged-in user id (session), and UI preferences.
 *
 * Why not put the session in SQLite? Sessions are ephemeral by nature — you
 * want them readable synchronously at boot (before the async DB opens) and
 * trivially clearable on logout. SQLite stays the source of truth for
 * business data; MMKV is the fast local scratchpad.
 */
import { createMMKV } from 'react-native-mmkv';

export const kv = createMMKV({
  id: 'hulogtrack',
});

const KEY_SESSION_USER_ID = 'session.userId';
const KEY_LAST_EMAIL = 'session.lastEmail';

export const session = {
  getUserId(): string | null {
    return kv.getString(KEY_SESSION_USER_ID) ?? null;
  },
  setUserId(id: string | null) {
    if (id) {
      kv.set(KEY_SESSION_USER_ID, id);
    } else {
      kv.remove(KEY_SESSION_USER_ID);
    }
  },
  /** Remember the last typed email on the login screen (small nicety). */
  getLastEmail(): string {
    return kv.getString(KEY_LAST_EMAIL) ?? '';
  },
  setLastEmail(email: string) {
    kv.set(KEY_LAST_EMAIL, email);
  },
};
