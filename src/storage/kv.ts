/**
 * Small key-value store using MMKV for things that don't belong in the
 * database: who is logged in, and a few UI preferences.
 *
 * The session lives here instead of SQLite because it needs to be readable
 * straight away when the app starts, before the database has opened, and it
 * is easy to wipe on logout.
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
  /** Saves the email typed on the login screen so we can prefill it. */
  getLastEmail(): string {
    return kv.getString(KEY_LAST_EMAIL) ?? '';
  },
  setLastEmail(email: string) {
    kv.set(KEY_LAST_EMAIL, email);
  },
};
