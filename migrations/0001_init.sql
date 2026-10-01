CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'Europe/Luxembourg',
    currency TEXT NOT NULL DEFAULT 'EUR',
    theme TEXT NOT NULL DEFAULT 'system',
    holiday_country TEXT,
    prefs TEXT NOT NULL DEFAULT '{}',
    onboarded_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                 -- SHA-256 du jeton
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT,
    ip TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE webauthn_credentials (
    id TEXT PRIMARY KEY,                 -- credential id (base64url)
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT NOT NULL DEFAULT 'Appareil',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX webauthn_user ON webauthn_credentials(user_id);

  CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE pay_rule_versions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    effective_from TEXT NOT NULL,
    rules TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, effective_from)
  );

  CREATE TABLE shifts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at INTEGER NOT NULL,
    end_at INTEGER,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'clock',   -- clock | manual
    bonus_ids TEXT NOT NULL DEFAULT '[]',
    edited_at INTEGER,
    start_lat REAL, start_lng REAL, start_accuracy REAL,
    end_lat REAL, end_lng REAL, end_accuracy REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (end_at IS NULL OR end_at >= start_at)
  );
  CREATE INDEX shifts_user_start ON shifts(user_id, start_at);
  CREATE UNIQUE INDEX shifts_one_open ON shifts(user_id) WHERE end_at IS NULL;

  CREATE TABLE breaks (
    id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    start_at INTEGER NOT NULL,
    end_at INTEGER,
    CHECK (end_at IS NULL OR end_at >= start_at)
  );
  CREATE INDEX breaks_shift ON breaks(shift_id);

  CREATE TABLE absences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    kind TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 1,
    hours REAL NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, date)
  );

  CREATE TABLE holidays (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (user_id, date)
  );

  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE notification_log (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );
