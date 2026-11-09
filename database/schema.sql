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
  -- A line may hold several loops: the one the plant is running, a rebuild
  -- being drawn beside it, a trial. Only one of them is published at a time —
  -- that is the one the publish view and the live readings follow — and
  -- `POST /loops/:id/publish` is what enforces it.
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
 * The written procedure itself — the words, not the uploaded file.
 *
 * `sop_file` above holds a PDF somebody attached. This holds the procedure the
 * Process & SOP panel actually shows: its number, who owns it, what revision
 * it is at, the numbered steps, the reaction plan and the PPE line.
 *
 * It used to live inside `design_version.layout`, the 78 KB JSON blob of the
 * whole drawing. That did store it — but it made the procedure a detail of a
 * picture: unqueryable without parsing every version of every loop, rewritten
 * wholesale on every save of the canvas, and impossible to answer "which
 * processes are still on revision 1.0" about. A procedure that tells somebody
 * how to run a sand line has a longer life than the drawing it was first
 * written against.
 *
 * One row per process per loop, which is what `UNIQUE (design_id, process_id)`
 * says. `process_id` is the studio's own id for the process — `cp_sp`,
 * `cp_mld` — because that is what the panel has in hand when it asks.
 *
 * The steps are their own table rather than a JSON column: they are a numbered
 * list that gets reordered, inserted into and quoted one line at a time, and
 * `ordinal` makes that the database's job instead of the caller's.
 */
CREATE TABLE IF NOT EXISTS sop (
  id            VARCHAR(40)   NOT NULL,
  design_id     VARCHAR(40)   NOT NULL,
  process_id    VARCHAR(80)   NOT NULL,
  -- What the panel shows across the top of the procedure card.
  process_name  VARCHAR(255)  NOT NULL DEFAULT '',
  no            VARCHAR(80)   NOT NULL DEFAULT '',
  title         VARCHAR(255)  NOT NULL DEFAULT '',
  version       VARCHAR(40)   NOT NULL DEFAULT '1.0',
  -- Draft | Approved | whatever a plant calls its middle state. Not an ENUM:
  -- adding "Under review" should not need a schema change.
  status        VARCHAR(40)   NOT NULL DEFAULT 'Draft',
  owner         VARCHAR(160)  NOT NULL DEFAULT '',
  approver      VARCHAR(160)  NOT NULL DEFAULT '',
  effective_on  VARCHAR(40)   NULL,
  review_months INT           NULL,
  purpose       TEXT          NULL,
  scope         TEXT          NULL,
  /*
   * The parts that are read whole and never queried across.
   *
   * `roles` is who does what, `ppe` the protective equipment line, `prestart`
   * the before-you-begin checklist, `refs` the documents it points at, and
   * `revisions` its own change history. Each is an ordered list whose only
   * reader wants all of it — nobody asks "which procedures mention helmets" —
   * so a table apiece would be five joins to rebuild one card. JSON, with the
   * shape the panel already uses.
   *
   * The steps and the reaction plan are different and have tables below: they
   * are what gets quoted line by line, and what quality asks about.
   */
  roles         JSON          NULL,
  ppe           JSON          NULL,
  prestart      JSON          NULL,
  refs          JSON          NULL,
  revisions     JSON          NULL,
  updated_by    VARCHAR(160)  NULL,
  updated_at    VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sop_one_per_process (design_id, process_id),
  KEY sop_doc_by_design (design_id),
  CONSTRAINT sop_doc_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * The numbered steps of one procedure, in order.
 *
 * A step is more than a line of text: `key_point` is the chip under it on the
 * card ("Moisture 3.0 – 3.8 %"), `critical` marks the ones a guided run will
 * not let you skip, and `param` links it to a reading so the step can show
 * what that reading says right now.
 *
 * Deleted and rewritten as a set whenever a procedure is saved: a step has no
 * identity of its own worth preserving — "step 3" means whatever is third —
 * and `revisions` on the parent is where the history of changes lives.
 */
CREATE TABLE IF NOT EXISTS sop_step (
  sop_id    VARCHAR(40)  NOT NULL,
  ordinal   INT          NOT NULL,
  text      TEXT         NOT NULL,
  key_point VARCHAR(255) NOT NULL DEFAULT '',
  critical  TINYINT(1)   NOT NULL DEFAULT 0,
  -- `role:moist`, `tag:MX-1.MOIST` — the studio's own way of naming a reading.
  param     VARCHAR(160) NULL,
  PRIMARY KEY (sop_id, ordinal),
  CONSTRAINT sop_step_of_sop FOREIGN KEY (sop_id)
    REFERENCES sop(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * The reaction plan: what to do when a check fails, and who to tell.
 *
 * Its own table rather than JSON because this is the part an auditor reads and
 * the part a plant is asked to prove it has — "show me the reaction plan for
 * compactability out of limit" is a query, not a document to open.
 */
CREATE TABLE IF NOT EXISTS sop_reaction (
  sop_id    VARCHAR(40) NOT NULL,
  ordinal   INT         NOT NULL,
  -- What went wrong, what to do about it, and who to escalate to.
  cond      TEXT        NOT NULL,
  action    TEXT        NOT NULL,
  escalate  VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (sop_id, ordinal),
  CONSTRAINT sop_reaction_of_sop FOREIGN KEY (sop_id)
    REFERENCES sop(id) ON DELETE CASCADE
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
  -- The plant that registered it, and the only one that may read it: a
  -- connection holds that plant's host, account and password. Null on the ones
  -- registered before databases were scoped to a plant; those stay visible to
  -- every foundry rather than vanishing from loops that already read them.
  foundry_id          VARCHAR(80)   NULL,
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
  -- Names are unique within a plant, not across all of them: two foundries may
  -- each have a database they call "Plant historian", and neither can see the
  -- other's. (MySQL treats nulls as distinct in a unique key, so the legacy
  -- rows above are not held to it.)
  UNIQUE KEY connection_label_per_foundry (foundry_id, label),
  KEY connection_by_foundry (foundry_id)
  -- `engine` deliberately carries no CHECK constraint.
  --
  -- It used to list the engines, which meant adding MariaDB, PostgreSQL or
  -- Azure SQL required editing this file *and* the route that validates them —
  -- two places that say the same thing, one of which would eventually be
  -- forgotten. The list lives in `routes/connections.js` as ENGINE_CATALOGUE,
  -- which the API validates against and the studio builds its form from, so
  -- there is one of it.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * ============================================================================
 * EQUIPMENT CARDS AND MAINTENANCE
 * ============================================================================
 *
 * Until now maintenance lived inside the drawing, in `design_version.layout`
 * as `DOC.maint`. That stored it, and made it unusable for the one thing it is
 * for: a technician standing at a machine with a phone. A design version is
 * immutable and only an administrator can save one, so a job logged on the shop
 * floor had nowhere to go, and two people logging work at once were two copies
 * of a document racing for one version number.
 *
 * These tables are the maintenance record. The studio reads them when a loop is
 * opened and writes them as work is logged, the phone page writes them
 * directly, and the drawing keeps no copy that anybody has to keep in step.
 *
 * Every table is keyed by the loop (`design_id`) and the equipment's id inside
 * it (`equip_key`, the studio's block id), never by the machine's name: a
 * machine may be renamed, and its history must stay with it.
 *
 * Each record keeps its full studio form in `doc` as JSON beside the columns
 * somebody will want to filter and total on. The columns answer the questions
 * (what is overdue, what did this machine cost this quarter) and `doc` makes
 * the round trip lossless, so a field the studio gains later is stored without
 * a migration rather than being silently dropped.
 */

/*
 * One row per piece of equipment, and the QR code that opens its page.
 *
 * `qr_token` is minted when the equipment is created and never changes while
 * the machine exists, so a sticker printed on day one is still right years
 * later. It is random and unguessable (the QR is the credential for the phone
 * page), and UNIQUE across every loop so one sticker can only ever mean one
 * machine. `retired_at` is set when the equipment is taken off the drawing:
 * the row stays, so an old sticker says "this machine was removed" instead of
 * quietly opening something else.
 */
CREATE TABLE IF NOT EXISTS equipment_card (
  id           VARCHAR(40)   NOT NULL,
  design_id    VARCHAR(40)   NOT NULL,
  equip_key    VARCHAR(80)   NOT NULL,
  tag          VARCHAR(160)  NOT NULL,
  equip_type   VARCHAR(80)   NOT NULL,
  description  VARCHAR(300)  NULL,
  qr_token     VARCHAR(64)   NOT NULL,
  created_at   VARCHAR(40)   NOT NULL,
  updated_at   VARCHAR(40)   NOT NULL,
  retired_at   VARCHAR(40)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY card_token (qr_token),
  UNIQUE KEY card_per_equipment (design_id, equip_key),
  KEY card_by_tag (design_id, tag),
  CONSTRAINT card_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * The last value read for each linked reading.
 *
 * The phone page cannot ask SandMan for a reading, because it has no SandMan
 * session. What it can honestly show is the last real value the studio or the
 * publish view fetched, with the time it was read. Never a simulated number:
 * rows are written only from a successful live read.
 */
CREATE TABLE IF NOT EXISTS tag_reading (
  design_id    VARCHAR(40)   NOT NULL,
  tag_id       VARCHAR(160)  NOT NULL,
  num_value    DOUBLE        NULL,
  text_value   VARCHAR(200)  NULL,
  recorded_at  VARCHAR(60)   NULL,
  read_at      VARCHAR(40)   NOT NULL,
  PRIMARY KEY (design_id, tag_id),
  CONSTRAINT reading_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* The asset register: what the machine is. One row per machine. */
CREATE TABLE IF NOT EXISTS mnt_asset (
  design_id     VARCHAR(40)   NOT NULL,
  equip_key     VARCHAR(80)   NOT NULL,
  make          VARCHAR(160)  NULL,
  model         VARCHAR(160)  NULL,
  serial_no     VARCHAR(160)  NULL,
  installed_on  VARCHAR(40)   NULL,
  power_kw      DOUBLE        NULL,
  criticality   VARCHAR(4)    NULL,
  supplier      VARCHAR(200)  NULL,
  phone         VARCHAR(60)   NULL,
  location      VARCHAR(200)  NULL,
  warranty_to   VARCHAR(40)   NULL,
  doc           TEXT          NOT NULL,
  updated_by    VARCHAR(160)  NULL,
  updated_at    VARCHAR(40)   NOT NULL,
  PRIMARY KEY (design_id, equip_key),
  CONSTRAINT asset_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * A planned task: preventive maintenance, an inspection or an overhaul, due
 * every N days and/or N running hours, whichever comes first.
 *
 * `last_done` and `last_hours` only ever move forward. A studio that has been
 * open since the morning must not wind back a task somebody logged from the
 * shop floor in the afternoon, and "the later date wins" is the whole rule.
 */
CREATE TABLE IF NOT EXISTS mnt_plan (
  id              VARCHAR(40)   NOT NULL,
  design_id       VARCHAR(40)   NOT NULL,
  equip_key       VARCHAR(80)   NOT NULL,
  task            VARCHAR(300)  NOT NULL,
  kind            VARCHAR(12)   NOT NULL,
  every_days      INT           NULL,
  every_hours     INT           NULL,
  safety_critical TINYINT(1)    NOT NULL DEFAULT 0,
  paused          TINYINT(1)    NOT NULL DEFAULT 0,
  responsible     VARCHAR(160)  NULL,
  last_done       VARCHAR(40)   NULL,
  last_hours      DOUBLE        NULL,
  doc             TEXT          NOT NULL,
  updated_at      VARCHAR(40)   NOT NULL,
  PRIMARY KEY (design_id, id),
  KEY plan_by_equipment (design_id, equip_key),
  KEY plan_by_due (design_id, last_done),
  CONSTRAINT plan_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * The work log: every job done and every service request raised.
 *
 * Entries are never deleted. A wrong entry is cancelled with a reason and stays
 * in the record, because an audit asks what was written and who corrected it.
 * `wo_no` is the work-order number, unique within a loop and issued by the
 * server (`mnt_counter`) so a phone and a desktop can never hand out the same
 * one.
 *
 * `origin` says where it was written: the studio, or a phone that scanned the
 * machine's QR. `rev` counts changes, so a stale copy cannot overwrite a newer
 * one.
 */
CREATE TABLE IF NOT EXISTS mnt_work (
  id            VARCHAR(40)   NOT NULL,
  design_id     VARCHAR(40)   NOT NULL,
  equip_key     VARCHAR(80)   NOT NULL,
  wo_no         VARCHAR(40)   NULL,
  kind          VARCHAR(12)   NOT NULL,
  task          VARCHAR(500)  NOT NULL,
  done_at       VARCHAR(40)   NOT NULL,
  done_by       VARCHAR(160)  NULL,
  status        VARCHAR(12)   NOT NULL,
  priority      VARCHAR(4)    NULL,
  assigned_to   VARCHAR(160)  NULL,
  stops_line    TINYINT(1)    NOT NULL DEFAULT 0,
  running_hours DOUBLE        NULL,
  downtime_min  DOUBLE        NULL,
  labour_hours  DOUBLE        NULL,
  total_cost    DOUBLE        NULL,
  plan_id       VARCHAR(40)   NULL,
  closes_id     VARCHAR(40)   NULL,
  cancelled_at  VARCHAR(40)   NULL,
  cancelled_by  VARCHAR(160)  NULL,
  cancel_reason VARCHAR(500)  NULL,
  origin        VARCHAR(10)   NOT NULL DEFAULT 'studio',
  doc           LONGTEXT      NOT NULL,
  rev           INT           NOT NULL DEFAULT 1,
  created_at    VARCHAR(40)   NOT NULL,
  updated_at    VARCHAR(40)   NOT NULL,
  PRIMARY KEY (design_id, id),
  UNIQUE KEY work_number (design_id, wo_no),
  KEY work_by_equipment (design_id, equip_key, done_at),
  KEY work_open (design_id, kind, status),
  CONSTRAINT work_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* The spare-parts store. `rev` moves whenever the server changes the stock. */
CREATE TABLE IF NOT EXISTS mnt_part (
  id          VARCHAR(40)   NOT NULL,
  design_id   VARCHAR(40)   NOT NULL,
  part_no     VARCHAR(80)   NULL,
  name        VARCHAR(200)  NOT NULL,
  unit        VARCHAR(20)   NULL,
  unit_cost   DOUBLE        NULL,
  stock       DOUBLE        NOT NULL DEFAULT 0,
  min_stock   DOUBLE        NULL,
  for_machines VARCHAR(300) NULL,
  doc         TEXT          NOT NULL,
  rev         INT           NOT NULL DEFAULT 1,
  updated_at  VARCHAR(40)   NOT NULL,
  PRIMARY KEY (design_id, id),
  CONSTRAINT part_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * The maintenance team, and the PIN that lets one of them log work.
 *
 * `pin_hash` is the studio's own lock, carried over unchanged so existing teams
 * keep working. It is a convenience lock, NOT a login: SandMan accounts are the
 * real identity. Failed attempts are counted here so the phone page cannot be
 * used to try every four-digit PIN.
 */
CREATE TABLE IF NOT EXISTS mnt_member (
  id           VARCHAR(40)   NOT NULL,
  design_id    VARCHAR(40)   NOT NULL,
  name         VARCHAR(160)  NOT NULL,
  role         VARCHAR(160)  NULL,
  rank_key     VARCHAR(20)   NULL,
  phone        VARCHAR(60)   NULL,
  email        VARCHAR(200)  NULL,
  pin_hash     VARCHAR(64)   NULL,
  failed_pins  INT           NOT NULL DEFAULT 0,
  locked_until VARCHAR(40)   NULL,
  doc          TEXT          NOT NULL,
  updated_at   VARCHAR(40)   NOT NULL,
  PRIMARY KEY (design_id, id),
  CONSTRAINT member_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*
 * Settings and counters for one loop's maintenance: the hour-meter tag chosen
 * for each machine, warning leads, labour rate, and the work-order sequence.
 * `wo_seq` is advanced inside the transaction that inserts the work order, so
 * two writers never receive the same number.
 */
CREATE TABLE IF NOT EXISTS mnt_setting (
  design_id   VARCHAR(40)   NOT NULL,
  cfg         TEXT          NOT NULL,
  meters      TEXT          NOT NULL,
  wo_seq      INT           NOT NULL DEFAULT 0,
  updated_at  VARCHAR(40)   NOT NULL,
  PRIMARY KEY (design_id),
  CONSTRAINT setting_of_design FOREIGN KEY (design_id)
    REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
