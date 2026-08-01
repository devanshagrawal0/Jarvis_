"use strict";

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    wave: 3,
    name: "protected-core-foundation",
    up(db) {
      db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          wave INTEGER NOT NULL CHECK(wave > 0),
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL,
          checksum TEXT NOT NULL
        ) STRICT;
        CREATE TABLE schema_registry (
          type TEXT PRIMARY KEY,
          current_version INTEGER NOT NULL CHECK(current_version > 0),
          schema_json TEXT NOT NULL CHECK(json_valid(schema_json)),
          migration_handler TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE core_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE actors (
          id TEXT PRIMARY KEY,
          actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','device','agent','service','collaborator')),
          owner_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
          metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE scopes (
          id TEXT PRIMARY KEY,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('owner','device','workspace','room','project','folder','segment','thread','task','agent_session','coop_session')),
          name TEXT NOT NULL,
          owner_actor_id TEXT NOT NULL REFERENCES actors(id),
          status TEXT NOT NULL CHECK(status IN ('active','archived','deleted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE scope_edges (
          parent_scope_id TEXT NOT NULL REFERENCES scopes(id),
          child_scope_id TEXT NOT NULL REFERENCES scopes(id),
          relation TEXT NOT NULL CHECK(relation IN ('contains','delegates','shares')),
          policy_id TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY(parent_scope_id, child_scope_id, relation),
          CHECK(parent_scope_id <> child_scope_id)
        ) STRICT;
        CREATE TABLE encrypted_objects (
          id TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK(schema_version > 0),
          scope_id TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          key_id TEXT NOT NULL,
          key_version INTEGER NOT NULL CHECK(key_version > 0),
          nonce BLOB NOT NULL CHECK(length(nonce) = 12),
          ciphertext BLOB NOT NULL,
          auth_tag BLOB NOT NULL CHECK(length(auth_tag) = 16),
          aad_json TEXT NOT NULL CHECK(json_valid(aad_json)),
          content_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX encrypted_objects_scope_type_idx ON encrypted_objects(scope_id, object_type);
        CREATE TABLE backup_history (
          id TEXT PRIMARY KEY,
          source_version INTEGER NOT NULL,
          target_version INTEGER NOT NULL,
          path TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          quick_check TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 2,
    wave: 4,
    name: "ledger-outbox-supervisor-jobs",
    up(db) {
      db.exec(`
        CREATE TABLE canonical_objects (
          id TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK(schema_version > 0),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          owner_subject_id TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          cloud_policy TEXT NOT NULL CHECK(cloud_policy IN ('allow','deny','ask')),
          status TEXT NOT NULL CHECK(status IN ('candidate','active','contested','superseded','retracted','expired','quarantined')),
          retention_policy_id TEXT NOT NULL,
          encrypted_object_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          version INTEGER NOT NULL CHECK(version > 0),
          content_mac TEXT NOT NULL,
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE sequence_state (
          name TEXT PRIMARY KEY,
          value INTEGER NOT NULL CHECK(value >= 0)
        ) STRICT;
        INSERT INTO sequence_state(name,value) VALUES('canonical',0);
        CREATE TABLE stream_heads (
          stream_type TEXT NOT NULL,
          stream_id TEXT NOT NULL,
          last_sequence INTEGER NOT NULL CHECK(last_sequence >= 0),
          last_mac TEXT NOT NULL,
          PRIMARY KEY(stream_type,stream_id)
        ) STRICT;
        CREATE TABLE ledger_events (
          event_id TEXT PRIMARY KEY,
          canonical_sequence INTEGER NOT NULL UNIQUE CHECK(canonical_sequence > 0),
          stream_type TEXT NOT NULL,
          stream_id TEXT NOT NULL,
          stream_sequence INTEGER NOT NULL CHECK(stream_sequence > 0),
          event_type TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK(schema_version > 0),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          device_hlc TEXT,
          causation_id TEXT,
          correlation_id TEXT,
          idempotency_key TEXT NOT NULL,
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          previous_mac TEXT NOT NULL,
          mac TEXT NOT NULL,
          UNIQUE(stream_type,stream_id,stream_sequence),
          UNIQUE(actor_id,idempotency_key)
        ) STRICT;
        CREATE TABLE outbox_events (
          id TEXT PRIMARY KEY,
          ledger_event_id TEXT NOT NULL REFERENCES ledger_events(event_id),
          target TEXT NOT NULL,
          partition_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','leased','retry','succeeded','dead_letter','cancelled')),
          attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
          max_attempts INTEGER NOT NULL DEFAULT 8 CHECK(max_attempts > 0),
          available_at TEXT NOT NULL,
          lease_owner TEXT,
          lease_expires_at TEXT,
          last_error_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ledger_event_id,target)
        ) STRICT;
        CREATE INDEX outbox_ready_idx ON outbox_events(status,available_at,partition_key);
        CREATE TABLE memory_commands (
          id TEXT PRIMARY KEY,
          command_type TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK(schema_version > 0),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          purpose TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('accepted','rejected')),
          result_json TEXT NOT NULL CHECK(json_valid(result_json)),
          correlation_id TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(actor_id,idempotency_key)
        ) STRICT;
        CREATE TABLE memory_jobs (
          job_id TEXT PRIMARY KEY,
          job_type TEXT NOT NULL,
          job_version INTEGER NOT NULL CHECK(job_version > 0),
          partition_key TEXT NOT NULL,
          prerequisite_sequence INTEGER,
          input_ref TEXT NOT NULL,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          cloud_eligibility INTEGER NOT NULL CHECK(cloud_eligibility IN (0,1)),
          idempotency_key TEXT NOT NULL UNIQUE,
          lease_owner TEXT,
          lease_expires_at TEXT,
          attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
          max_attempts INTEGER NOT NULL CHECK(max_attempts > 0),
          latency_class TEXT NOT NULL CHECK(latency_class IN ('instant','normal','background','batch')),
          max_cost_usd REAL NOT NULL CHECK(max_cost_usd >= 0),
          status TEXT NOT NULL CHECK(status IN ('queued','leased','retry','succeeded','dead_letter','cancelled')),
          available_at TEXT NOT NULL,
          last_error_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX memory_jobs_ready_idx ON memory_jobs(status,available_at,partition_key);
        CREATE TABLE job_receipts (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL UNIQUE REFERENCES memory_jobs(job_id),
          idempotency_key TEXT NOT NULL UNIQUE,
          output_ids_json TEXT NOT NULL CHECK(json_valid(output_ids_json)),
          output_hash TEXT,
          cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
          side_effects_json TEXT NOT NULL CHECK(json_valid(side_effects_json)),
          outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','dead_letter','cancelled')),
          error_code TEXT,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE worker_leases (
          worker_id TEXT NOT NULL,
          partition_key TEXT NOT NULL,
          heartbeat_at TEXT NOT NULL,
          lease_expires_at TEXT NOT NULL,
          capability TEXT NOT NULL,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          drain_state TEXT NOT NULL CHECK(drain_state IN ('running','draining','stopped')),
          PRIMARY KEY(worker_id,partition_key)
        ) STRICT;
        CREATE TABLE projection_cursors (
          projector TEXT PRIMARY KEY,
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ready','degraded','rebuilding','paused')),
          last_error_code TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE supervisor_state (
          id INTEGER PRIMARY KEY CHECK(id=1),
          mode TEXT NOT NULL CHECK(mode IN ('running','paused','draining')),
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 3,
    wave: 5,
    name: "policies-grants-key-hierarchy",
    up(db) {
      db.exec(`
        CREATE TABLE policies (
          id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version > 0),
          kind TEXT NOT NULL CHECK(kind IN ('admission','privacy','retention','share','cloud','capability')),
          expression_json TEXT NOT NULL CHECK(json_valid(expression_json)),
          effect TEXT NOT NULL CHECK(effect IN ('allow','deny','ask')),
          status TEXT NOT NULL CHECK(status IN ('active','retired')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          PRIMARY KEY(id,version)
        ) STRICT;
        CREATE TABLE grants (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL REFERENCES actors(id),
          capability TEXT NOT NULL,
          resource_pattern TEXT NOT NULL,
          purpose_pattern TEXT NOT NULL,
          effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
          max_sensitivity TEXT NOT NULL CHECK(max_sensitivity IN ('public','internal','private','restricted')),
          cloud_allowed INTEGER NOT NULL CHECK(cloud_allowed IN (0,1)),
          share_allowed INTEGER NOT NULL CHECK(share_allowed IN (0,1)),
          issued_by TEXT NOT NULL REFERENCES actors(id),
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          origin_type TEXT NOT NULL CHECK(origin_type IN ('owner','agent_lease','coop_session','system')),
          origin_id TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
        ) STRICT;
        CREATE INDEX grants_actor_capability_idx ON grants(actor_id,capability,expires_at);
        CREATE TABLE policy_denials (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          capability TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          purpose TEXT NOT NULL,
          sensitivity TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          policy_id TEXT,
          correlation_id TEXT,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE retention_policies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          retain_days INTEGER CHECK(retain_days IS NULL OR retain_days >= 0),
          raw_content_days INTEGER CHECK(raw_content_days IS NULL OR raw_content_days >= 0),
          deletion_mode TEXT NOT NULL CHECK(deletion_mode IN ('expire','delete','crypto_shred','review')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE data_keys (
          id TEXT NOT NULL,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          key_version INTEGER NOT NULL CHECK(key_version > 0),
          state TEXT NOT NULL CHECK(state IN ('active','retiring','destroyed')),
          wrapping_key_id TEXT NOT NULL,
          wrapping_key_version INTEGER NOT NULL CHECK(wrapping_key_version > 0),
          wrapped_key BLOB,
          nonce BLOB CHECK(nonce IS NULL OR length(nonce)=12),
          auth_tag BLOB CHECK(auth_tag IS NULL OR length(auth_tag)=16),
          aad_json TEXT CHECK(aad_json IS NULL OR json_valid(aad_json)),
          fingerprint TEXT NOT NULL,
          created_at TEXT NOT NULL,
          retired_at TEXT,
          destroyed_at TEXT,
          PRIMARY KEY(id,key_version),
          UNIQUE(scope_id,key_version),
          CHECK(state='destroyed' OR (wrapped_key IS NOT NULL AND nonce IS NOT NULL AND auth_tag IS NOT NULL AND aad_json IS NOT NULL)),
          CHECK(state<>'destroyed' OR wrapped_key IS NULL)
        ) STRICT;
        CREATE TABLE key_events (
          id TEXT PRIMARY KEY,
          key_id TEXT NOT NULL,
          key_version INTEGER NOT NULL,
          scope_id TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('created','rotated','retired','destroyed','recovery_tested')),
          actor_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
        ) STRICT;
      `);
    },
  },
  {
    version: 4,
    wave: 6,
    name: "observability-command-center-read-models",
    up(db) {
      db.exec(`
        ALTER TABLE memory_jobs ADD COLUMN correlation_id TEXT;
        CREATE TABLE operation_metrics (
          id TEXT PRIMARY KEY,
          correlation_id TEXT,
          component TEXT NOT NULL,
          metric_name TEXT NOT NULL,
          metric_value REAL NOT NULL,
          unit TEXT NOT NULL,
          scope_class TEXT,
          status TEXT NOT NULL CHECK(status IN ('ok','degraded','failed','denied')),
          recorded_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX operation_metrics_time_idx ON operation_metrics(recorded_at,component,metric_name);
        CREATE TABLE cost_observations (
          id TEXT PRIMARY KEY,
          correlation_id TEXT,
          provider TEXT NOT NULL,
          model TEXT,
          operation TEXT NOT NULL,
          call_count INTEGER NOT NULL CHECK(call_count >= 0),
          input_units INTEGER NOT NULL CHECK(input_units >= 0),
          output_units INTEGER NOT NULL CHECK(output_units >= 0),
          cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
          recorded_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE health_snapshots (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK(status IN ('healthy','degraded','unhealthy')),
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE operator_audit (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          result_code TEXT NOT NULL,
          correlation_id TEXT,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 5,
    wave: 7,
    name: "conversation-ingress-journal",
    up(db) {
      db.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          room_type TEXT NOT NULL,
          project_ref TEXT,
          thread_ref TEXT,
          title_encrypted_id TEXT REFERENCES encrypted_objects(id),
          state TEXT NOT NULL CHECK(state IN ('active','suspended','closed','archived')),
          retention_policy_id TEXT NOT NULL,
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE conversation_branches (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          parent_branch_id TEXT REFERENCES conversation_branches(id),
          parent_turn_id TEXT,
          state TEXT NOT NULL CHECK(state IN ('active','suspended','merged','closed')),
          resume_turn_id TEXT,
          merged_into_branch_id TEXT REFERENCES conversation_branches(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(conversation_id,id)
        ) STRICT;
        CREATE TABLE turns (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
          content_encrypted_id TEXT REFERENCES encrypted_objects(id),
          content_checksum TEXT,
          status TEXT NOT NULL CHECK(status IN ('streaming','finalized','interrupted','rejected')),
          admission_status TEXT NOT NULL CHECK(admission_status IN ('pending','admitted','rejected','quarantined')),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          model_provider TEXT,
          model_id TEXT,
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          client_sequence INTEGER CHECK(client_sequence IS NULL OR client_sequence >= 0),
          finalized_at TEXT,
          UNIQUE(conversation_id,client_sequence)
        ) STRICT;
        CREATE INDEX turns_conversation_time_idx ON turns(conversation_id,branch_id,recorded_at);
        CREATE TABLE turn_events (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          turn_id TEXT NOT NULL REFERENCES turns(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          event_type TEXT NOT NULL CHECK(event_type IN ('turn.accepted','turn.stream_started','turn.chunk','turn.finalized','turn.interrupted','turn.rejected')),
          client_event_id TEXT NOT NULL,
          client_sequence INTEGER CHECK(client_sequence IS NULL OR client_sequence >= 0),
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          checksum TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(conversation_id,client_event_id)
        ) STRICT;
        CREATE TABLE turn_stream_chunks (
          turn_id TEXT NOT NULL REFERENCES turns(id),
          chunk_sequence INTEGER NOT NULL CHECK(chunk_sequence >= 0),
          content_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          checksum TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(turn_id,chunk_sequence)
        ) STRICT;
        CREATE TABLE turn_attachments (
          id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL REFERENCES turns(id),
          artifact_ref TEXT,
          content_hash TEXT NOT NULL,
          media_type TEXT NOT NULL,
          locator_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          UNIQUE(turn_id,content_hash)
        ) STRICT;
        CREATE TABLE turn_focus_deltas (
          id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL REFERENCES turns(id),
          focus_type TEXT NOT NULL,
          focus_ref TEXT NOT NULL,
          operation TEXT NOT NULL CHECK(operation IN ('focus','blur','open','close')),
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 6,
    wave: 8,
    name: "conversation-state-kernel",
    up(db) {
      db.exec(`
        CREATE TABLE conversation_state_heads (
          conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
          state_sequence INTEGER NOT NULL CHECK(state_sequence >= 0),
          active_branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE topic_segments (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          topic_key TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('active','suspended','closed','merged')),
          start_turn_id TEXT REFERENCES turns(id),
          end_turn_id TEXT REFERENCES turns(id),
          capsule_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX topic_segments_active_idx ON topic_segments(conversation_id,branch_id,state);
        CREATE TABLE working_slots (
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          namespace TEXT NOT NULL,
          slot_key TEXT NOT NULL,
          slot_type TEXT NOT NULL CHECK(slot_type IN ('working','ephemeral_style','tool','artifact','constraint')),
          value_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          source_turn_id TEXT REFERENCES turns(id),
          expires_at TEXT,
          promotion_status TEXT NOT NULL CHECK(promotion_status IN ('none','candidate','promoted','rejected')),
          updated_at TEXT NOT NULL,
          PRIMARY KEY(conversation_id,branch_id,namespace,slot_key)
        ) STRICT;
        CREATE TABLE referent_state (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          mention TEXT NOT NULL,
          candidates_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          selected_ref TEXT,
          confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          state TEXT NOT NULL CHECK(state IN ('unresolved','resolved','expired')),
          source_turn_id TEXT NOT NULL REFERENCES turns(id),
          valid_until_turn_id TEXT REFERENCES turns(id),
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE open_loops (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          loop_type TEXT NOT NULL CHECK(loop_type IN ('question','promise','decision','approval','commitment')),
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          owner_actor_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('open','resolved','cancelled','expired')),
          source_turn_id TEXT NOT NULL REFERENCES turns(id),
          resolved_turn_id TEXT REFERENCES turns(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE focus_state (
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          focus_type TEXT NOT NULL,
          focus_ref TEXT NOT NULL,
          detail_encrypted_id TEXT REFERENCES encrypted_objects(id),
          source_turn_id TEXT REFERENCES turns(id),
          lease_expires_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(conversation_id,branch_id,focus_type)
        ) STRICT;
        CREATE TABLE conversation_state_items (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          item_type TEXT NOT NULL CHECK(item_type IN ('commitment','decision','constraint','question','approval')),
          item_key TEXT NOT NULL,
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          state TEXT NOT NULL CHECK(state IN ('active','resolved','superseded','cancelled')),
          source_turn_id TEXT NOT NULL REFERENCES turns(id),
          resolved_turn_id TEXT REFERENCES turns(id),
          updated_at TEXT NOT NULL,
          UNIQUE(conversation_id,branch_id,item_type,item_key)
        ) STRICT;
        CREATE TABLE context_block_bindings (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          block_type TEXT NOT NULL,
          block_ref TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          source_version TEXT NOT NULL,
          attach_at TEXT NOT NULL,
          detach_at TEXT,
          lease_expires_at TEXT,
          UNIQUE(conversation_id,branch_id,block_type,block_ref)
        ) STRICT;
        CREATE TABLE working_set_snapshots (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          state_sequence INTEGER NOT NULL CHECK(state_sequence >= 0),
          covered_turn_ids_json TEXT NOT NULL CHECK(json_valid(covered_turn_ids_json)),
          snapshot_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          checksum TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(conversation_id,state_sequence)
        ) STRICT;
      `);
    },
  },
  {
    version: 7,
    wave: 9,
    name: "task-checkpoint-agent-tool-truth",
    up(db) {
      db.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          conversation_id TEXT REFERENCES conversations(id),
          branch_id TEXT REFERENCES conversation_branches(id),
          parent_task_id TEXT REFERENCES tasks(id),
          objective_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('planned','running','blocked','awaiting_approval','completed','cancelled','failed')),
          current_step_id TEXT,
          version INTEGER NOT NULL CHECK(version > 0),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX tasks_active_idx ON tasks(scope_id,status,updated_at);
        CREATE TABLE task_steps (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          stable_key TEXT NOT NULL,
          step_order INTEGER NOT NULL CHECK(step_order >= 0),
          title_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('pending','ready','running','completed','failed','skipped','cancelled','awaiting_approval')),
          attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
          max_attempts INTEGER NOT NULL DEFAULT 1 CHECK(max_attempts > 0),
          requires_approval INTEGER NOT NULL DEFAULT 0 CHECK(requires_approval IN (0,1)),
          result_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(task_id,stable_key),
          UNIQUE(task_id,step_order)
        ) STRICT;
        CREATE TABLE task_step_dependencies (
          task_id TEXT NOT NULL REFERENCES tasks(id),
          step_id TEXT NOT NULL REFERENCES task_steps(id),
          depends_on_step_id TEXT NOT NULL REFERENCES task_steps(id),
          created_at TEXT NOT NULL,
          PRIMARY KEY(task_id,step_id,depends_on_step_id),
          CHECK(step_id <> depends_on_step_id)
        ) STRICT;
        CREATE TABLE task_checkpoints (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          task_version INTEGER NOT NULL CHECK(task_version > 0),
          checkpoint_sequence INTEGER NOT NULL CHECK(checkpoint_sequence > 0),
          snapshot_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          resume_token_hash TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK(state IN ('active','consumed','superseded')),
          created_at TEXT NOT NULL,
          UNIQUE(task_id,checkpoint_sequence)
        ) STRICT;
        CREATE TABLE task_approvals (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          step_id TEXT NOT NULL REFERENCES task_steps(id),
          request_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','expired')),
          requested_by TEXT NOT NULL REFERENCES actors(id),
          decided_by TEXT REFERENCES actors(id),
          decision_turn_id TEXT REFERENCES turns(id),
          idempotency_key TEXT NOT NULL,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          decided_at TEXT,
          UNIQUE(task_id,idempotency_key)
        ) STRICT;
        CREATE TABLE tool_invocations (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          step_id TEXT NOT NULL REFERENCES task_steps(id),
          tool_name TEXT NOT NULL,
          tool_version TEXT NOT NULL,
          arguments_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('planned','running','succeeded','failed','cancelled')),
          approval_id TEXT REFERENCES task_approvals(id),
          side_effect_class TEXT NOT NULL CHECK(side_effect_class IN ('none','local','external','irreversible')),
          idempotency_key TEXT NOT NULL UNIQUE,
          receipt_encrypted_id TEXT REFERENCES encrypted_objects(id),
          result_hash TEXT,
          cost_usd REAL NOT NULL DEFAULT 0 CHECK(cost_usd >= 0),
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE task_artifacts (
          task_id TEXT NOT NULL REFERENCES tasks(id),
          step_id TEXT REFERENCES task_steps(id),
          artifact_ref TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('input','output','active')),
          artifact_version TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(task_id,artifact_ref,artifact_version,role)
        ) STRICT;
        CREATE TABLE agent_sessions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          step_id TEXT REFERENCES task_steps(id),
          blueprint TEXT NOT NULL,
          blueprint_version TEXT NOT NULL,
          actor_id TEXT NOT NULL REFERENCES actors(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          capability_grant_id TEXT REFERENCES grants(id),
          status TEXT NOT NULL CHECK(status IN ('leased','running','checkpointed','succeeded','failed','cancelled','expired')),
          lease_expires_at TEXT NOT NULL,
          checkpoint_encrypted_id TEXT REFERENCES encrypted_objects(id),
          outcome_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX agent_sessions_lease_idx ON agent_sessions(status,lease_expires_at);
        CREATE TABLE task_significant_events (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          step_id TEXT REFERENCES task_steps(id),
          event_type TEXT NOT NULL CHECK(event_type IN ('task.created','task.started','task.blocked','task.resumed','task.completed','task.failed','step.started','step.completed','step.failed','approval.requested','approval.decided','tool.completed','agent.leased','agent.completed','checkpoint.created')),
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 8,
    wave: 10,
    name: "semantic-segmentation-episode-lifecycle",
    up(db) {
      db.exec(`
        CREATE TABLE segmentation_profiles (
          id TEXT PRIMARY KEY,
          version TEXT NOT NULL UNIQUE,
          thresholds_json TEXT NOT NULL CHECK(json_valid(thresholds_json)),
          classifier_name TEXT,
          classifier_version TEXT,
          benchmark_status TEXT NOT NULL CHECK(benchmark_status IN ('unverified','passed','failed')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE topic_boundary_observations (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          previous_turn_id TEXT REFERENCES turns(id),
          current_turn_id TEXT NOT NULL REFERENCES turns(id),
          profile_id TEXT NOT NULL REFERENCES segmentation_profiles(id),
          deterministic_score REAL NOT NULL CHECK(deterministic_score >= 0 AND deterministic_score <= 1),
          features_json TEXT NOT NULL CHECK(json_valid(features_json)),
          classifier_score REAL CHECK(classifier_score IS NULL OR (classifier_score >= 0 AND classifier_score <= 1)),
          decision TEXT NOT NULL CHECK(decision IN ('continue','split','link')),
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(conversation_id,branch_id,current_turn_id)
        ) STRICT;
        CREATE TABLE semantic_segments (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          topic_key TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('open','closed','linked','superseded')),
          start_turn_id TEXT NOT NULL REFERENCES turns(id),
          end_turn_id TEXT REFERENCES turns(id),
          linked_segment_id TEXT REFERENCES semantic_segments(id),
          boundary_reason TEXT,
          capsule_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX semantic_segments_active_idx ON semantic_segments(conversation_id,branch_id,state,updated_at);
        CREATE TABLE semantic_segment_members (
          segment_id TEXT NOT NULL REFERENCES semantic_segments(id),
          turn_id TEXT NOT NULL REFERENCES turns(id),
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          link_type TEXT NOT NULL CHECK(link_type IN ('contiguous','return','branch_resume')),
          created_at TEXT NOT NULL,
          PRIMARY KEY(segment_id,turn_id),
          UNIQUE(segment_id,ordinal)
        ) STRICT;
        CREATE TABLE episode_candidates (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          status TEXT NOT NULL CHECK(status IN ('open','ready','review','accepted','rejected')),
          closure_trigger TEXT NOT NULL CHECK(closure_trigger IN ('topic_switch','explicit_close','task_complete','idle','branch_suspend','conversation_close')),
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          coverage_checksum TEXT NOT NULL,
          created_at TEXT NOT NULL,
          closed_at TEXT
        ) STRICT;
        CREATE TABLE episode_members (
          episode_id TEXT NOT NULL REFERENCES episode_candidates(id),
          member_type TEXT NOT NULL CHECK(member_type IN ('turn','tool','artifact','task_event','segment')),
          member_ref TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          PRIMARY KEY(episode_id,member_type,member_ref),
          UNIQUE(episode_id,ordinal)
        ) STRICT;
        CREATE TABLE branch_capsules (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          branch_id TEXT NOT NULL REFERENCES conversation_branches(id),
          covered_turn_ids_json TEXT NOT NULL CHECK(json_valid(covered_turn_ids_json)),
          capsule_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          checksum TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 9,
    wave: 11,
    name: "sources-evidence-entities-hierarchy",
    up(db) {
      db.exec(`
        CREATE TABLE sources (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          source_type TEXT NOT NULL CHECK(source_type IN ('web','document','pdf','image','audio','video','table','code','tool_result','conversation','dataset')),
          canonical_locator_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          title_encrypted_id TEXT REFERENCES encrypted_objects(id),
          trust_zone TEXT NOT NULL CHECK(trust_zone IN ('owner','workspace','trusted_external','untrusted_external','generated')),
          reliability REAL NOT NULL CHECK(reliability >= 0 AND reliability <= 1),
          access_policy TEXT NOT NULL CHECK(access_policy IN ('local_only','cloud_allowed','ask')),
          state TEXT NOT NULL CHECK(state IN ('active','superseded','retracted')),
          supersedes_source_id TEXT REFERENCES sources(id),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE source_captures (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES sources(id),
          capture_version INTEGER NOT NULL CHECK(capture_version > 0),
          content_hash TEXT NOT NULL,
          blob_ref TEXT,
          metadata_encrypted_id TEXT REFERENCES encrypted_objects(id),
          extractor_status TEXT NOT NULL CHECK(extractor_status IN ('pending','complete','partial','failed')),
          captured_at TEXT NOT NULL,
          UNIQUE(source_id,capture_version),
          UNIQUE(source_id,content_hash)
        ) STRICT;
        CREATE TABLE evidence_units (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL REFERENCES source_captures(id),
          modality TEXT NOT NULL CHECK(modality IN ('text','pdf','image','audio','video','table','code','tool_result')),
          locator_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          excerpt_encrypted_id TEXT REFERENCES encrypted_objects(id),
          excerpt_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE evidence_links (
          id TEXT PRIMARY KEY,
          evidence_id TEXT NOT NULL REFERENCES evidence_units(id),
          target_type TEXT NOT NULL CHECK(target_type IN ('candidate','profile','entity','task','segment')),
          target_id TEXT NOT NULL,
          stance TEXT NOT NULL CHECK(stance IN ('supports','refutes','context')),
          entailment REAL NOT NULL CHECK(entailment >= 0 AND entailment <= 1),
          independent_group TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(evidence_id,target_type,target_id,stance)
        ) STRICT;
        CREATE TABLE entities (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          entity_type TEXT NOT NULL,
          canonical_name_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          canonical_name_hash TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          state TEXT NOT NULL CHECK(state IN ('active','merged','retracted')),
          merged_into_entity_id TEXT REFERENCES entities(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(scope_id,entity_type,canonical_name_hash)
        ) STRICT;
        CREATE TABLE entity_aliases (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL REFERENCES entities(id),
          alias_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          alias_hash TEXT NOT NULL,
          evidence_id TEXT REFERENCES evidence_units(id),
          valid_from TEXT,
          valid_to TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(entity_id,alias_hash)
        ) STRICT;
        CREATE INDEX entity_alias_lookup_idx ON entity_aliases(alias_hash,entity_id);
        CREATE TABLE entity_merge_events (
          id TEXT PRIMARY KEY,
          primary_entity_id TEXT NOT NULL REFERENCES entities(id),
          duplicate_entity_id TEXT NOT NULL REFERENCES entities(id),
          rationale_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          evidence_id TEXT REFERENCES evidence_units(id),
          state TEXT NOT NULL CHECK(state IN ('active','reversed')),
          created_at TEXT NOT NULL,
          reversed_at TEXT,
          CHECK(primary_entity_id <> duplicate_entity_id)
        ) STRICT;
        CREATE TABLE assertion_candidates (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          raw_segment_id TEXT REFERENCES semantic_segments(id),
          subject_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          predicate TEXT NOT NULL,
          object_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('candidate','review','admitted','rejected')),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE hierarchical_profiles (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          level TEXT NOT NULL CHECK(level IN ('owner','project','topic','entity')),
          subject_ref TEXT NOT NULL,
          profile_version INTEGER NOT NULL CHECK(profile_version > 0),
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          source_coverage_json TEXT NOT NULL CHECK(json_valid(source_coverage_json)),
          uncovered_failures_json TEXT NOT NULL CHECK(json_valid(uncovered_failures_json)),
          state TEXT NOT NULL CHECK(state IN ('candidate','active','superseded','retracted')),
          parent_profile_id TEXT REFERENCES hierarchical_profiles(id),
          created_at TEXT NOT NULL,
          UNIQUE(scope_id,level,subject_ref,profile_version)
        ) STRICT;
        CREATE TABLE profile_candidates (
          profile_id TEXT NOT NULL REFERENCES hierarchical_profiles(id),
          candidate_id TEXT NOT NULL REFERENCES assertion_candidates(id),
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          PRIMARY KEY(profile_id,candidate_id),
          UNIQUE(profile_id,ordinal)
        ) STRICT;
        CREATE TRIGGER source_captures_immutable_update BEFORE UPDATE ON source_captures BEGIN
          SELECT RAISE(ABORT,'source captures are immutable');
        END;
        CREATE TRIGGER source_captures_immutable_delete BEFORE DELETE ON source_captures BEGIN
          SELECT RAISE(ABORT,'source captures are immutable');
        END;
        CREATE TRIGGER evidence_units_immutable_update BEFORE UPDATE ON evidence_units BEGIN
          SELECT RAISE(ABORT,'evidence units are immutable');
        END;
        CREATE TRIGGER evidence_units_immutable_delete BEFORE DELETE ON evidence_units BEGIN
          SELECT RAISE(ABORT,'evidence units are immutable');
        END;
      `);
    },
  },
  {
    version: 10,
    wave: 12,
    name: "bitemporal-epistemic-assertion-truth",
    up(db) {
      db.exec(`
        CREATE TABLE assertions (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          subject_type TEXT NOT NULL CHECK(subject_type IN ('owner','entity','artifact','project','topic','literal')),
          subject_ref TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object_semantics_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','contested','superseded','retracted')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(scope_id,subject_type,subject_ref,predicate,object_semantics_hash)
        ) STRICT;
        CREATE INDEX assertions_subject_predicate_idx ON assertions(scope_id,subject_type,subject_ref,predicate,status);
        CREATE TABLE assertion_versions (
          id TEXT PRIMARY KEY,
          assertion_id TEXT NOT NULL REFERENCES assertions(id),
          version INTEGER NOT NULL CHECK(version > 0),
          object_type TEXT NOT NULL CHECK(object_type IN ('literal','entity','number','boolean','date','json')),
          object_encrypted_id TEXT REFERENCES encrypted_objects(id),
          polarity INTEGER NOT NULL CHECK(polarity IN (0,1)),
          epistemic_state TEXT NOT NULL CHECK(epistemic_state IN ('observed','owner_asserted','source_asserted','inferred','hypothetical','disputed','superseded','retracted')),
          valid_from TEXT NOT NULL,
          valid_to TEXT,
          recorded_from TEXT NOT NULL,
          recorded_to TEXT,
          provenance_encrypted_id TEXT REFERENCES encrypted_objects(id),
          confidence_extraction REAL NOT NULL CHECK(confidence_extraction BETWEEN 0 AND 1),
          confidence_source_reliability REAL NOT NULL CHECK(confidence_source_reliability BETWEEN 0 AND 1),
          confidence_corroboration REAL NOT NULL CHECK(confidence_corroboration BETWEEN 0 AND 1),
          confidence_freshness REAL NOT NULL CHECK(confidence_freshness BETWEEN 0 AND 1),
          confidence_user_confirmation REAL NOT NULL CHECK(confidence_user_confirmation BETWEEN 0 AND 1),
          confidence_contradiction_penalty REAL NOT NULL CHECK(confidence_contradiction_penalty BETWEEN 0 AND 1),
          confidence_computed REAL NOT NULL CHECK(confidence_computed BETWEEN 0 AND 1),
          confidence_policy_version TEXT NOT NULL,
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          UNIQUE(assertion_id,version),
          CHECK(valid_to IS NULL OR valid_to > valid_from),
          CHECK(recorded_to IS NULL OR recorded_to > recorded_from),
          CHECK(object_encrypted_id IS NOT NULL OR epistemic_state='retracted')
        ) STRICT;
        CREATE UNIQUE INDEX assertion_versions_current_recorded_idx ON assertion_versions(assertion_id) WHERE recorded_to IS NULL;
        CREATE INDEX assertion_versions_temporal_idx ON assertion_versions(assertion_id,valid_from,valid_to,recorded_from,recorded_to);
        CREATE TABLE assertion_version_evidence (
          assertion_version_id TEXT NOT NULL REFERENCES assertion_versions(id),
          evidence_id TEXT NOT NULL REFERENCES evidence_units(id),
          stance TEXT NOT NULL CHECK(stance IN ('supports','refutes','context')),
          entailment REAL NOT NULL CHECK(entailment BETWEEN 0 AND 1),
          independent_group TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(assertion_version_id,evidence_id,stance)
        ) STRICT;
        CREATE TABLE conflict_sets (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          subject_type TEXT NOT NULL,
          subject_ref TEXT NOT NULL,
          predicate TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('open','resolved','dismissed')),
          rationale_encrypted_id TEXT REFERENCES encrypted_objects(id),
          winning_version_id TEXT REFERENCES assertion_versions(id),
          created_at TEXT NOT NULL,
          resolved_at TEXT
        ) STRICT;
        CREATE TABLE conflict_members (
          conflict_id TEXT NOT NULL REFERENCES conflict_sets(id),
          assertion_version_id TEXT NOT NULL REFERENCES assertion_versions(id),
          role TEXT NOT NULL CHECK(role IN ('competing','supporting','refuted')),
          independent_group TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(conflict_id,assertion_version_id)
        ) STRICT;
      `);
    },
  },
  {
    version: 11,
    wave: 13,
    name: "protected-personal-memory-domains",
    up(db) {
      db.exec(`
        CREATE TABLE identity_attributes (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          owner_actor_id TEXT NOT NULL REFERENCES actors(id),
          predicate TEXT NOT NULL,
          value_encrypted_id TEXT REFERENCES encrypted_objects(id),
          assertion_id TEXT REFERENCES assertions(id),
          protected INTEGER NOT NULL DEFAULT 1 CHECK(protected=1),
          status TEXT NOT NULL CHECK(status IN ('active','superseded','retracted')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          authority_zone TEXT NOT NULL CHECK(authority_zone='owner'),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(value_encrypted_id IS NOT NULL OR status='retracted')
        ) STRICT;
        CREATE UNIQUE INDEX identity_active_predicate_idx ON identity_attributes(scope_id,owner_actor_id,predicate) WHERE status='active';
        CREATE TABLE directives (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          directive_key TEXT NOT NULL,
          content_encrypted_id TEXT REFERENCES encrypted_objects(id),
          version INTEGER NOT NULL CHECK(version > 0),
          protected INTEGER NOT NULL DEFAULT 1 CHECK(protected=1),
          status TEXT NOT NULL CHECK(status IN ('active','revoked','superseded','retracted')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          authority_zone TEXT NOT NULL CHECK(authority_zone='owner'),
          source_turn_id TEXT REFERENCES turns(id),
          created_at TEXT NOT NULL,
          closed_at TEXT,
          UNIQUE(scope_id,directive_key,version),
          CHECK(content_encrypted_id IS NOT NULL OR status IN ('revoked','retracted'))
        ) STRICT;
        CREATE UNIQUE INDEX directives_active_key_idx ON directives(scope_id,directive_key) WHERE status='active';
        CREATE TABLE preferences (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          subject_ref TEXT NOT NULL,
          domain TEXT NOT NULL,
          condition_encrypted_id TEXT REFERENCES encrypted_objects(id),
          value_encrypted_id TEXT REFERENCES encrypted_objects(id),
          strength REAL NOT NULL CHECK(strength BETWEEN 0 AND 1),
          origin TEXT NOT NULL CHECK(origin IN ('explicit_owner','inferred','imported')),
          status TEXT NOT NULL CHECK(status IN ('candidate','active','review','superseded','retracted')),
          decay_half_life_days REAL CHECK(decay_half_life_days IS NULL OR decay_half_life_days > 0),
          last_reinforced_at TEXT,
          review_after TEXT,
          assertion_id TEXT REFERENCES assertions(id),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(value_encrypted_id IS NOT NULL OR status='retracted')
        ) STRICT;
        CREATE INDEX preferences_lookup_idx ON preferences(scope_id,subject_ref,domain,status);
        CREATE TABLE preference_evidence (
          id TEXT PRIMARY KEY,
          preference_id TEXT NOT NULL REFERENCES preferences(id),
          evidence_id TEXT REFERENCES evidence_units(id),
          assertion_version_id TEXT REFERENCES assertion_versions(id),
          effect TEXT NOT NULL CHECK(effect IN ('reinforce','weaken','confirm','correct')),
          weight REAL NOT NULL CHECK(weight > 0 AND weight <= 1),
          created_at TEXT NOT NULL,
          CHECK((evidence_id IS NOT NULL) <> (assertion_version_id IS NOT NULL))
        ) STRICT;
        CREATE TABLE goals (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          owner_actor_id TEXT NOT NULL REFERENCES actors(id),
          objective_encrypted_id TEXT REFERENCES encrypted_objects(id),
          state TEXT NOT NULL CHECK(state IN ('proposed','active','paused','blocked','completed','cancelled','retracted')),
          priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 100),
          target_start TEXT,
          target_end TEXT,
          project_ref TEXT,
          task_id TEXT REFERENCES tasks(id),
          state_version INTEGER NOT NULL CHECK(state_version > 0),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(target_end IS NULL OR target_start IS NULL OR target_end >= target_start),
          CHECK(objective_encrypted_id IS NOT NULL OR state='retracted')
        ) STRICT;
        CREATE TABLE goal_dependencies (
          goal_id TEXT NOT NULL REFERENCES goals(id),
          depends_on_goal_id TEXT NOT NULL REFERENCES goals(id),
          created_at TEXT NOT NULL,
          PRIMARY KEY(goal_id,depends_on_goal_id),
          CHECK(goal_id <> depends_on_goal_id)
        ) STRICT;
        CREATE TABLE goal_events (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL REFERENCES goals(id),
          from_state TEXT,
          to_state TEXT NOT NULL,
          state_version INTEGER NOT NULL CHECK(state_version > 0),
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          UNIQUE(goal_id,state_version)
        ) STRICT;
        CREATE TABLE commitments (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          promise_encrypted_id TEXT REFERENCES encrypted_objects(id),
          due_at TEXT,
          status TEXT NOT NULL CHECK(status IN ('proposed','active','completed','cancelled','overdue','retracted')),
          state_version INTEGER NOT NULL CHECK(state_version > 0),
          source_turn_id TEXT REFERENCES turns(id),
          completion_evidence_id TEXT REFERENCES evidence_units(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(promise_encrypted_id IS NOT NULL OR status='retracted')
        ) STRICT;
        CREATE TABLE commitment_events (
          id TEXT PRIMARY KEY,
          commitment_id TEXT NOT NULL REFERENCES commitments(id),
          from_state TEXT,
          to_state TEXT NOT NULL,
          state_version INTEGER NOT NULL CHECK(state_version > 0),
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          UNIQUE(commitment_id,state_version)
        ) STRICT;
      `);
    },
  },
  {
    version: 12,
    wave: 14,
    name: "correction-dependency-forget-engine",
    up(db) {
      db.exec(`
        CREATE TABLE assertion_causal_links (
          id TEXT PRIMARY KEY,
          from_version_id TEXT NOT NULL REFERENCES assertion_versions(id),
          to_version_id TEXT REFERENCES assertion_versions(id),
          relation TEXT NOT NULL CHECK(relation IN ('corrects','supersedes','retracts','real_world_change')),
          command_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE correction_commands (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          subject_type TEXT NOT NULL,
          subject_ref TEXT NOT NULL,
          predicate TEXT NOT NULL,
          old_object_hash TEXT,
          new_object_encrypted_id TEXT REFERENCES encrypted_objects(id),
          mode TEXT NOT NULL CHECK(mode IN ('real_world_change','never_true','retract','close')),
          status TEXT NOT NULL CHECK(status IN ('preview','needs_clarification','committed','rejected')),
          target_count INTEGER NOT NULL CHECK(target_count >= 0),
          requested_by TEXT NOT NULL REFERENCES actors(id),
          rationale_encrypted_id TEXT REFERENCES encrypted_objects(id),
          valid_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          committed_at TEXT
        ) STRICT;
        CREATE TABLE dependency_edges (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          dependent_type TEXT NOT NULL,
          dependent_id TEXT NOT NULL,
          relation TEXT NOT NULL CHECK(relation IN ('derived_from','summarizes','indexes','caches','renders','references')),
          status TEXT NOT NULL CHECK(status IN ('active','invalidated','deleted')),
          created_at TEXT NOT NULL,
          invalidated_at TEXT,
          UNIQUE(source_type,source_id,dependent_type,dependent_id,relation)
        ) STRICT;
        CREATE INDEX dependency_source_idx ON dependency_edges(source_type,source_id,status);
        CREATE TABLE derived_copies (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          copy_type TEXT NOT NULL CHECK(copy_type IN ('summary','graph','fts','vector','cache','artifact','procedure','export')),
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('active','stale','redacted','deleted')),
          mixed_content INTEGER NOT NULL CHECK(mixed_content IN (0,1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(payload_encrypted_id IS NOT NULL OR status IN ('redacted','deleted'))
        ) STRICT;
        CREATE TABLE invalidation_records (
          id TEXT PRIMARY KEY,
          trigger_type TEXT NOT NULL,
          trigger_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('stale','delete','rebuild','redact','purge')),
          status TEXT NOT NULL CHECK(status IN ('pending','applied','failed')),
          reason_code TEXT NOT NULL,
          created_at TEXT NOT NULL,
          applied_at TEXT,
          UNIQUE(trigger_type,trigger_id,target_type,target_id,action)
        ) STRICT;
        CREATE TABLE projection_freezes (
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          forget_job_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('frozen','released')),
          created_at TEXT NOT NULL,
          released_at TEXT,
          PRIMARY KEY(target_type,target_id,forget_job_id)
        ) STRICT;
        CREATE TABLE forget_jobs (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          target_type TEXT NOT NULL,
          target_id TEXT,
          selector_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('preview','needs_clarification','authorized','running','verifying','succeeded','failed')),
          target_count INTEGER NOT NULL CHECK(target_count >= 0),
          requested_by TEXT NOT NULL REFERENCES actors(id),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          closure_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE deletion_receipts (
          id TEXT PRIMARY KEY,
          forget_job_id TEXT NOT NULL UNIQUE REFERENCES forget_jobs(id),
          target_type TEXT NOT NULL,
          target_ids_json TEXT NOT NULL CHECK(json_valid(target_ids_json)),
          dependency_ids_json TEXT NOT NULL CHECK(json_valid(dependency_ids_json)),
          deleted_encrypted_object_count INTEGER NOT NULL CHECK(deleted_encrypted_object_count >= 0),
          invalidated_copy_count INTEGER NOT NULL CHECK(invalidated_copy_count >= 0),
          shred_mode TEXT NOT NULL CHECK(shred_mode IN ('encrypted_payload_delete','scope_key_destroy')),
          verification_json TEXT NOT NULL CHECK(json_valid(verification_json)),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE forget_job_targets (
          forget_job_id TEXT NOT NULL REFERENCES forget_jobs(id),
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('primary','linked','dependent')),
          PRIMARY KEY(forget_job_id,target_type,target_id)
        ) STRICT;
      `);
    },
  },
  {
    version: 13,
    wave: 15,
    name: "exact-lexical-retrieval-oracle",
    up(db) {
      db.exec(`
        CREATE TABLE retrieval_projections (
          id TEXT PRIMARY KEY,
          projection_version TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK(state IN ('building','active','retiring','failed')),
          source_sequence INTEGER NOT NULL CHECK(source_sequence >= 0),
          policy_version TEXT NOT NULL,
          created_at TEXT NOT NULL,
          activated_at TEXT,
          retired_at TEXT
        ) STRICT;
        CREATE UNIQUE INDEX retrieval_projection_active_idx ON retrieval_projections(state) WHERE state='active';
        CREATE TABLE retrieval_documents (
          id TEXT PRIMARY KEY,
          projection_id TEXT NOT NULL REFERENCES retrieval_projections(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          record_version TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          status TEXT NOT NULL CHECK(status IN ('active','stale','deleted')),
          valid_from TEXT,
          valid_to TEXT,
          content_encrypted_id TEXT REFERENCES encrypted_objects(id),
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(projection_id,record_type,record_id,record_version),
          CHECK(content_encrypted_id IS NOT NULL OR status='deleted'),
          CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
        ) STRICT;
        CREATE INDEX retrieval_documents_filter_idx ON retrieval_documents(projection_id,scope_id,status,valid_from,valid_to);
        CREATE TABLE retrieval_exact_keys (
          document_id TEXT NOT NULL REFERENCES retrieval_documents(id),
          key_type TEXT NOT NULL CHECK(key_type IN ('name','path','id','quote','ticker','error','predicate')),
          key_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(document_id,key_type,key_hash)
        ) STRICT;
        CREATE INDEX retrieval_exact_lookup_idx ON retrieval_exact_keys(key_type,key_hash,document_id);
        CREATE VIRTUAL TABLE retrieval_fts USING fts5(document_id UNINDEXED, token_stream, tokenize='unicode61');
        CREATE TABLE retrieval_runs (
          id TEXT PRIMARY KEY,
          query_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          intent TEXT NOT NULL,
          need_gate TEXT NOT NULL CHECK(need_gate IN ('exact','lexical','exact_lexical','evaluation')),
          expected_value REAL NOT NULL CHECK(expected_value BETWEEN 0 AND 1),
          scope_ids_json TEXT NOT NULL CHECK(json_valid(scope_ids_json)),
          valid_at TEXT,
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          projection_id TEXT NOT NULL REFERENCES retrieval_projections(id),
          policy_version TEXT NOT NULL,
          latency_ms REAL NOT NULL CHECK(latency_ms >= 0),
          cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
          status TEXT NOT NULL CHECK(status IN ('complete','degraded','failed','denied')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE retrieval_candidates (
          run_id TEXT NOT NULL REFERENCES retrieval_runs(id),
          document_id TEXT NOT NULL REFERENCES retrieval_documents(id),
          channel TEXT NOT NULL CHECK(channel IN ('exact','lexical','evaluation')),
          raw_rank INTEGER NOT NULL CHECK(raw_rank > 0),
          raw_score REAL NOT NULL,
          features_json TEXT NOT NULL CHECK(json_valid(features_json)),
          decision TEXT NOT NULL CHECK(decision IN ('selected','rejected','filtered')),
          reason_code TEXT NOT NULL,
          PRIMARY KEY(run_id,document_id,channel)
        ) STRICT;
      `);
    },
  },
  {
    version: 14,
    wave: 16,
    name: "coherent-cache-fabric",
    up(db) {
      db.exec(`
        CREATE TABLE projection_epochs (
          id TEXT PRIMARY KEY,
          projector TEXT NOT NULL,
          shard_key TEXT NOT NULL,
          projection_version TEXT NOT NULL,
          source_sequence INTEGER NOT NULL CHECK(source_sequence >= 0),
          epoch INTEGER NOT NULL CHECK(epoch > 0),
          state TEXT NOT NULL CHECK(state IN ('building','active','retiring','failed')),
          created_at TEXT NOT NULL,
          activated_at TEXT,
          UNIQUE(projector,shard_key,epoch)
        ) STRICT;
        CREATE UNIQUE INDEX projection_epoch_active_idx ON projection_epochs(projector,shard_key) WHERE state='active';
        CREATE TABLE consistency_watermarks (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          working_set_sequence INTEGER NOT NULL CHECK(working_set_sequence >= 0),
          projection_epochs_json TEXT NOT NULL CHECK(json_valid(projection_epochs_json)),
          policy_version TEXT NOT NULL,
          captured_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE cache_namespaces (
          id TEXT PRIMARY KEY,
          cache_kind TEXT NOT NULL CHECK(cache_kind IN ('record','working_set','embedding','plan','candidate','context','artifact','negative','provider')),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          policy_version TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation > 0),
          max_entries INTEGER NOT NULL CHECK(max_entries > 0),
          max_bytes INTEGER NOT NULL CHECK(max_bytes > 0),
          encryption_class TEXT NOT NULL CHECK(encryption_class IN ('private','restricted')),
          status TEXT NOT NULL CHECK(status IN ('active','paused','purged')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(cache_kind,scope_id,policy_version)
        ) STRICT;
        CREATE TABLE cache_entries (
          id TEXT PRIMARY KEY,
          namespace_id TEXT NOT NULL REFERENCES cache_namespaces(id),
          generation INTEGER NOT NULL CHECK(generation > 0),
          key_hash TEXT NOT NULL,
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          content_hash TEXT NOT NULL,
          byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
          recompute_cost REAL NOT NULL CHECK(recompute_cost >= 0),
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          working_set_sequence INTEGER NOT NULL CHECK(working_set_sequence >= 0),
          projection_epochs_json TEXT NOT NULL CHECK(json_valid(projection_epochs_json)),
          policy_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','invalidated','evicted','expired')),
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_accessed_at TEXT NOT NULL,
          access_count INTEGER NOT NULL CHECK(access_count >= 0),
          UNIQUE(namespace_id,generation,key_hash),
          CHECK(payload_encrypted_id IS NOT NULL OR status<>'active')
        ) STRICT;
        CREATE INDEX cache_entries_live_idx ON cache_entries(namespace_id,generation,status,expires_at,last_accessed_at);
        CREATE TABLE cache_dependencies (
          cache_entry_id TEXT NOT NULL REFERENCES cache_entries(id),
          dependency_type TEXT NOT NULL,
          dependency_id TEXT NOT NULL,
          dependency_version TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(cache_entry_id,dependency_type,dependency_id,dependency_version)
        ) STRICT;
        CREATE INDEX cache_dependency_lookup_idx ON cache_dependencies(dependency_type,dependency_id,cache_entry_id);
        CREATE TABLE cache_inflight (
          namespace_id TEXT NOT NULL REFERENCES cache_namespaces(id),
          generation INTEGER NOT NULL,
          key_hash TEXT NOT NULL,
          lease_owner TEXT NOT NULL,
          lease_expires_at TEXT NOT NULL,
          watermark_id TEXT REFERENCES consistency_watermarks(id),
          created_at TEXT NOT NULL,
          PRIMARY KEY(namespace_id,generation,key_hash)
        ) STRICT;
        CREATE TABLE cache_metrics (
          id TEXT PRIMARY KEY,
          namespace_id TEXT NOT NULL REFERENCES cache_namespaces(id),
          metric_type TEXT NOT NULL CHECK(metric_type IN ('hit','miss','stale_reject','scope_reject','put','evict','invalidate','purge','prewarm','lease_wait')),
          byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
          latency_ms REAL NOT NULL CHECK(latency_ms >= 0),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE provider_cache_refs (
          id TEXT PRIMARY KEY,
          namespace_id TEXT NOT NULL REFERENCES cache_namespaces(id),
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          handle_encrypted_id TEXT REFERENCES encrypted_objects(id),
          prefix_hash TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          expires_at TEXT NOT NULL,
          cached_units INTEGER NOT NULL CHECK(cached_units >= 0),
          hit_count INTEGER NOT NULL CHECK(hit_count >= 0),
          cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
          status TEXT NOT NULL CHECK(status IN ('active','expired','deleted')),
          created_at TEXT NOT NULL,
          CHECK(handle_encrypted_id IS NOT NULL OR status<>'active')
        ) STRICT;
      `);
    },
  },
  {
    version: 15,
    wave: 17,
    name: "vector-embedding-gateway",
    up(db) {
      db.exec(`
        CREATE TABLE embedding_profiles (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          model_version TEXT NOT NULL,
          dimensions INTEGER NOT NULL CHECK(dimensions > 0),
          modality TEXT NOT NULL CHECK(modality IN ('text','image','audio','video','code','multimodal')),
          preprocessing_version TEXT NOT NULL,
          task_instruction TEXT NOT NULL,
          metric TEXT NOT NULL CHECK(metric IN ('cosine','dot')),
          normalized INTEGER NOT NULL CHECK(normalized IN (0,1)),
          lane TEXT NOT NULL CHECK(lane IN ('local','cloud')),
          state TEXT NOT NULL CHECK(state IN ('active','retired')),
          created_at TEXT NOT NULL,
          UNIQUE(provider,model,model_version,dimensions,modality,preprocessing_version,task_instruction)
        ) STRICT;
        CREATE TABLE embedding_requests (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          record_version TEXT NOT NULL,
          part_ref TEXT,
          profile_id TEXT NOT NULL REFERENCES embedding_profiles(id),
          content_hash TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          cloud_eligible INTEGER NOT NULL CHECK(cloud_eligible IN (0,1)),
          batch_eligible INTEGER NOT NULL CHECK(batch_eligible IN (0,1)),
          status TEXT NOT NULL CHECK(status IN ('queued','leased','succeeded','failed','skipped','cancelled')),
          idempotency_key TEXT NOT NULL UNIQUE,
          error_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX embedding_requests_queue_idx ON embedding_requests(status,profile_id,created_at);
        CREATE TABLE embedding_records (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE REFERENCES embedding_requests(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          record_version TEXT NOT NULL,
          part_ref TEXT,
          profile_id TEXT NOT NULL REFERENCES embedding_profiles(id),
          content_hash TEXT NOT NULL,
          vector_encrypted_id TEXT REFERENCES encrypted_objects(id),
          vector_norm REAL NOT NULL CHECK(vector_norm >= 0),
          status TEXT NOT NULL CHECK(status IN ('active','replaced','deleted')),
          created_at TEXT NOT NULL,
          replaced_at TEXT,
          CHECK(vector_encrypted_id IS NOT NULL OR status='deleted')
        ) STRICT;
        CREATE INDEX embedding_records_lookup_idx ON embedding_records(profile_id,scope_id,record_type,record_id,status);
        CREATE TABLE embedding_receipts (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE REFERENCES embedding_requests(id),
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          lane TEXT NOT NULL CHECK(lane IN ('local','cloud')),
          batch_id TEXT,
          input_units INTEGER NOT NULL CHECK(input_units >= 0),
          cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
          duration_ms REAL NOT NULL CHECK(duration_ms >= 0),
          output_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE vector_indexes (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES embedding_profiles(id),
          index_version TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('building','active','retiring','failed')),
          source_sequence INTEGER NOT NULL CHECK(source_sequence >= 0),
          selected_record_count INTEGER NOT NULL CHECK(selected_record_count >= 0),
          embedded_record_count INTEGER NOT NULL CHECK(embedded_record_count >= 0),
          created_at TEXT NOT NULL,
          activated_at TEXT,
          UNIQUE(profile_id,index_version)
        ) STRICT;
        CREATE UNIQUE INDEX vector_index_active_idx ON vector_indexes(profile_id) WHERE state='active';
        CREATE TABLE vector_index_members (
          index_id TEXT NOT NULL REFERENCES vector_indexes(id),
          embedding_record_id TEXT NOT NULL REFERENCES embedding_records(id),
          created_at TEXT NOT NULL,
          PRIMARY KEY(index_id,embedding_record_id)
        ) STRICT;
        CREATE TABLE embedding_gateway_state (
          id INTEGER PRIMARY KEY CHECK(id=1),
          mode TEXT NOT NULL CHECK(mode IN ('healthy','degraded','offline','paused')),
          circuit_failures INTEGER NOT NULL CHECK(circuit_failures >= 0),
          circuit_open_until TEXT,
          daily_cost_usd REAL NOT NULL CHECK(daily_cost_usd >= 0),
          daily_budget_usd REAL NOT NULL CHECK(daily_budget_usd >= 0),
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO embedding_gateway_state(id,mode,circuit_failures,circuit_open_until,daily_cost_usd,daily_budget_usd,updated_at)
          VALUES(1,'healthy',0,NULL,0,5.0,datetime('now'));
      `);
    },
  },
  {
    version: 16,
    wave: 18,
    name: "adaptive-retrieval-planner",
    up(db) {
      db.exec(`
        CREATE TABLE retrieval_planner_versions (
          id TEXT PRIMARY KEY,
          planner_version TEXT NOT NULL UNIQUE,
          weights_json TEXT NOT NULL CHECK(json_valid(weights_json)),
          state TEXT NOT NULL CHECK(state IN ('active','retired')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX retrieval_planner_active_idx ON retrieval_planner_versions(state) WHERE state='active';
        CREATE TABLE retrieval_plans (
          id TEXT PRIMARY KEY,
          planner_id TEXT NOT NULL REFERENCES retrieval_planner_versions(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          query_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          query_signature TEXT NOT NULL,
          intent TEXT NOT NULL,
          need_decision TEXT NOT NULL CHECK(need_decision IN ('none','working_only','exact','hybrid','live_domain','deep')),
          consistency_mode TEXT NOT NULL CHECK(consistency_mode IN ('strict','bounded_stale','live_domain')),
          features_json TEXT NOT NULL CHECK(json_valid(features_json)),
          route_json TEXT NOT NULL CHECK(json_valid(route_json)),
          time_lens_json TEXT NOT NULL CHECK(json_valid(time_lens_json)),
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          working_set_sequence INTEGER NOT NULL CHECK(working_set_sequence >= 0),
          projection_epochs_json TEXT NOT NULL CHECK(json_valid(projection_epochs_json)),
          policy_version TEXT NOT NULL,
          latency_budget_ms INTEGER NOT NULL CHECK(latency_budget_ms >= 0),
          cost_budget_usd REAL NOT NULL CHECK(cost_budget_usd >= 0),
          expected_value REAL NOT NULL CHECK(expected_value BETWEEN 0 AND 1),
          avoided_calls INTEGER NOT NULL CHECK(avoided_calls >= 0),
          status TEXT NOT NULL CHECK(status IN ('planned','executed','degraded','cancelled')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX retrieval_plans_scope_created_idx ON retrieval_plans(scope_id,created_at,need_decision);
        CREATE TABLE retrieval_plan_channels (
          plan_id TEXT NOT NULL REFERENCES retrieval_plans(id),
          channel TEXT NOT NULL CHECK(channel IN ('working','exact','lexical','dense','temporal','graph','task','artifact','procedure','room','live_domain','rerank')),
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          reason_code TEXT NOT NULL,
          estimated_latency_ms INTEGER NOT NULL CHECK(estimated_latency_ms >= 0),
          estimated_cost_usd REAL NOT NULL CHECK(estimated_cost_usd >= 0),
          PRIMARY KEY(plan_id,channel),
          UNIQUE(plan_id,ordinal)
        ) STRICT;
        CREATE TABLE retrieval_fusion_candidates (
          plan_id TEXT NOT NULL REFERENCES retrieval_plans(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          record_version TEXT NOT NULL,
          cluster_key TEXT NOT NULL,
          channels_json TEXT NOT NULL CHECK(json_valid(channels_json)),
          raw_ranks_json TEXT NOT NULL CHECK(json_valid(raw_ranks_json)),
          features_json TEXT NOT NULL CHECK(json_valid(features_json)),
          rrf_score REAL NOT NULL,
          final_score REAL NOT NULL,
          decision TEXT NOT NULL CHECK(decision IN ('selected','diversity_filtered','policy_filtered','below_cutoff')),
          ordinal INTEGER,
          reason_code TEXT NOT NULL,
          PRIMARY KEY(plan_id,record_type,record_id,record_version)
        ) STRICT;
        CREATE TABLE retrieval_outcomes (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES retrieval_plans(id),
          outcome_type TEXT NOT NULL CHECK(outcome_type IN ('helpful','distracting','missed_beneficial','neutral','correction')),
          verified INTEGER NOT NULL CHECK(verified IN (0,1)),
          supported_claims INTEGER NOT NULL CHECK(supported_claims >= 0),
          successful_steps INTEGER NOT NULL CHECK(successful_steps >= 0),
          correction_count INTEGER NOT NULL CHECK(correction_count >= 0),
          utility_delta REAL NOT NULL CHECK(utility_delta BETWEEN -1 AND 1),
          details_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE midtask_retrieval_checkpoints (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          checkpoint_ref TEXT NOT NULL,
          plan_id TEXT REFERENCES retrieval_plans(id),
          trigger_type TEXT NOT NULL CHECK(trigger_type IN ('unresolved_entity','missing_procedure','tool_failure','low_confidence')),
          ordinal INTEGER NOT NULL CHECK(ordinal > 0),
          status TEXT NOT NULL CHECK(status IN ('allowed','denied','consumed','cancelled')),
          reason_code TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(task_id,checkpoint_ref,ordinal)
        ) STRICT;
      `);
    },
  },
  {
    version: 17,
    wave: 19,
    name: "adaptive-context-runtime",
    up(db) {
      db.exec(`
        CREATE TABLE context_profiles (
          id TEXT PRIMARY KEY,
          product TEXT NOT NULL,
          effort TEXT NOT NULL,
          profile_version TEXT NOT NULL,
          memory_token_budget INTEGER NOT NULL CHECK(memory_token_budget >= 0),
          tool_token_reserve INTEGER NOT NULL CHECK(tool_token_reserve >= 0),
          output_token_reserve INTEGER NOT NULL CHECK(output_token_reserve >= 0),
          allowed_sensitivities_json TEXT NOT NULL CHECK(json_valid(allowed_sensitivities_json)),
          block_order_json TEXT NOT NULL CHECK(json_valid(block_order_json)),
          state TEXT NOT NULL CHECK(state IN ('active','retired')),
          created_at TEXT NOT NULL,
          UNIQUE(product,effort,profile_version)
        ) STRICT;
        CREATE UNIQUE INDEX context_profile_active_idx ON context_profiles(product,effort) WHERE state='active';
        CREATE TABLE context_packs (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES context_profiles(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          thread_id TEXT,
          branch_id TEXT,
          task_id TEXT,
          retrieval_plan_id TEXT REFERENCES retrieval_plans(id),
          pack_version TEXT NOT NULL,
          manifest_hash TEXT NOT NULL,
          manifest_encrypted_id TEXT REFERENCES encrypted_objects(id),
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          working_set_sequence INTEGER NOT NULL CHECK(working_set_sequence >= 0),
          projection_epochs_json TEXT NOT NULL CHECK(json_valid(projection_epochs_json)),
          policy_version TEXT NOT NULL,
          token_budget INTEGER NOT NULL CHECK(token_budget >= 0),
          estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
          abstention_required INTEGER NOT NULL CHECK(abstention_required IN (0,1)),
          status TEXT NOT NULL CHECK(status IN ('compiled','consumed','invalidated')),
          created_at TEXT NOT NULL,
          CHECK(manifest_encrypted_id IS NOT NULL OR status='invalidated')
        ) STRICT;
        CREATE INDEX context_pack_replay_idx ON context_packs(profile_id,scope_id,manifest_hash,status);
        CREATE TABLE context_pack_items (
          pack_id TEXT NOT NULL REFERENCES context_packs(id),
          item_id TEXT NOT NULL,
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          record_version TEXT NOT NULL,
          block_type TEXT NOT NULL CHECK(block_type IN ('directives','execution','working_set','personal','episodes','manifests','evidence','conflicts','consistency','untrusted')),
          trust_zone TEXT NOT NULL CHECK(trust_zone IN ('system','trusted','untrusted')),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          authority TEXT NOT NULL CHECK(authority IN ('system','evidence','context_only','none')),
          content_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          content_hash TEXT NOT NULL,
          source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
          token_estimate INTEGER NOT NULL CHECK(token_estimate >= 0),
          priority REAL NOT NULL,
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          lease_id TEXT,
          PRIMARY KEY(pack_id,item_id),
          UNIQUE(pack_id,ordinal)
        ) STRICT;
        CREATE TABLE context_block_leases (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          thread_id TEXT NOT NULL,
          branch_id TEXT NOT NULL,
          block_key TEXT NOT NULL,
          block_version TEXT NOT NULL,
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          state TEXT NOT NULL CHECK(state IN ('attached','suspended','released','expired')),
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(thread_id,branch_id,block_key,block_version),
          CHECK(payload_encrypted_id IS NOT NULL OR state IN ('released','expired'))
        ) STRICT;
        CREATE INDEX context_block_active_idx ON context_block_leases(scope_id,thread_id,branch_id,state,expires_at);
        CREATE TABLE influence_receipts (
          id TEXT PRIMARY KEY,
          pack_id TEXT NOT NULL REFERENCES context_packs(id),
          model TEXT NOT NULL,
          provider TEXT NOT NULL,
          response_ref TEXT NOT NULL,
          response_hash TEXT NOT NULL,
          feedback TEXT CHECK(feedback IN ('positive','negative','corrected','none')),
          created_at TEXT NOT NULL,
          UNIQUE(pack_id,response_ref)
        ) STRICT;
        CREATE TABLE influence_items (
          receipt_id TEXT NOT NULL REFERENCES influence_receipts(id),
          item_id TEXT NOT NULL,
          influence_state TEXT NOT NULL CHECK(influence_state IN ('delivered','used','unused','unsupported','unknown')),
          answer_span_json TEXT CHECK(answer_span_json IS NULL OR json_valid(answer_span_json)),
          claim_encrypted_id TEXT REFERENCES encrypted_objects(id),
          evidence_refs_json TEXT NOT NULL CHECK(json_valid(evidence_refs_json)),
          reason_code TEXT NOT NULL,
          PRIMARY KEY(receipt_id,item_id)
        ) STRICT;
      `);
    },
  },
  {
    version: 18,
    wave: 20,
    name: "temporal-graph-and-multihop-retrieval",
    up(db) {
      db.exec(`
        CREATE TABLE graph_nodes (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          node_type TEXT NOT NULL CHECK(node_type IN ('owner','entity','assertion','episode','task','agent','artifact','source','scope','procedure','project','topic','room')),
          node_key TEXT NOT NULL,
          label_encrypted_id TEXT REFERENCES encrypted_objects(id),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          status TEXT NOT NULL CHECK(status IN ('active','merged','retracted','deleted')),
          canonical_ref_type TEXT,
          canonical_ref_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(scope_id,node_type,node_key)
        ) STRICT;
        CREATE INDEX graph_nodes_ref_idx ON graph_nodes(canonical_ref_type,canonical_ref_id,status);
        CREATE TABLE graph_edges (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          from_node_id TEXT NOT NULL REFERENCES graph_nodes(id),
          to_node_id TEXT NOT NULL REFERENCES graph_nodes(id),
          relation TEXT NOT NULL CHECK(relation IN ('MENTIONS','PARTICIPATED_IN','PART_OF','DERIVED_FROM','SUPPORTS','CONTRADICTS','SUPERSEDES','CORRECTS','CREATED_BY','USED_TOOL','PRODUCED','CONSUMED','DEPENDS_ON','BLOCKED_BY','RESOLVED_BY','BELONGS_TO_SCOPE','REFERENCES','TESTED_BY','LEARNED_FROM','SHARED_WITH','VERSION_OF')),
          weight REAL NOT NULL CHECK(weight > 0 AND weight <= 1),
          confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
          origin_kind TEXT NOT NULL CHECK(origin_kind IN ('canonical','derived','imported')),
          valid_from TEXT NOT NULL,
          valid_to TEXT,
          recorded_from TEXT NOT NULL,
          recorded_to TEXT,
          status TEXT NOT NULL CHECK(status IN ('active','superseded','retracted','deleted')),
          attributes_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          CHECK(from_node_id <> to_node_id),
          CHECK(valid_to IS NULL OR valid_to > valid_from),
          CHECK(recorded_to IS NULL OR recorded_to > recorded_from)
        ) STRICT;
        CREATE INDEX graph_edges_walk_idx ON graph_edges(scope_id,from_node_id,status,valid_from,valid_to,recorded_from,recorded_to);
        CREATE INDEX graph_edges_reverse_idx ON graph_edges(scope_id,to_node_id,status,valid_from,valid_to,recorded_from,recorded_to);
        CREATE TABLE graph_edge_evidence (
          edge_id TEXT NOT NULL REFERENCES graph_edges(id),
          evidence_id TEXT NOT NULL REFERENCES evidence_units(id),
          stance TEXT NOT NULL CHECK(stance IN ('supports','refutes','context')),
          created_at TEXT NOT NULL,
          PRIMARY KEY(edge_id,evidence_id,stance)
        ) STRICT;
        CREATE TABLE graph_runs (
          id TEXT PRIMARY KEY,
          scope_ids_json TEXT NOT NULL CHECK(json_valid(scope_ids_json)),
          seed_ids_json TEXT NOT NULL CHECK(json_valid(seed_ids_json)),
          mode TEXT NOT NULL CHECK(mode IN ('neighbors','path','ppr','hierarchy','community','skipped')),
          max_hops INTEGER NOT NULL CHECK(max_hops BETWEEN 0 AND 3),
          valid_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          gate_features_json TEXT NOT NULL CHECK(json_valid(gate_features_json)),
          status TEXT NOT NULL CHECK(status IN ('complete','skipped','degraded','failed')),
          latency_ms REAL NOT NULL CHECK(latency_ms >= 0),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE graph_run_results (
          run_id TEXT NOT NULL REFERENCES graph_runs(id),
          node_id TEXT NOT NULL REFERENCES graph_nodes(id),
          score REAL NOT NULL,
          depth INTEGER NOT NULL CHECK(depth >= 0 AND depth <= 3),
          path_json TEXT NOT NULL CHECK(json_valid(path_json)),
          explanation_encrypted_id TEXT REFERENCES encrypted_objects(id),
          ordinal INTEGER NOT NULL CHECK(ordinal > 0),
          PRIMARY KEY(run_id,node_id),
          UNIQUE(run_id,ordinal)
        ) STRICT;
        CREATE TABLE graph_communities (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          corpus_ref TEXT NOT NULL,
          community_version TEXT NOT NULL,
          member_count INTEGER NOT NULL CHECK(member_count >= 0),
          report_encrypted_id TEXT REFERENCES encrypted_objects(id),
          covered_node_ids_json TEXT NOT NULL CHECK(json_valid(covered_node_ids_json)),
          state TEXT NOT NULL CHECK(state IN ('candidate','active','retired','failed')),
          created_at TEXT NOT NULL,
          activated_at TEXT,
          UNIQUE(scope_id,corpus_ref,community_version)
        ) STRICT;
        CREATE TABLE graph_community_members (
          community_id TEXT NOT NULL REFERENCES graph_communities(id),
          node_id TEXT NOT NULL REFERENCES graph_nodes(id),
          membership REAL NOT NULL CHECK(membership BETWEEN 0 AND 1),
          PRIMARY KEY(community_id,node_id)
        ) STRICT;
      `);
    },
  },
  {
    version: 19,
    wave: 21,
    name: "consolidation-replay-and-predictive-staging",
    up(db) {
      db.exec(`
        CREATE TABLE consolidation_proposals (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          proposal_type TEXT NOT NULL CHECK(proposal_type IN ('episode','profile','merge','conflict','lesson','utility')),
          target_type TEXT NOT NULL,
          target_ref TEXT NOT NULL,
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          source_coverage_json TEXT NOT NULL CHECK(json_valid(source_coverage_json)),
          uncovered_failures_json TEXT NOT NULL CHECK(json_valid(uncovered_failures_json)),
          protected_mutation INTEGER NOT NULL CHECK(protected_mutation IN (0,1)),
          privacy_class TEXT NOT NULL CHECK(privacy_class IN ('local_only','cloud_eligible')),
          risk REAL NOT NULL CHECK(risk BETWEEN 0 AND 1),
          policy_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('quarantined','replay_pending','replay_failed','ready_review','approved','rejected','promoted')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(payload_encrypted_id IS NOT NULL OR status IN ('rejected','promoted'))
        ) STRICT;
        CREATE INDEX consolidation_proposal_queue_idx ON consolidation_proposals(status,scope_id,proposal_type,created_at);
        CREATE TABLE replay_corpora (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          corpus_version TEXT NOT NULL,
          purpose TEXT NOT NULL,
          manifest_hash TEXT NOT NULL,
          manifest_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          case_count INTEGER NOT NULL CHECK(case_count >= 0),
          state TEXT NOT NULL CHECK(state IN ('frozen','retired')),
          created_at TEXT NOT NULL,
          UNIQUE(scope_id,purpose,corpus_version)
        ) STRICT;
        CREATE TABLE replay_cases (
          id TEXT PRIMARY KEY,
          corpus_id TEXT NOT NULL REFERENCES replay_corpora(id),
          case_key TEXT NOT NULL,
          input_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          expected_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          input_hash TEXT NOT NULL,
          expected_hash TEXT NOT NULL,
          required INTEGER NOT NULL CHECK(required IN (0,1)),
          created_at TEXT NOT NULL,
          UNIQUE(corpus_id,case_key)
        ) STRICT;
        CREATE TABLE replay_runs (
          id TEXT PRIMARY KEY,
          proposal_id TEXT NOT NULL REFERENCES consolidation_proposals(id),
          corpus_id TEXT NOT NULL REFERENCES replay_corpora(id),
          baseline_version TEXT NOT NULL,
          candidate_version TEXT NOT NULL,
          case_results_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          baseline_score REAL NOT NULL,
          candidate_score REAL NOT NULL,
          required_pass_rate REAL NOT NULL CHECK(required_pass_rate BETWEEN 0 AND 1),
          actual_pass_rate REAL NOT NULL CHECK(actual_pass_rate BETWEEN 0 AND 1),
          privacy_violations INTEGER NOT NULL CHECK(privacy_violations >= 0),
          protected_mutation_attempts INTEGER NOT NULL CHECK(protected_mutation_attempts >= 0),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          status TEXT NOT NULL CHECK(status IN ('complete','failed','cancelled')),
          created_at TEXT NOT NULL,
          UNIQUE(proposal_id,corpus_id,candidate_version)
        ) STRICT;
        CREATE TABLE consolidation_promotion_receipts (
          id TEXT PRIMARY KEY,
          proposal_id TEXT NOT NULL UNIQUE REFERENCES consolidation_proposals(id),
          replay_run_id TEXT NOT NULL REFERENCES replay_runs(id),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          target_type TEXT NOT NULL,
          target_ref TEXT NOT NULL,
          decision TEXT NOT NULL CHECK(decision IN ('promote','reject')),
          structural_summary_json TEXT NOT NULL CHECK(json_valid(structural_summary_json)),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE staging_sessions (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          trigger_type TEXT NOT NULL CHECK(trigger_type IN ('project_open','mission_resume','artifact_focus','room_switch','agent_attach')),
          focus_ref TEXT NOT NULL,
          focus_signature TEXT NOT NULL,
          sensitivity_ceiling TEXT NOT NULL CHECK(sensitivity_ceiling IN ('public','internal','private','restricted')),
          max_bytes INTEGER NOT NULL CHECK(max_bytes >= 0),
          max_tokens INTEGER NOT NULL CHECK(max_tokens >= 0),
          max_cost_usd REAL NOT NULL CHECK(max_cost_usd >= 0),
          staged_bytes INTEGER NOT NULL CHECK(staged_bytes >= 0),
          staged_tokens INTEGER NOT NULL CHECK(staged_tokens >= 0),
          staged_cost_usd REAL NOT NULL CHECK(staged_cost_usd >= 0),
          status TEXT NOT NULL CHECK(status IN ('staged','consumed','cancelled','expired','rejected')),
          cancellation_reason TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX staging_scope_status_idx ON staging_sessions(scope_id,status,expires_at);
        CREATE TABLE staging_items (
          session_id TEXT NOT NULL REFERENCES staging_sessions(id),
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          record_version TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
          token_estimate INTEGER NOT NULL CHECK(token_estimate >= 0),
          estimated_cost_usd REAL NOT NULL CHECK(estimated_cost_usd >= 0),
          state TEXT NOT NULL CHECK(state IN ('staged','used','wasted','cancelled')),
          reason_code TEXT NOT NULL,
          PRIMARY KEY(session_id,record_type,record_id,record_version)
        ) STRICT;
        CREATE TRIGGER replay_corpora_immutable_update BEFORE UPDATE ON replay_corpora WHEN OLD.state='frozen' BEGIN
          SELECT RAISE(ABORT,'frozen replay corpora are immutable');
        END;
        CREATE TRIGGER replay_corpora_immutable_delete BEFORE DELETE ON replay_corpora BEGIN
          SELECT RAISE(ABORT,'replay corpora are immutable');
        END;
        CREATE TRIGGER replay_cases_immutable_update BEFORE UPDATE ON replay_cases BEGIN
          SELECT RAISE(ABORT,'replay cases are immutable');
        END;
        CREATE TRIGGER replay_cases_immutable_delete BEFORE DELETE ON replay_cases BEGIN
          SELECT RAISE(ABORT,'replay cases are immutable');
        END;
      `);
    },
  },
  {
    version: 20,
    wave: 22,
    name: "encrypted-content-addressed-artifacts",
    up(db) {
      db.exec(`
        CREATE TABLE artifact_blobs (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          content_address TEXT NOT NULL,
          byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          key_id TEXT NOT NULL,
          key_version INTEGER NOT NULL CHECK(key_version > 0),
          nonce BLOB,
          ciphertext BLOB,
          auth_tag BLOB,
          aad_json TEXT,
          content_mac TEXT,
          ref_count INTEGER NOT NULL CHECK(ref_count >= 0),
          status TEXT NOT NULL CHECK(status IN ('active','deleted')),
          created_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE(scope_id,content_address,sensitivity),
          CHECK((status='active' AND nonce IS NOT NULL AND ciphertext IS NOT NULL AND auth_tag IS NOT NULL AND aad_json IS NOT NULL AND content_mac IS NOT NULL) OR status='deleted')
        ) STRICT;
        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          artifact_kind TEXT NOT NULL,
          title_encrypted_id TEXT REFERENCES encrypted_objects(id),
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          status TEXT NOT NULL CHECK(status IN ('active','stale','deleted')),
          current_version INTEGER NOT NULL CHECK(current_version >= 0),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(title_encrypted_id IS NOT NULL OR status='deleted')
        ) STRICT;
        CREATE TABLE artifact_versions (
          id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifacts(id),
          version INTEGER NOT NULL CHECK(version > 0),
          blob_id TEXT REFERENCES artifact_blobs(id),
          mime_type TEXT NOT NULL,
          extension TEXT,
          content_semantics TEXT NOT NULL CHECK(content_semantics IN ('source_copy','mixed','independent')),
          manifest_encrypted_id TEXT REFERENCES encrypted_objects(id),
          manifest_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','superseded','stale','deleted')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          UNIQUE(artifact_id,version),
          CHECK((blob_id IS NOT NULL AND manifest_encrypted_id IS NOT NULL) OR status='deleted')
        ) STRICT;
        CREATE INDEX artifact_version_current_idx ON artifact_versions(artifact_id,status,version);
        CREATE TABLE artifact_locators (
          id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifacts(id),
          artifact_version_id TEXT REFERENCES artifact_versions(id),
          locator_kind TEXT NOT NULL CHECK(locator_kind IN ('file','uri','room','generated','import')),
          locator_hash TEXT NOT NULL,
          locator_encrypted_id TEXT REFERENCES encrypted_objects(id),
          state TEXT NOT NULL CHECK(state IN ('current','historical','missing','deleted')),
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          CHECK(locator_encrypted_id IS NOT NULL OR state='deleted')
        ) STRICT;
        CREATE UNIQUE INDEX artifact_locator_current_idx ON artifact_locators(artifact_id,locator_kind) WHERE state='current';
        CREATE INDEX artifact_locator_hash_idx ON artifact_locators(locator_hash,state);
        CREATE TABLE artifact_lineage (
          artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
          input_artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
          relation TEXT NOT NULL CHECK(relation IN ('derived_from','version_of','combines','converts','uses')),
          created_at TEXT NOT NULL,
          PRIMARY KEY(artifact_version_id,input_artifact_version_id,relation),
          CHECK(artifact_version_id <> input_artifact_version_id)
        ) STRICT;
        CREATE TABLE artifact_operations (
          id TEXT PRIMARY KEY,
          artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
          tool TEXT NOT NULL,
          tool_version TEXT NOT NULL,
          args_hash TEXT NOT NULL,
          details_encrypted_id TEXT REFERENCES encrypted_objects(id),
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          created_at TEXT NOT NULL,
          UNIQUE(artifact_version_id,ordinal)
        ) STRICT;
        CREATE TABLE artifact_checks (
          artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
          check_type TEXT NOT NULL CHECK(check_type IN ('opens','checksum','citations','visual','links','fonts','bounds','accessibility','render')),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          score REAL CHECK(score IS NULL OR score BETWEEN 0 AND 1),
          details_encrypted_id TEXT REFERENCES encrypted_objects(id),
          checked_at TEXT NOT NULL,
          PRIMARY KEY(artifact_version_id,check_type)
        ) STRICT;
      `);
    },
  },
  {
    version: 21,
    wave: 23,
    name: "multimodal-artifact-parts-and-retrieval",
    up(db) {
      db.exec(`
        CREATE TABLE artifact_extraction_runs (
          id TEXT PRIMARY KEY,
          artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
          extractor TEXT NOT NULL,
          extractor_version TEXT NOT NULL,
          modality TEXT NOT NULL CHECK(modality IN ('document','pdf','slides','sheet','code','image','audio','video','multimodal')),
          input_hash TEXT NOT NULL,
          expected_parts INTEGER NOT NULL CHECK(expected_parts >= 0),
          produced_parts INTEGER NOT NULL CHECK(produced_parts >= 0),
          status TEXT NOT NULL CHECK(status IN ('running','complete','partial','failed','cancelled')),
          error_code TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          UNIQUE(artifact_version_id,extractor,extractor_version,modality)
        ) STRICT;
        CREATE TABLE artifact_parts (
          id TEXT PRIMARY KEY,
          artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
          extraction_run_id TEXT NOT NULL REFERENCES artifact_extraction_runs(id),
          parent_part_id TEXT REFERENCES artifact_parts(id),
          part_type TEXT NOT NULL CHECK(part_type IN ('document','page','slide','sheet','table','cell','code_file','code_symbol','image','region','audio_segment','video_segment','frame','transcript','chart')),
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          locator_encrypted_id TEXT REFERENCES encrypted_objects(id),
          content_encrypted_id TEXT REFERENCES encrypted_objects(id),
          features_encrypted_id TEXT REFERENCES encrypted_objects(id),
          content_hash TEXT NOT NULL,
          grounding_confidence REAL NOT NULL CHECK(grounding_confidence BETWEEN 0 AND 1),
          render_status TEXT NOT NULL CHECK(render_status IN ('not_applicable','pending','passed','failed')),
          status TEXT NOT NULL CHECK(status IN ('active','stale','deleted')),
          created_at TEXT NOT NULL,
          UNIQUE(artifact_version_id,part_type,ordinal),
          CHECK((locator_encrypted_id IS NOT NULL AND content_encrypted_id IS NOT NULL) OR status='deleted')
        ) STRICT;
        CREATE INDEX artifact_parts_lookup_idx ON artifact_parts(artifact_version_id,part_type,status,ordinal);
        CREATE TABLE artifact_part_exact_keys (
          part_id TEXT NOT NULL REFERENCES artifact_parts(id),
          key_type TEXT NOT NULL CHECK(key_type IN ('page','slide','sheet','cell','symbol','frame','timecode','caption','filename','chart')),
          key_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(part_id,key_type,key_hash)
        ) STRICT;
        CREATE INDEX artifact_part_exact_lookup_idx ON artifact_part_exact_keys(key_type,key_hash,part_id);
        CREATE VIRTUAL TABLE artifact_part_fts USING fts5(part_id UNINDEXED, token_stream, tokenize='unicode61');
        CREATE TABLE artifact_part_relations (
          from_part_id TEXT NOT NULL REFERENCES artifact_parts(id),
          to_part_id TEXT NOT NULL REFERENCES artifact_parts(id),
          relation TEXT NOT NULL CHECK(relation IN ('contains','equivalent_to','derived_from','visualizes','transcribes','same_content','references')),
          confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
          created_at TEXT NOT NULL,
          PRIMARY KEY(from_part_id,to_part_id,relation),
          CHECK(from_part_id <> to_part_id)
        ) STRICT;
        CREATE TABLE normalized_document_graphs (
          id TEXT PRIMARY KEY,
          artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
          graph_version TEXT NOT NULL,
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          node_count INTEGER NOT NULL CHECK(node_count >= 0),
          edge_count INTEGER NOT NULL CHECK(edge_count >= 0),
          source_coverage_json TEXT NOT NULL CHECK(json_valid(source_coverage_json)),
          status TEXT NOT NULL CHECK(status IN ('active','stale','deleted')),
          created_at TEXT NOT NULL,
          UNIQUE(artifact_version_id,graph_version),
          CHECK(payload_encrypted_id IS NOT NULL OR status='deleted')
        ) STRICT;
        CREATE TABLE artifact_retrieval_runs (
          id TEXT PRIMARY KEY,
          scope_ids_json TEXT NOT NULL CHECK(json_valid(scope_ids_json)),
          query_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          artifact_id TEXT REFERENCES artifacts(id),
          artifact_version_id TEXT REFERENCES artifact_versions(id),
          part_types_json TEXT NOT NULL CHECK(json_valid(part_types_json)),
          channels_json TEXT NOT NULL CHECK(json_valid(channels_json)),
          status TEXT NOT NULL CHECK(status IN ('complete','degraded','failed','denied')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE artifact_retrieval_candidates (
          run_id TEXT NOT NULL REFERENCES artifact_retrieval_runs(id),
          part_id TEXT NOT NULL REFERENCES artifact_parts(id),
          channel TEXT NOT NULL CHECK(channel IN ('exact','lexical','equivalence')),
          rank INTEGER NOT NULL CHECK(rank > 0),
          score REAL NOT NULL,
          reason_code TEXT NOT NULL,
          PRIMARY KEY(run_id,part_id,channel)
        ) STRICT;
      `);
    },
  },
  {
    version: 22,
    wave: 24,
    name: "verified-experience-and-procedural-learning",
    up(db) {
      db.exec(`
        CREATE TABLE outcome_verifications (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          task_id TEXT,
          answer_ref TEXT,
          outcome_kind TEXT NOT NULL CHECK(outcome_kind IN ('task','answer','procedure')),
          success INTEGER NOT NULL CHECK(success IN (0,1)),
          evaluator_kind TEXT NOT NULL CHECK(evaluator_kind IN ('deterministic','owner','review')),
          criteria_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          evidence_refs_json TEXT NOT NULL CHECK(json_valid(evidence_refs_json)),
          environment_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          environment_hash TEXT NOT NULL,
          independent_group TEXT NOT NULL,
          verified_by TEXT NOT NULL REFERENCES actors(id),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK(task_id IS NOT NULL OR answer_ref IS NOT NULL)
        ) STRICT;
        CREATE INDEX outcome_verification_scope_idx ON outcome_verifications(scope_id,outcome_kind,created_at);
        CREATE TABLE experience_cases (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          task_signature TEXT NOT NULL,
          task_class TEXT NOT NULL,
          case_type TEXT NOT NULL CHECK(case_type IN ('success','failure','counterexample')),
          verification_id TEXT NOT NULL UNIQUE REFERENCES outcome_verifications(id),
          environment_hash TEXT NOT NULL,
          environment_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json)),
          output_refs_json TEXT NOT NULL CHECK(json_valid(output_refs_json)),
          tool_refs_json TEXT NOT NULL CHECK(json_valid(tool_refs_json)),
          permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json)),
          trajectory_summary_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('active','retired','deleted')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX experience_case_signature_idx ON experience_cases(scope_id,task_signature,case_type,status);
        CREATE TABLE experience_clusters (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          task_signature TEXT NOT NULL,
          environment_family TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','retired')),
          created_at TEXT NOT NULL,
          UNIQUE(scope_id,task_signature,environment_family)
        ) STRICT;
        CREATE TABLE experience_cluster_members (
          cluster_id TEXT NOT NULL REFERENCES experience_clusters(id),
          case_id TEXT NOT NULL UNIQUE REFERENCES experience_cases(id),
          created_at TEXT NOT NULL,
          PRIMARY KEY(cluster_id,case_id)
        ) STRICT;
        CREATE TABLE lesson_candidates (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          cluster_id TEXT NOT NULL REFERENCES experience_clusters(id),
          task_signature TEXT NOT NULL,
          name_encrypted_id TEXT REFERENCES encrypted_objects(id),
          blueprint_encrypted_id TEXT REFERENCES encrypted_objects(id),
          environment_selector_encrypted_id TEXT REFERENCES encrypted_objects(id),
          inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
          outputs_json TEXT NOT NULL CHECK(json_valid(outputs_json)),
          tools_json TEXT NOT NULL CHECK(json_valid(tools_json)),
          permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json)),
          success_case_ids_json TEXT NOT NULL CHECK(json_valid(success_case_ids_json)),
          failure_case_ids_json TEXT NOT NULL CHECK(json_valid(failure_case_ids_json)),
          counterexample_case_ids_json TEXT NOT NULL CHECK(json_valid(counterexample_case_ids_json)),
          risk TEXT NOT NULL CHECK(risk IN ('low','medium','high','critical')),
          side_effecting INTEGER NOT NULL CHECK(side_effecting IN (0,1)),
          protected_behavior INTEGER NOT NULL CHECK(protected_behavior IN (0,1)),
          min_reliability REAL NOT NULL CHECK(min_reliability BETWEEN 0 AND 1),
          status TEXT NOT NULL CHECK(status IN ('quarantined','test_failed','ready_review','approved','rejected','promoted')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK((name_encrypted_id IS NOT NULL AND blueprint_encrypted_id IS NOT NULL AND environment_selector_encrypted_id IS NOT NULL) OR status IN ('rejected','promoted'))
        ) STRICT;
        CREATE INDEX lesson_candidate_queue_idx ON lesson_candidates(scope_id,status,risk,created_at);
        CREATE TABLE lesson_test_runs (
          id TEXT PRIMARY KEY,
          candidate_id TEXT NOT NULL REFERENCES lesson_candidates(id),
          case_results_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          tested_case_ids_json TEXT NOT NULL CHECK(json_valid(tested_case_ids_json)),
          success_pass_rate REAL NOT NULL CHECK(success_pass_rate BETWEEN 0 AND 1),
          failure_rejection_rate REAL NOT NULL CHECK(failure_rejection_rate BETWEEN 0 AND 1),
          counterexample_pass_rate REAL NOT NULL CHECK(counterexample_pass_rate BETWEEN 0 AND 1),
          environment_mismatches INTEGER NOT NULL CHECK(environment_mismatches >= 0),
          permission_violations INTEGER NOT NULL CHECK(permission_violations >= 0),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX lesson_test_candidate_idx ON lesson_test_runs(candidate_id,created_at);
        CREATE TABLE procedures (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          task_signature TEXT NOT NULL,
          name_encrypted_id TEXT REFERENCES encrypted_objects(id),
          active_version INTEGER NOT NULL CHECK(active_version >= 0),
          status TEXT NOT NULL CHECK(status IN ('active','suspended','retired','deleted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(name_encrypted_id IS NOT NULL OR status='deleted'),
          UNIQUE(scope_id,task_signature)
        ) STRICT;
        CREATE TABLE procedure_versions (
          id TEXT PRIMARY KEY,
          procedure_id TEXT NOT NULL REFERENCES procedures(id),
          version INTEGER NOT NULL CHECK(version > 0),
          candidate_id TEXT NOT NULL REFERENCES lesson_candidates(id),
          blueprint_encrypted_id TEXT REFERENCES encrypted_objects(id),
          environment_selector_encrypted_id TEXT REFERENCES encrypted_objects(id),
          inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
          outputs_json TEXT NOT NULL CHECK(json_valid(outputs_json)),
          tools_json TEXT NOT NULL CHECK(json_valid(tools_json)),
          permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json)),
          side_effecting INTEGER NOT NULL CHECK(side_effecting IN (0,1)),
          protected_behavior INTEGER NOT NULL CHECK(protected_behavior IN (0,1)),
          min_reliability REAL NOT NULL CHECK(min_reliability BETWEEN 0 AND 1),
          successes INTEGER NOT NULL CHECK(successes >= 0),
          failures INTEGER NOT NULL CHECK(failures >= 0),
          reliability REAL NOT NULL CHECK(reliability BETWEEN 0 AND 1),
          status TEXT NOT NULL CHECK(status IN ('active','suspended','superseded','rejected','deleted')),
          approved_by TEXT NOT NULL REFERENCES actors(id),
          created_at TEXT NOT NULL,
          suspended_at TEXT,
          suspension_reason TEXT,
          UNIQUE(procedure_id,version),
          CHECK((blueprint_encrypted_id IS NOT NULL AND environment_selector_encrypted_id IS NOT NULL) OR status='deleted')
        ) STRICT;
        CREATE UNIQUE INDEX procedure_version_active_idx ON procedure_versions(procedure_id) WHERE status='active';
        CREATE TABLE procedure_outcomes (
          id TEXT PRIMARY KEY,
          procedure_version_id TEXT NOT NULL REFERENCES procedure_versions(id),
          verification_id TEXT NOT NULL UNIQUE REFERENCES outcome_verifications(id),
          environment_match INTEGER NOT NULL CHECK(environment_match IN (0,1)),
          success INTEGER NOT NULL CHECK(success IN (0,1)),
          reliability_after REAL NOT NULL CHECK(reliability_after BETWEEN 0 AND 1),
          action TEXT NOT NULL CHECK(action IN ('observe','suspend','ignore_environment')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE procedure_adapters (
          id TEXT PRIMARY KEY,
          procedure_version_id TEXT NOT NULL REFERENCES procedure_versions(id),
          adapter_type TEXT NOT NULL CHECK(adapter_type IN ('skill','langgraph','checklist')),
          manifest_encrypted_id TEXT REFERENCES encrypted_objects(id),
          manifest_hash TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('draft','active','retired','deleted')),
          created_at TEXT NOT NULL,
          UNIQUE(procedure_version_id,adapter_type),
          CHECK(manifest_encrypted_id IS NOT NULL OR state='deleted')
        ) STRICT;
        ALTER TABLE retrieval_outcomes ADD COLUMN verification_id TEXT REFERENCES outcome_verifications(id);
        CREATE INDEX retrieval_outcome_verification_idx ON retrieval_outcomes(verification_id);
      `);
    },
  },
  {
    version: 23,
    wave: 25,
    name: "room-manifests-and-helix-integration",
    up(db) {
      db.exec(`
        CREATE TABLE room_manifests (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          room TEXT NOT NULL,
          project_id TEXT NOT NULL,
          operation_id TEXT,
          run_id TEXT,
          status TEXT NOT NULL,
          objective_encrypted_id TEXT REFERENCES encrypted_objects(id),
          summary_encrypted_id TEXT REFERENCES encrypted_objects(id),
          open_loops_encrypted_id TEXT REFERENCES encrypted_objects(id),
          warnings_encrypted_id TEXT REFERENCES encrypted_objects(id),
          cost_json TEXT NOT NULL CHECK(json_valid(cost_json)),
          visibility_scopes_json TEXT NOT NULL CHECK(json_valid(visibility_scopes_json)),
          source_sequence INTEGER NOT NULL CHECK(source_sequence >= 0),
          manifest_hash TEXT NOT NULL,
          supersedes_manifest_id TEXT REFERENCES room_manifests(id),
          state TEXT NOT NULL CHECK(state IN ('current','superseded','deleted')),
          created_at TEXT NOT NULL,
          CHECK((objective_encrypted_id IS NOT NULL AND summary_encrypted_id IS NOT NULL AND open_loops_encrypted_id IS NOT NULL AND warnings_encrypted_id IS NOT NULL) OR state='deleted'),
          UNIQUE(room,project_id,source_sequence)
        ) STRICT;
        CREATE UNIQUE INDEX room_manifest_current_idx ON room_manifests(room,project_id) WHERE state='current';
        CREATE INDEX room_manifest_scope_idx ON room_manifests(scope_id,room,state,created_at);
        CREATE TABLE room_manifest_refs (
          manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          ref_kind TEXT NOT NULL CHECK(ref_kind IN ('project','folder','segment','question','plan','run','source','evidence','claim','decision','artifact','task','operation','strategy','dataset','signal','test','outcome','report','prediction','block','mutation')),
          ref_id TEXT NOT NULL,
          ref_version TEXT NOT NULL,
          domain_owner TEXT NOT NULL,
          pointer_encrypted_id TEXT REFERENCES encrypted_objects(id),
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          PRIMARY KEY(manifest_id,ref_kind,ref_id,ref_version)
        ) STRICT;
        CREATE INDEX room_manifest_ref_lookup_idx ON room_manifest_refs(ref_kind,ref_id,ref_version);
        CREATE TABLE room_lineage_edges (
          id TEXT PRIMARY KEY,
          manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          from_kind TEXT NOT NULL,
          from_id TEXT NOT NULL,
          from_version TEXT NOT NULL,
          to_kind TEXT NOT NULL,
          to_id TEXT NOT NULL,
          to_version TEXT NOT NULL,
          relation TEXT NOT NULL CHECK(relation IN ('derived_from','supports','contradicts','produces','uses','supersedes','part_of','tests','selects','rejects','annotates')),
          created_at TEXT NOT NULL,
          CHECK(NOT(from_kind=to_kind AND from_id=to_id AND from_version=to_version))
        ) STRICT;
        CREATE INDEX room_lineage_from_idx ON room_lineage_edges(from_kind,from_id,from_version);
        CREATE INDEX room_lineage_to_idx ON room_lineage_edges(to_kind,to_id,to_version);
        CREATE TABLE room_context_packages (
          id TEXT PRIMARY KEY,
          manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          package_type TEXT NOT NULL CHECK(package_type IN ('project','folder','segment','research_run')),
          package_ref TEXT NOT NULL,
          package_version TEXT NOT NULL,
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          payload_hash TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('current','superseded','deleted')),
          created_at TEXT NOT NULL,
          CHECK(payload_encrypted_id IS NOT NULL OR state='deleted'),
          UNIQUE(manifest_id,package_type,package_ref,package_version)
        ) STRICT;
        CREATE TABLE room_package_refs (
          package_id TEXT NOT NULL REFERENCES room_context_packages(id),
          ref_kind TEXT NOT NULL,
          ref_id TEXT NOT NULL,
          ref_version TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          PRIMARY KEY(package_id,ref_kind,ref_id,ref_version)
        ) STRICT;
        CREATE TABLE room_publication_exclusions (
          id TEXT PRIMARY KEY,
          manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          domain_ref TEXT NOT NULL,
          exclusion_kind TEXT NOT NULL CHECK(exclusion_kind IN ('internal_model','telemetry','raw_body','private_agent')),
          reason_code TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE room_publication_receipts (
          id TEXT PRIMARY KEY,
          manifest_id TEXT NOT NULL UNIQUE REFERENCES room_manifests(id),
          input_hash TEXT NOT NULL,
          published_ref_count INTEGER NOT NULL CHECK(published_ref_count >= 0),
          excluded_ref_count INTEGER NOT NULL CHECK(excluded_ref_count >= 0),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 24,
    wave: 26,
    name: "apex-forge-lineage-and-freshness",
    up(db) {
      db.exec(`
        CREATE TABLE apex_freshness_contracts (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          ref_type TEXT NOT NULL CHECK(ref_type IN ('market','dataset','news','quote','signal','prediction')),
          ref_id TEXT NOT NULL,
          ref_version TEXT NOT NULL,
          owner TEXT NOT NULL CHECK(owner='apex'),
          as_of TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          max_age_seconds INTEGER NOT NULL CHECK(max_age_seconds >= 0),
          state TEXT NOT NULL CHECK(state IN ('fresh','stale','unknown','superseded')),
          route TEXT NOT NULL CHECK(route IN ('live_pointer','snapshot_allowed','historical_only')),
          pointer_encrypted_id TEXT REFERENCES encrypted_objects(id),
          source_health TEXT NOT NULL CHECK(source_health IN ('healthy','degraded','offline','unknown')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(pointer_encrypted_id IS NOT NULL OR state='superseded'),
          UNIQUE(scope_id,ref_type,ref_id,ref_version)
        ) STRICT;
        CREATE INDEX apex_freshness_lookup_idx ON apex_freshness_contracts(scope_id,ref_type,ref_id,state,expires_at);
        CREATE TABLE forge_run_manifests (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          project_id TEXT NOT NULL,
          strategy_id TEXT NOT NULL,
          strategy_version TEXT NOT NULL,
          graph_version TEXT NOT NULL,
          manifest_encrypted_id TEXT REFERENCES encrypted_objects(id),
          metrics_encrypted_id TEXT REFERENCES encrypted_objects(id),
          manifest_hash TEXT NOT NULL,
          room_manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          status TEXT NOT NULL CHECK(status IN ('draft','tested','selected','rejected','superseded','deleted')),
          created_at TEXT NOT NULL,
          CHECK((manifest_encrypted_id IS NOT NULL AND metrics_encrypted_id IS NOT NULL) OR status='deleted'),
          UNIQUE(strategy_id,strategy_version,graph_version)
        ) STRICT;
        CREATE INDEX forge_run_project_idx ON forge_run_manifests(scope_id,project_id,status,created_at);
        CREATE TABLE forge_lineage_edges (
          id TEXT PRIMARY KEY,
          forge_run_id TEXT NOT NULL REFERENCES forge_run_manifests(id),
          from_kind TEXT NOT NULL CHECK(from_kind IN ('strategy','dataset','signal','block','mutation','test','report')),
          from_id TEXT NOT NULL,
          from_version TEXT NOT NULL,
          to_kind TEXT NOT NULL CHECK(to_kind IN ('strategy','dataset','signal','block','mutation','test','report')),
          to_id TEXT NOT NULL,
          to_version TEXT NOT NULL,
          relation TEXT NOT NULL CHECK(relation IN ('derived_from','uses','produces','tests','accepts','rejects','branches_from','supersedes')),
          created_at TEXT NOT NULL,
          CHECK(NOT(from_kind=to_kind AND from_id=to_id AND from_version=to_version))
        ) STRICT;
        CREATE INDEX forge_lineage_from_idx ON forge_lineage_edges(from_kind,from_id,from_version);
        CREATE INDEX forge_lineage_to_idx ON forge_lineage_edges(to_kind,to_id,to_version);
        CREATE TABLE apex_validation_receipts (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          target_type TEXT NOT NULL CHECK(target_type IN ('strategy','dataset','signal','test','outcome','report','prediction')),
          target_id TEXT NOT NULL,
          target_version TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('passed','failed','unresolved')),
          metrics_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          evidence_refs_json TEXT NOT NULL CHECK(json_valid(evidence_refs_json)),
          freshness_contract_id TEXT REFERENCES apex_freshness_contracts(id),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX apex_validation_target_idx ON apex_validation_receipts(target_type,target_id,target_version,created_at);
      `);
    },
  },
  {
    version: 25,
    wave: 27,
    name: "eclipse-capability-scoped-mission-memory",
    up(db) {
      db.exec(`
        DROP INDEX room_manifest_ref_lookup_idx;
        ALTER TABLE room_manifest_refs RENAME TO room_manifest_refs_v23;
        CREATE TABLE room_manifest_refs (
          manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          ref_kind TEXT NOT NULL CHECK(ref_kind IN ('project','folder','segment','question','plan','run','source','evidence','claim','decision','artifact','task','operation','strategy','dataset','signal','test','outcome','report','prediction','block','mutation','mission','branch','node','agent')),
          ref_id TEXT NOT NULL,
          ref_version TEXT NOT NULL,
          domain_owner TEXT NOT NULL,
          pointer_encrypted_id TEXT REFERENCES encrypted_objects(id),
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          PRIMARY KEY(manifest_id,ref_kind,ref_id,ref_version)
        ) STRICT;
        INSERT INTO room_manifest_refs(manifest_id,ref_kind,ref_id,ref_version,domain_owner,pointer_encrypted_id,ordinal)
          SELECT manifest_id,ref_kind,ref_id,ref_version,domain_owner,pointer_encrypted_id,ordinal FROM room_manifest_refs_v23;
        DROP TABLE room_manifest_refs_v23;
        CREATE INDEX room_manifest_ref_lookup_idx ON room_manifest_refs(ref_kind,ref_id,ref_version);
        CREATE TABLE eclipse_manifest_policies (
          id TEXT PRIMARY KEY,
          manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          ref_kind TEXT NOT NULL,
          ref_id TEXT NOT NULL,
          ref_version TEXT NOT NULL,
          visibility TEXT NOT NULL CHECK(visibility IN ('owner','mission','agent_private','quarantined')),
          capability TEXT NOT NULL,
          subject_id TEXT,
          lease_id TEXT,
          trust_zone TEXT NOT NULL CHECK(trust_zone IN ('trusted','untrusted','agent_private')),
          expires_at TEXT,
          created_at TEXT NOT NULL,
          CHECK(visibility <> 'agent_private' OR subject_id IS NOT NULL),
          CHECK(visibility <> 'owner' OR trust_zone = 'trusted'),
          UNIQUE(manifest_id,ref_kind,ref_id,ref_version)
        ) STRICT;
        CREATE INDEX eclipse_manifest_policy_lookup_idx ON eclipse_manifest_policies(manifest_id,visibility,capability,expires_at);
        CREATE TABLE eclipse_agent_experience (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          manifest_id TEXT NOT NULL REFERENCES room_manifests(id),
          mission_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          outcome_verification_id TEXT NOT NULL REFERENCES outcome_verifications(id),
          experience_case_id TEXT REFERENCES experience_cases(id),
          result TEXT NOT NULL CHECK(result IN ('success','failure')),
          trust_zone TEXT NOT NULL CHECK(trust_zone IN ('trusted','untrusted','agent_private')),
          promotable INTEGER NOT NULL DEFAULT 0 CHECK(promotable IN (0,1)),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(agent_id,outcome_verification_id)
        ) STRICT;
        CREATE INDEX eclipse_agent_experience_mission_idx ON eclipse_agent_experience(scope_id,mission_id,agent_id,created_at);
      `);
    },
  },
  {
    version: 26,
    wave: 28,
    name: "mesh-envelopes-hlc-selective-sync",
    up(db) {
      db.exec(`
        CREATE TABLE mesh_peers (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          identity_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          fingerprint TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('active','revoked','blocked')),
          registered_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(scope_id,fingerprint)
        ) STRICT;
        CREATE TABLE mesh_capability_leases (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          peer_id TEXT NOT NULL REFERENCES mesh_peers(id),
          session_id TEXT NOT NULL,
          capabilities_json TEXT NOT NULL CHECK(json_valid(capabilities_json)),
          resources_json TEXT NOT NULL CHECK(json_valid(resources_json)),
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          state TEXT NOT NULL CHECK(state IN ('active','revoked','expired')),
          may_delegate INTEGER NOT NULL DEFAULT 0 CHECK(may_delegate=0),
          receipt_mac TEXT NOT NULL
        ) STRICT;
        CREATE INDEX mesh_lease_lookup_idx ON mesh_capability_leases(peer_id,session_id,state,expires_at);
        CREATE TABLE mesh_sync_envelopes (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          peer_id TEXT NOT NULL REFERENCES mesh_peers(id),
          session_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
          packet_type TEXT NOT NULL CHECK(packet_type IN ('memory_packet','manifest_pointer','replay_pointer','crdt_update')),
          hlc_wall_ms INTEGER NOT NULL CHECK(hlc_wall_ms >= 0),
          hlc_counter INTEGER NOT NULL CHECK(hlc_counter >= 0),
          hlc_node TEXT NOT NULL,
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          payload_hash TEXT NOT NULL,
          wire_hash TEXT NOT NULL,
          wire_signature TEXT NOT NULL,
          lease_id TEXT NOT NULL REFERENCES mesh_capability_leases(id),
          state TEXT NOT NULL CHECK(state IN ('current','late','expired','revoked')),
          created_at TEXT NOT NULL,
          UNIQUE(peer_id,session_id,id)
        ) STRICT;
        CREATE INDEX mesh_envelope_order_idx ON mesh_sync_envelopes(peer_id,session_id,hlc_wall_ms,hlc_counter,hlc_node);
        CREATE TABLE mesh_replay_pointers (
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          peer_id TEXT NOT NULL REFERENCES mesh_peers(id),
          session_id TEXT NOT NULL,
          last_wall_ms INTEGER NOT NULL CHECK(last_wall_ms >= 0),
          last_counter INTEGER NOT NULL CHECK(last_counter >= 0),
          last_node TEXT NOT NULL,
          last_envelope_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(scope_id,peer_id,session_id)
        ) STRICT;
        CREATE TABLE mesh_shared_packets (
          id TEXT PRIMARY KEY,
          envelope_id TEXT NOT NULL UNIQUE REFERENCES mesh_sync_envelopes(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          peer_id TEXT NOT NULL REFERENCES mesh_peers(id),
          session_id TEXT NOT NULL,
          packet_type TEXT NOT NULL,
          ref_type TEXT NOT NULL,
          ref_id TEXT NOT NULL,
          ref_version TEXT NOT NULL,
          payload_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          expires_at TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('active','expired','revoked')),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX mesh_packet_lookup_idx ON mesh_shared_packets(scope_id,peer_id,session_id,state,expires_at);
        CREATE TABLE mesh_crdt_documents (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          session_id TEXT NOT NULL,
          document_type TEXT NOT NULL CHECK(document_type IN ('layout','scratchpad','whiteboard','task_board','decision_log')),
          document_ref TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version > 0),
          update_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          update_hash TEXT NOT NULL,
          source_envelope_id TEXT NOT NULL REFERENCES mesh_sync_envelopes(id),
          state TEXT NOT NULL CHECK(state IN ('active','revoked')),
          created_at TEXT NOT NULL,
          UNIQUE(scope_id,session_id,document_type,document_ref,version)
        ) STRICT;
        CREATE TABLE mesh_revocations (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          peer_id TEXT NOT NULL REFERENCES mesh_peers(id),
          lease_id TEXT REFERENCES mesh_capability_leases(id),
          session_id TEXT,
          reason_code TEXT NOT NULL,
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 27,
    wave: 29,
    name: "operational-control-backup-and-restore",
    up(db) {
      db.exec(`
        CREATE TABLE operator_confirmations (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX operator_confirmation_lookup_idx ON operator_confirmations(actor_id,action,expires_at,used_at);
        CREATE TABLE backup_packages (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          source_schema_version INTEGER NOT NULL,
          canonical_sequence INTEGER NOT NULL CHECK(canonical_sequence >= 0),
          package_path TEXT NOT NULL,
          manifest_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          package_sha256 TEXT NOT NULL,
          byte_size INTEGER NOT NULL CHECK(byte_size > 0),
          quick_check TEXT NOT NULL,
          recovery_wrapped INTEGER NOT NULL CHECK(recovery_wrapped IN (0,1)),
          state TEXT NOT NULL CHECK(state IN ('complete','superseded','deleted')),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX backup_package_created_idx ON backup_packages(state,created_at);
        CREATE TABLE backup_exports (
          id TEXT PRIMARY KEY,
          backup_id TEXT NOT NULL REFERENCES backup_packages(id),
          target_path TEXT NOT NULL,
          package_sha256 TEXT NOT NULL,
          byte_size INTEGER NOT NULL CHECK(byte_size > 0),
          status TEXT NOT NULL CHECK(status IN ('complete','failed','deleted')),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE restore_drills (
          id TEXT PRIMARY KEY,
          backup_id TEXT NOT NULL REFERENCES backup_packages(id),
          result_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('passed','failed')),
          quick_check TEXT NOT NULL,
          integrity_check TEXT NOT NULL,
          foreign_key_violations INTEGER NOT NULL CHECK(foreign_key_violations >= 0),
          duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE projection_rebuild_runs (
          id TEXT PRIMARY KEY,
          projector TEXT NOT NULL,
          from_sequence INTEGER NOT NULL CHECK(from_sequence >= 0),
          to_sequence INTEGER NOT NULL CHECK(to_sequence >= from_sequence),
          manifest_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          coverage REAL NOT NULL CHECK(coverage >= 0 AND coverage <= 1),
          status TEXT NOT NULL CHECK(status IN ('passed','failed','quarantined')),
          activated INTEGER NOT NULL DEFAULT 0 CHECK(activated IN (0,1)),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK(activated=0 OR status='passed')
        ) STRICT;
        CREATE TABLE maintenance_runs (
          id TEXT PRIMARY KEY,
          run_type TEXT NOT NULL CHECK(run_type IN ('integrity','wal_checkpoint','orphan_scan','privacy_audit','performance_soak','degraded_drill')),
          result_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('passed','degraded','failed')),
          duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE performance_soaks (
          id TEXT PRIMARY KEY,
          profile TEXT NOT NULL,
          sample_count INTEGER NOT NULL CHECK(sample_count > 0),
          duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
          p50_ms REAL NOT NULL CHECK(p50_ms >= 0),
          p95_ms REAL NOT NULL CHECK(p95_ms >= 0),
          max_ms REAL NOT NULL CHECK(max_ms >= 0),
          error_count INTEGER NOT NULL CHECK(error_count >= 0),
          result_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          status TEXT NOT NULL CHECK(status IN ('passed','degraded','failed')),
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 28,
    wave: 30,
    name: "staged-import-dedupe-scope-review",
    up(db) {
      db.exec(`
        CREATE TABLE import_runs (
          id TEXT PRIMARY KEY,
          inventory_hash TEXT NOT NULL,
          snapshot_set_hash TEXT NOT NULL,
          adapter_version TEXT NOT NULL,
          manifest_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          expected_rows INTEGER NOT NULL CHECK(expected_rows >= 0),
          observed_rows INTEGER NOT NULL DEFAULT 0 CHECK(observed_rows >= 0),
          staged_rows INTEGER NOT NULL DEFAULT 0 CHECK(staged_rows >= 0),
          excluded_rows INTEGER NOT NULL DEFAULT 0 CHECK(excluded_rows >= 0),
          conflict_rows INTEGER NOT NULL DEFAULT 0 CHECK(conflict_rows >= 0),
          pending_review_rows INTEGER NOT NULL DEFAULT 0 CHECK(pending_review_rows >= 0),
          status TEXT NOT NULL CHECK(status IN ('staging','review_ready','reconciled','failed','rejected')),
          created_at TEXT NOT NULL,
          completed_at TEXT
        ) STRICT;
        CREATE TABLE import_sources (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES import_runs(id),
          source_key TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          snapshot_sha256 TEXT NOT NULL,
          snapshot_path_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          table_name TEXT NOT NULL,
          expected_rows INTEGER NOT NULL CHECK(expected_rows >= 0),
          observed_rows INTEGER NOT NULL DEFAULT 0 CHECK(observed_rows >= 0),
          accepted_rows INTEGER NOT NULL DEFAULT 0 CHECK(accepted_rows >= 0),
          excluded_rows INTEGER NOT NULL DEFAULT 0 CHECK(excluded_rows >= 0),
          exclusion_reason TEXT,
          status TEXT NOT NULL CHECK(status IN ('pending','staged','excluded','failed')),
          policy_version TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(run_id,source_key,table_name)
        ) STRICT;
        CREATE TABLE import_candidates (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES import_runs(id),
          source_id TEXT NOT NULL REFERENCES import_sources(id),
          legacy_table TEXT NOT NULL,
          legacy_id TEXT NOT NULL,
          source_record_hash TEXT NOT NULL,
          record_type TEXT NOT NULL,
          proposed_scope TEXT NOT NULL,
          scope_confidence REAL NOT NULL CHECK(scope_confidence BETWEEN 0 AND 1),
          scope_reason TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','internal','private','restricted')),
          payload_encrypted_id TEXT REFERENCES encrypted_objects(id),
          provenance_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          normalized_hash TEXT,
          typed_key_hash TEXT,
          decision TEXT NOT NULL CHECK(decision IN ('pending','accepted','rejected','quarantined','conflict')),
          exclusion_reason TEXT,
          requires_owner_review INTEGER NOT NULL CHECK(requires_owner_review IN (0,1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(payload_encrypted_id IS NOT NULL OR decision='rejected'),
          UNIQUE(source_id,legacy_table,legacy_id)
        ) STRICT;
        CREATE INDEX import_candidate_review_idx ON import_candidates(run_id,decision,record_type,proposed_scope);
        CREATE INDEX import_candidate_hash_idx ON import_candidates(run_id,normalized_hash,typed_key_hash);
        CREATE TABLE import_equivalences (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES import_runs(id),
          candidate_a_id TEXT NOT NULL REFERENCES import_candidates(id),
          candidate_b_id TEXT NOT NULL REFERENCES import_candidates(id),
          match_type TEXT NOT NULL CHECK(match_type IN ('stable_id','exact_hash','typed_key','near_text','semantic_candidate')),
          confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
          decision TEXT NOT NULL CHECK(decision IN ('proposed','confirmed','rejected')),
          reversible INTEGER NOT NULL DEFAULT 1 CHECK(reversible=1),
          created_at TEXT NOT NULL,
          CHECK(candidate_a_id < candidate_b_id),
          UNIQUE(run_id,candidate_a_id,candidate_b_id,match_type)
        ) STRICT;
        CREATE TABLE import_conflicts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES import_runs(id),
          conflict_key TEXT NOT NULL,
          candidate_ids_json TEXT NOT NULL CHECK(json_valid(candidate_ids_json)),
          conflict_type TEXT NOT NULL CHECK(conflict_type IN ('typed_value','scope','authority','temporal','protected_seed')),
          severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
          status TEXT NOT NULL CHECK(status IN ('open','resolved','dismissed')),
          resolution_encrypted_id TEXT REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          UNIQUE(run_id,conflict_key)
        ) STRICT;
        CREATE TABLE import_review_batches (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES import_runs(id),
          batch_type TEXT NOT NULL CHECK(batch_type IN ('protected','scope','conflict','sample','procedure','domain_manifest')),
          risk TEXT NOT NULL CHECK(risk IN ('low','medium','high','critical')),
          status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','partial')),
          created_by TEXT NOT NULL REFERENCES actors(id),
          decided_by TEXT REFERENCES actors(id),
          receipt_mac TEXT,
          created_at TEXT NOT NULL,
          decided_at TEXT
        ) STRICT;
        CREATE TABLE import_review_items (
          batch_id TEXT NOT NULL REFERENCES import_review_batches(id),
          candidate_id TEXT NOT NULL REFERENCES import_candidates(id),
          decision TEXT NOT NULL CHECK(decision IN ('pending','accept','reject','quarantine')),
          reason_code TEXT,
          PRIMARY KEY(batch_id,candidate_id)
        ) STRICT;
        CREATE TABLE import_reconciliation_receipts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL UNIQUE REFERENCES import_runs(id),
          expected_rows INTEGER NOT NULL CHECK(expected_rows >= 0),
          observed_rows INTEGER NOT NULL CHECK(observed_rows >= 0),
          staged_rows INTEGER NOT NULL CHECK(staged_rows >= 0),
          excluded_rows INTEGER NOT NULL CHECK(excluded_rows >= 0),
          conflict_rows INTEGER NOT NULL CHECK(conflict_rows >= 0),
          pending_review_rows INTEGER NOT NULL CHECK(pending_review_rows >= 0),
          source_hashes_json TEXT NOT NULL CHECK(json_valid(source_hashes_json)),
          exclusions_json TEXT NOT NULL CHECK(json_valid(exclusions_json)),
          sensitive_policy_json TEXT NOT NULL CHECK(json_valid(sensitive_policy_json)),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 29,
    wave: 31,
    name: "shadow-capture-counterfactual-gates",
    up(db) {
      db.exec(`
        CREATE TABLE shadow_sessions (
          id TEXT PRIMARY KEY,
          import_run_id TEXT NOT NULL REFERENCES import_runs(id),
          policy_version TEXT NOT NULL,
          started_at TEXT NOT NULL,
          required_until TEXT NOT NULL,
          completed_at TEXT,
          status TEXT NOT NULL CHECK(status IN ('capturing','evaluating','passed','failed','cancelled')),
          legacy_answers_authoritative INTEGER NOT NULL DEFAULT 1 CHECK(legacy_answers_authoritative IN (0,1)),
          duplicate_provider_calls INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_provider_calls=0)
        ) STRICT;
        CREATE TABLE shadow_intents (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES shadow_sessions(id),
          ledger_event_id TEXT NOT NULL UNIQUE REFERENCES ledger_events(event_id),
          idempotency_key TEXT NOT NULL,
          command_type TEXT NOT NULL,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          intent_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          intent_hash TEXT NOT NULL,
          legacy_receipt_ref TEXT,
          vnext_replay_ref TEXT,
          replay_status TEXT NOT NULL CHECK(replay_status IN ('captured','replayed','diverged','failed','skipped')),
          created_at TEXT NOT NULL,
          UNIQUE(session_id,idempotency_key)
        ) STRICT;
        CREATE TABLE shadow_query_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES shadow_sessions(id),
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          query_hash TEXT NOT NULL,
          query_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          legacy_result_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          vnext_result_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          shared_enrichment_ref TEXT,
          legacy_latency_ms REAL NOT NULL CHECK(legacy_latency_ms >= 0),
          vnext_latency_ms REAL NOT NULL CHECK(vnext_latency_ms >= 0),
          duplicate_provider_calls INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_provider_calls=0),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX shadow_query_session_idx ON shadow_query_runs(session_id,created_at);
        CREATE TABLE shadow_comparisons (
          id TEXT PRIMARY KEY,
          query_run_id TEXT NOT NULL UNIQUE REFERENCES shadow_query_runs(id),
          metrics_json TEXT NOT NULL CHECK(json_valid(metrics_json)),
          classification TEXT NOT NULL CHECK(classification IN ('equivalent','vnext_better','legacy_better','scope_leak','temporal_error','deletion_error','privacy_error','missing','expected_difference')),
          severity TEXT NOT NULL CHECK(severity IN ('none','low','medium','high','critical')),
          status TEXT NOT NULL CHECK(status IN ('open','resolved','accepted')),
          explanation_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          created_at TEXT NOT NULL,
          resolved_at TEXT
        ) STRICT;
        CREATE TABLE shadow_benchmark_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES shadow_sessions(id),
          suite TEXT NOT NULL,
          corpus_version TEXT NOT NULL,
          case_count INTEGER NOT NULL CHECK(case_count >= 0),
          passed_count INTEGER NOT NULL CHECK(passed_count >= 0),
          scope_leaks INTEGER NOT NULL CHECK(scope_leaks >= 0),
          privacy_failures INTEGER NOT NULL CHECK(privacy_failures >= 0),
          deletion_failures INTEGER NOT NULL CHECK(deletion_failures >= 0),
          p95_latency_ms REAL NOT NULL CHECK(p95_latency_ms >= 0),
          result_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE shadow_rollback_rehearsals (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES shadow_sessions(id),
          domain TEXT NOT NULL,
          forward_state TEXT NOT NULL,
          rollback_state TEXT NOT NULL,
          replay_export_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(session_id,domain)
        ) STRICT;
        CREATE TABLE shadow_gate_windows (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL UNIQUE REFERENCES shadow_sessions(id),
          window_start TEXT NOT NULL,
          window_end TEXT NOT NULL,
          metrics_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          unresolved_critical INTEGER NOT NULL CHECK(unresolved_critical >= 0),
          unresolved_high INTEGER NOT NULL CHECK(unresolved_high >= 0),
          scope_leaks INTEGER NOT NULL CHECK(scope_leaks >= 0),
          deletion_failures INTEGER NOT NULL CHECK(deletion_failures >= 0),
          projection_coverage REAL NOT NULL CHECK(projection_coverage BETWEEN 0 AND 1),
          restore_passed INTEGER NOT NULL CHECK(restore_passed IN (0,1)),
          rollback_passed INTEGER NOT NULL CHECK(rollback_passed IN (0,1)),
          p95_latency_ms REAL NOT NULL CHECK(p95_latency_ms >= 0),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 30,
    wave: 32,
    name: "reversible-progressive-cutover",
    up(db) {
      db.exec(`
        CREATE TABLE cutover_plans (
          id TEXT PRIMARY KEY,
          shadow_session_id TEXT NOT NULL REFERENCES shadow_sessions(id),
          plan_version TEXT NOT NULL,
          domain_order_json TEXT NOT NULL CHECK(json_valid(domain_order_json)),
          rollback_window_ends_at TEXT NOT NULL,
          retention_until TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('draft','approved','active','rolled_back','complete','rejected')),
          approved_by TEXT REFERENCES actors(id),
          approval_receipt_mac TEXT,
          created_at TEXT NOT NULL,
          approved_at TEXT,
          completed_at TEXT,
          UNIQUE(shadow_session_id,plan_version)
        ) STRICT;
        CREATE TABLE cutover_domain_states (
          plan_id TEXT NOT NULL REFERENCES cutover_plans(id),
          domain TEXT NOT NULL CHECK(domain IN ('explicit_commands','conversation_runtime','retrieval_context','room_integrations')),
          authority TEXT NOT NULL CHECK(authority IN ('legacy','vnext')),
          state TEXT NOT NULL CHECK(state IN ('pending','shadow','primary','archived','rolled_back')),
          fallback_enabled INTEGER NOT NULL CHECK(fallback_enabled IN (0,1)),
          activation_sequence INTEGER CHECK(activation_sequence IS NULL OR activation_sequence >= 0),
          projection_version TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(plan_id,domain)
        ) STRICT;
        CREATE TABLE cutover_transitions (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES cutover_plans(id),
          domain TEXT NOT NULL,
          from_authority TEXT NOT NULL CHECK(from_authority IN ('legacy','vnext')),
          to_authority TEXT NOT NULL CHECK(to_authority IN ('legacy','vnext')),
          gate_snapshot_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK(from_authority <> to_authority)
        ) STRICT;
        CREATE TABLE legacy_archive_registry (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES cutover_plans(id),
          source_key TEXT NOT NULL,
          snapshot_sha256 TEXT NOT NULL,
          snapshot_path_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          read_only_verified INTEGER NOT NULL CHECK(read_only_verified IN (0,1)),
          retention_until TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('registered','sealed','eligible_delete','retained')),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(plan_id,source_key,snapshot_sha256)
        ) STRICT;
        CREATE TABLE cutover_rollbacks (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES cutover_plans(id),
          domain TEXT NOT NULL,
          transition_id TEXT NOT NULL REFERENCES cutover_transitions(id),
          replay_export_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          actor_id TEXT NOT NULL REFERENCES actors(id),
          reason_code TEXT NOT NULL,
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE owner_acceptance_runs (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES cutover_plans(id),
          suite_version TEXT NOT NULL,
          results_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          required_count INTEGER NOT NULL CHECK(required_count >= 0),
          passed_count INTEGER NOT NULL CHECK(passed_count >= 0),
          failed_count INTEGER NOT NULL CHECK(failed_count >= 0),
          passed INTEGER NOT NULL CHECK(passed IN (0,1)),
          accepted_by TEXT NOT NULL REFERENCES actors(id),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE model_plan_handoffs (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL UNIQUE REFERENCES cutover_plans(id),
          memory_contract_version TEXT NOT NULL,
          frozen_plan_hash TEXT NOT NULL,
          handoff_encrypted_id TEXT NOT NULL REFERENCES encrypted_objects(id),
          receipt_mac TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
]);

module.exports = { MIGRATIONS };
