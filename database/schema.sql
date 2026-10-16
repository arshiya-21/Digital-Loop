-- Digital Loop — schema (MySQL 8).
--
-- Applied on every boot. Every statement is `IF NOT EXISTS`, which is how this
-- file stays the single description of the schema rather than one of several.
--
-- THIS DATABASE HOLDS DESIGNS, THE EQUIPMENT CATALOGUE, AND — SINCE THE
-- "ADD DATABASE" FEATURE — CREDENTIALS FOR PLANT DATABASES SOMEBODY REGISTERED.
--
-- There is no foundry table, no line table and no user table, deliberately.
-- SandMan owns the organisation and the accounts; Digital Loop never reads
-- SandMan's own database and never keeps a second copy of it. What a person
-- may see arrives with their launch, is held in memory for as long as the
-- session lasts, and is gone afterwards — see backend/src/services/session-store.js.
--
-- So a design records the foundry and line it belongs to as SandMan's own
-- identifiers, with the names alongside them for display. The names are a
-- snapshot: if a line is renamed in SandMan, the session's copy wins.
--
-- `db_connection` is the exception, and it was asked for deliberately: a
-- database somebody adds in the studio is one this service connects to itself,
-- so its password and SSH key live here. They are encrypted with a key that
-- must come from the environment — see backend/src/services/secrets.js — which
-- means a copy of this data alone is not enough to use them.
--
-- Ids are application-generated strings (`dsg_…`, `ver_…`), never
-- AUTO_INCREMENT: they are minted before the row exists so a caller can build
-- a graph of rows and insert it in one transaction.
--
-- utf8mb4 throughout: a foundry, a line or a piece of equipment may be named
-- in any script, and a name that cannot be stored is a name somebody has to
-- work around.

/*
 * One design per foundry + line. Enforced by the UNIQUE below rather than by
 * convention, because "a line has one loop" is the rule the whole studio is
 * built on: choosing a line is choosing a design.
 *
 * `foundry_id` and `line_id` are SandMan's ids, not ours. `created_by` is a
 * SandMan username, not a foreign key — there is nothing here to point at.
 */
CREATE TABLE IF NOT EXISTS design (
  id                    VARCHAR(40)   NOT NULL,
  foundry_id            VARCHAR(80)   NOT NULL,
  foundry_name          VARCHAR(160)  NOT NULL,
  line_id               VARCHAR(80)   NOT NULL,
  line_name             VARCHAR(160)  NOT NULL,
  name                  VARCHAR(200)  NOT NULL,
  status                VARCHAR(20)   NOT NULL,
  published_version_id  VARCHAR(40)   NULL,
  created_by            VARCHAR(160)  NOT NULL,
  created_at            VARCHAR(40)   NOT NULL,
  updated_at            VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY design_one_per_line (foundry_id, line_id),
  KEY design_by_line (foundry_id, line_id, status),
  CONSTRAINT design_status CHECK (status IN ('draft', 'published', 'archived'))
  -- `published_version_id` deliberately carries no foreign key. It would point
  -- at a table that does not exist yet when this runs, and the two tables
  -- reference each other, so it would have to be added by an ALTER that has no
  -- "IF NOT EXISTS" and would fail on the second boot. A published version is
  -- only ever removed with its design, which cascades; anything else leaves an
  -- id that resolves to no row, and every reader already treats that as
  -- "not published".
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * Every saved version of a design, immutable once written.
 *
 * `layout` is the whole document as JSON — a studio document ({DOC, REG}) or,
 * for designs drawn before the studio changed, a sandman-loop v1 layout.
 * LONGTEXT because a real sand line with its readings runs to tens of
 * kilobytes and nothing here should have an arbitrary ceiling.
 */
CREATE TABLE IF NOT EXISTS design_version (
  id          VARCHAR(40)  NOT NULL,
  design_id   VARCHAR(40)  NOT NULL,
  version     INT          NOT NULL,
  layout      LONGTEXT     NOT NULL,
  note        VARCHAR(500) NULL,
  created_by  VARCHAR(160) NOT NULL,
  created_at  VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY version_per_design (design_id, version),
  CONSTRAINT version_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per tag, not one per piece of equipment.
--
-- A node carries several readings — moisture AND compactability AND
-- temperature on the one mixer — and a gateway subscribes to every one of
-- them. Keying this on (version_id, node_id) alone said a piece of equipment
-- reports a single number: the second reading hit a constraint error and took
-- the whole save down with it.
CREATE TABLE IF NOT EXISTS design_tag (
  version_id  VARCHAR(40)   NOT NULL,
  node_id     VARCHAR(120)  NOT NULL,
  data_tag    VARCHAR(200)  NOT NULL,
  PRIMARY KEY (version_id, node_id, data_tag),
  KEY tag_lookup (data_tag),
  CONSTRAINT tag_of_version FOREIGN KEY (version_id)
    REFERENCES design_version(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The equipment catalogue. Rows here are what the SVG API manages and what
-- layout validation accepts as node types. Shared across every foundry, which
-- is why it is not scoped to one.
CREATE TABLE IF NOT EXISTS asset (
  id             VARCHAR(40)   NOT NULL,
  slug           VARCHAR(120)  NOT NULL,
  name           VARCHAR(200)  NOT NULL,
  category       VARCHAR(80)   NOT NULL,
  width          INT           NOT NULL,
  height         INT           NOT NULL,
  bytes          INT           NOT NULL,
  revision       INT           NOT NULL DEFAULT 1,
  builtin        TINYINT(1)    NOT NULL DEFAULT 0,
  uploaded_by    VARCHAR(160)  NULL,
  created_at     VARCHAR(40)   NOT NULL,
  updated_at     VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY asset_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who changed what, and when. Never the payload, never an email, never a
-- table list: counts and identifiers only.
CREATE TABLE IF NOT EXISTS audit_log (
  id         VARCHAR(40)   NOT NULL,
  actor_id   VARCHAR(160)  NULL,
  action     VARCHAR(80)   NOT NULL,
  entity     VARCHAR(40)   NOT NULL,
  entity_id  VARCHAR(80)   NULL,
  detail     TEXT          NULL,
  at         VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  KEY audit_by_entity (entity, entity_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * One SandMan launch.
 *
 * SandMan mints a ticket server-to-server, then its page posts it into the
 * studio's iframe. Redeeming exchanges it for a session. Short-lived and
 * single-use, so a link cannot be forwarded, bookmarked or replayed.
 *
 * `payload` is the whole launch body as JSON — who is arriving, their role,
 * the foundry, every line they may see and the names of every table in their
 * database. It is the only personal data here, so the row is DELETED on use
 * rather than marked, and anything an abandoned launch left behind is swept
 * away on a timer.
 */
CREATE TABLE IF NOT EXISTS launch_ticket (
  id           VARCHAR(40)  NOT NULL,
  payload      LONGTEXT     NOT NULL,
  issued_at    VARCHAR(40)  NOT NULL,
  expires_at   VARCHAR(40)  NOT NULL,
  redeemed_at  VARCHAR(40)  NULL,
  PRIMARY KEY (id),
  KEY ticket_by_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * An SOP document somebody uploaded against a process.
 *
 * The studio's Process & SOP workspace lets a procedure be attached to a
 * process as a PDF, a spreadsheet or a Word file. **The studio keeps those
 * files in the browser's own IndexedDB** — its own notes say so, and say to
 * replace that for production. In a browser they are invisible to the next
 * terminal and gone when somebody clears site data, which is not where a
 * foundry's written procedure belongs.
 *
 * So the metadata lives here and the bytes live beside the equipment artwork
 * in `backend/uploads/sop/`. Same reasoning as `asset`: a row is small and
 * queryable, a 25MB PDF in a column makes every backup and every dump carry
 * it. `id` is the id the studio minted, so nothing has to be translated.
 *
 * Deleting the design takes its documents with it: a procedure for a loop
 * nobody has is not a procedure anybody can follow.
 */
CREATE TABLE IF NOT EXISTS sop_file (
  id           VARCHAR(80)   NOT NULL,
  design_id    VARCHAR(40)   NOT NULL,
  name         VARCHAR(255)  NOT NULL,
  mime         VARCHAR(160)  NOT NULL,
  bytes        INT           NOT NULL,
  uploaded_by  VARCHAR(160)  NOT NULL,
  created_at   VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  KEY sop_by_design (design_id),
  CONSTRAINT sop_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * What went out of limit, and when.
 *
 * The studio keeps a live alarm list in memory, rebuilt from the readings on
 * every tick. That is the right place for "what is wrong now" and the wrong
 * place for "what went wrong last Tuesday" — it does not survive a reload, let
 * alone a shift change.
 *
 * This is the history, and it is deliberately not the same thing: one row per
 * time a reading left its limits, with the value that did it, and the moment
 * it came back. An operator acknowledging it is recorded against their SandMan
 * username, because "who knew about this" is the question asked afterwards.
 *
 * `raised_at` is indexed with the line because every question starts there:
 * what happened on this line, between these times.
 */
CREATE TABLE IF NOT EXISTS alarm_event (
  id           VARCHAR(40)   NOT NULL,
  design_id    VARCHAR(40)   NOT NULL,
  foundry_id   VARCHAR(80)   NOT NULL,
  line_id      VARCHAR(80)   NOT NULL,
  /** The reading, and the equipment carrying it, as the layout named them. */
  tag_id       VARCHAR(120)  NOT NULL,
  equipment    VARCHAR(160)  NULL,
  /** 1 advisory · 2 warning · 3 critical — the studio's own scale. */
  severity     TINYINT       NOT NULL,
  message      VARCHAR(500)  NULL,
  /** The reading that raised it, and its unit, as shown at the time. */
  value        DOUBLE        NULL,
  unit         VARCHAR(40)   NULL,
  raised_at    VARCHAR(40)   NOT NULL,
  returned_at  VARCHAR(40)   NULL,
  acked_at     VARCHAR(40)   NULL,
  acked_by     VARCHAR(160)  NULL,
  PRIMARY KEY (id),
  KEY alarm_by_line (foundry_id, line_id, raised_at),
  KEY alarm_by_design (design_id, raised_at),
  CONSTRAINT alarm_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * A plant database somebody registered in the studio.
 *
 * ⚠ THE ONLY TABLE HERE THAT HOLDS A CREDENTIAL.
 *
 * The foundry's own database arrives named-but-unreachable with the SandMan
 * launch, and is never connected to. This is the other kind: a database an
 * administrator added by hand, which this service connects to itself to read
 * its tables. That means holding a password, and — when the host is only
 * reachable through a jump box — an SSH private key.
 *
 * `password` and `tunnel_private_key` are ciphertext, never the value. They
 * are sealed with AES-256-GCM under a key supplied in the environment
 * (DL_SECRET_KEY). `tunnel_public_key` is deliberately plain: it is public,
 * and it is what somebody installs on the jump box.
 */
/**
 * Which of a database's tables are worth offering.
 *
 * A plant database routinely has a hundred and fifty tables and six that
 * anybody links a reading to. The dropdown in *Add reading* was showing all of
 * them, in schema order, which made finding the right one a scrolling exercise
 * repeated for every reading on every item.
 *
 * So a database can be told which tables to offer. `scope` names the database:
 *
 *   customer:<foundryId>   the foundry's own, which differs per plant
 *   conn:<connectionId>    one somebody registered, which does not
 *
 * One row means "only these". No row at all means every table, which is what a
 * database that nobody has narrowed should do — the filter is an improvement
 * on the list, never a prerequisite for having one.
 *
 * `tables` is a JSON array of names. Names, not ids: a table dropped and
 * recreated is the same table to whoever picked it, and a name that no longer
 * exists simply stops matching.
 */
CREATE TABLE IF NOT EXISTS table_filter (
  scope       VARCHAR(160) NOT NULL,
  tables      TEXT         NOT NULL,
  updated_by  VARCHAR(160) NULL,
  updated_at  VARCHAR(40)  NOT NULL,
  PRIMARY KEY (scope)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS db_connection (
  id                  VARCHAR(40)   NOT NULL,
  label               VARCHAR(160)  NOT NULL,
  engine              VARCHAR(20)   NOT NULL,
  host                VARCHAR(255)  NOT NULL,
  port                INT           NOT NULL,
  database_name       VARCHAR(160)  NOT NULL,
  username            VARCHAR(160)  NOT NULL,
  password            TEXT          NULL,
  use_tls             TINYINT(1)    NOT NULL DEFAULT 0,
  tunnel_host         VARCHAR(255)  NULL,
  tunnel_port         INT           NULL,
  tunnel_user         VARCHAR(160)  NULL,
  tunnel_private_key  TEXT          NULL,
  tunnel_public_key   TEXT          NULL,
  -- Sealed like the private key. A key file generated with a passphrase is
  -- useless without it, and the gateway this mirrors reads one too.
  tunnel_passphrase   TEXT          NULL,
  last_tested_at      VARCHAR(40)   NULL,
  last_test_ok        TINYINT(1)    NULL,
  last_test_error     VARCHAR(500)  NULL,
  created_by          VARCHAR(160)  NOT NULL,
  created_at          VARCHAR(40)   NOT NULL,
  updated_at          VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY connection_label (label)
  -- `engine` deliberately carries no CHECK constraint.
  --
  -- It used to list the engines, which meant adding MariaDB, PostgreSQL or
  -- Azure SQL required editing this file *and* the route that validates them —
  -- two places that say the same thing, one of which would eventually be
  -- forgotten. The list lives in `routes/connections.js` as ENGINE_CATALOGUE,
  -- which the API validates against and the studio builds its form from, so
  -- there is one of it.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
